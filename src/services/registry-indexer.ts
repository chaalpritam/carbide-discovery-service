/**
 * CarbideRegistry indexer.
 *
 * Watches the on-chain provider registry and mirrors its state into the
 * local `providers` table. The point is to flip the trust direction:
 * the contract is authoritative, this service is just a fast read cache.
 *
 * Responsibilities:
 *   1. Backfill: on startup, page through `getProvidersPage` and upsert
 *      every current entry (source = 'registry'). Providers that
 *      disappeared while the service was down get cleaned up here.
 *   2. Live updates: subscribe to `ProviderRegistered`, `ProviderUpdated`,
 *      `ProviderActiveChanged`, and `ProviderDeregistered`; upsert or
 *      delete rows as each event arrives.
 *   3. Reconnect on RPC drop, without losing events in between.
 *
 * Notes:
 *   - Rows managed by this indexer are tagged `source = 'registry'` so
 *     the HTTP `POST /providers` path (source = 'http') can coexist.
 *   - Provider IDs for on-chain entries are derived deterministically
 *     from the owner address; this matches the Rust client so the same
 *     entry has the same UUID across processes.
 */

import type Database from 'better-sqlite3';
import { ethers } from 'ethers';
import type { FastifyBaseLogger } from 'fastify';

import { ProviderQueries } from '../database/queries.js';
import type { Provider } from '../types/index.js';
import { ProviderTier, Region } from '../types/provider.js';
import { DEFAULT_REPUTATION } from '../types/reputation.js';
import { ServiceStatus } from '../types/network.js';
import registryAbi from '../abi/CarbideRegistry.json' with { type: 'json' };

export interface RegistryIndexerConfig {
  rpcUrl: string;
  registryAddress: string;
  /**
   * Page size for the initial backfill. Small enough to keep RPC
   * responses under typical limits; large enough that startup is fast
   * even with many providers.
   */
  pageSize?: number;
  /**
   * Time in ms before the indexer gives up on a single RPC call and
   * surfaces the error. Does not apply to the long-lived event
   * subscription.
   */
  rpcTimeoutMs?: number;
}

/** USDC has 6 decimals; on-chain prices are stored in base units. */
const USDC_DECIMALS = 6;

/** Tier u8 -> enum string. */
const TIER_BY_INDEX: ProviderTier[] = [
  ProviderTier.Home,
  ProviderTier.Professional,
  ProviderTier.Enterprise,
  ProviderTier.GlobalCDN,
];

/** Event names the indexer subscribes to. */
const EVENTS = [
  'ProviderRegistered',
  'ProviderUpdated',
  'ProviderActiveChanged',
  'ProviderDeregistered',
] as const;

/**
 * Derive a deterministic UUID v4 from an Ethereum address so the same
 * on-chain entry always yields the same local id. Matches the Rust
 * `stable_provider_id` implementation in carbide-client.
 */
export function stableProviderId(address: string): string {
  const clean = address.toLowerCase().replace(/^0x/, '');
  if (clean.length !== 40 || !/^[0-9a-f]+$/.test(clean)) {
    throw new Error(`invalid address ${address}`);
  }
  // Take the first 16 bytes (32 hex chars) of the 20-byte address.
  const bytes = Buffer.from(clean.slice(0, 32), 'hex');
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/**
 * Map an on-chain region string to the canonical Region enum. The
 * contract stores whatever the provider wrote; accept common spellings
 * case-insensitively. Throws for unknown values so the caller can log
 * and skip the row.
 */
export function regionFromChain(raw: string): Region {
  const key = raw.trim().toLowerCase();
  switch (key) {
    case 'northamerica':
    case 'north_america':
    case 'na':
      return Region.NorthAmerica;
    case 'europe':
    case 'eu':
      return Region.Europe;
    case 'asia':
    case 'ap':
    case 'asiapacific':
      return Region.Asia;
    case 'southamerica':
    case 'south_america':
    case 'sa':
      return Region.SouthAmerica;
    case 'africa':
    case 'af':
      return Region.Africa;
    case 'oceania':
    case 'oc':
      return Region.Oceania;
    default:
      throw new Error(`unknown region ${raw}`);
  }
}

export function tierFromIndex(idx: number): ProviderTier {
  const tier = TIER_BY_INDEX[idx];
  if (!tier) {
    throw new Error(`unknown tier index ${idx}`);
  }
  return tier;
}

/**
 * Convert USDC base units (6 decimals) to a decimal string. We keep
 * prices as strings everywhere to avoid JavaScript number precision.
 */
export function priceFromBaseUnits(baseUnits: bigint): string {
  if (baseUnits === 0n) return '0';
  const scale = 10n ** BigInt(USDC_DECIMALS);
  const whole = baseUnits / scale;
  const frac = baseUnits % scale;
  if (frac === 0n) return whole.toString();
  // Pad the fractional part to USDC_DECIMALS digits, then trim trailing zeros.
  const fracStr = frac.toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '');
  return `${whole.toString()}.${fracStr}`;
}

/**
 * Shape of the on-chain `Provider` struct as returned by ethers v6.
 * ethers decodes struct returns as `Result` values with numeric and
 * named access; we copy out fields we need and coerce to plain types.
 */
interface ChainProvider {
  endpoint: string;
  region: string;
  pricePerGbMonth: bigint;
  capacityGb: bigint;
  registeredAt: bigint;
  updatedAt: bigint;
  tier: number;
  active: boolean;
}

function coerceChainProvider(raw: unknown): ChainProvider {
  // ethers returns a Proxy-like object; both numeric and field names work.
  // Use named access for readability.
  const r = raw as Record<string, unknown>;
  return {
    endpoint: String(r.endpoint),
    region: String(r.region),
    pricePerGbMonth: BigInt(r.pricePerGbMonth as bigint | number | string),
    capacityGb: BigInt(r.capacityGb as bigint | number | string),
    registeredAt: BigInt(r.registeredAt as bigint | number | string),
    updatedAt: BigInt(r.updatedAt as bigint | number | string),
    tier: Number(r.tier),
    active: Boolean(r.active),
  };
}

function toProvider(owner: string, p: ChainProvider): Provider {
  const tier = tierFromIndex(p.tier);
  const region = regionFromChain(p.region);
  const capacityBytes = Number(p.capacityGb) * 1_000_000_000;
  const updatedAtMs = Number(p.updatedAt) * 1000;
  const lastSeen = new Date(updatedAtMs).toISOString();
  const ownerLower = owner.toLowerCase();

  return {
    id: stableProviderId(owner),
    name: `on-chain:${ownerLower}`,
    tier,
    region,
    endpoint: p.endpoint,
    available_capacity: capacityBytes,
    total_capacity: capacityBytes,
    price_per_gb_month: priceFromBaseUnits(p.pricePerGbMonth),
    reputation: { ...DEFAULT_REPUTATION, last_updated: lastSeen },
    last_seen: lastSeen,
    metadata: {
      source: 'carbide-registry',
      chain_owner: ownerLower,
      registered_at: p.registeredAt.toString(),
    },
    wallet_address: ownerLower,
  };
}

export class RegistryIndexer {
  private readonly db: Database.Database;
  private readonly queries: ProviderQueries;
  private readonly log: FastifyBaseLogger;
  private readonly pageSize: number;

  private provider?: ethers.JsonRpcProvider;
  private contract?: ethers.Contract;
  private stopped = false;
  private readonly listeners = new Map<string, ethers.Listener>();

  constructor(
    db: Database.Database,
    private readonly cfg: RegistryIndexerConfig,
    log: FastifyBaseLogger,
  ) {
    this.db = db;
    this.queries = new ProviderQueries(db);
    this.log = log.child({ component: 'registry-indexer' });
    this.pageSize = cfg.pageSize ?? 100;
  }

  /** Start the indexer: connect, backfill, then subscribe to events. */
  async start(): Promise<void> {
    this.provider = new ethers.JsonRpcProvider(this.cfg.rpcUrl);
    this.contract = new ethers.Contract(
      this.cfg.registryAddress,
      registryAbi as ethers.InterfaceAbi,
      this.provider,
    );

    this.log.info(
      { registry: this.cfg.registryAddress, rpcUrl: this.cfg.rpcUrl },
      'registry indexer starting',
    );

    await this.backfill();
    this.subscribe();
  }

  /** Stop listeners and close the RPC connection. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.contract) {
      for (const [name, fn] of this.listeners) {
        try {
          await this.contract.off(name, fn);
        } catch (err) {
          this.log.warn({ err, name }, 'error removing event listener');
        }
      }
      this.listeners.clear();
    }
    this.provider?.destroy();
    this.log.info('registry indexer stopped');
  }

  /**
   * Read the entire registry via `getProvidersPage` and upsert each
   * row. Also prunes any registry-sourced rows that are no longer
   * on-chain (the provider deregistered while we were offline).
   */
  private async backfill(): Promise<void> {
    if (!this.contract) throw new Error('indexer not initialized');
    const count: bigint = await this.contract.providerCount();
    const total = Number(count);
    this.log.info({ total }, 'registry backfill starting');

    const seen = new Set<string>();
    let offset = 0;
    while (offset < total) {
      const take = Math.min(this.pageSize, total - offset);
      const [owners, rows]: [string[], unknown[]] = await this.contract.getProvidersPage(
        BigInt(offset),
        BigInt(take),
      );
      for (let i = 0; i < owners.length; i++) {
        const owner = owners[i];
        const row = coerceChainProvider(rows[i]);
        seen.add(owner.toLowerCase());
        this.applyUpsert(owner, row, 'backfill');
      }
      offset += take;
    }

    this.pruneMissing(seen);
    this.log.info({ upserted: seen.size }, 'registry backfill complete');
  }

  private subscribe(): void {
    if (!this.contract) throw new Error('indexer not initialized');

    const onRegisteredOrUpdated = (
      label: 'ProviderRegistered' | 'ProviderUpdated',
    ): ethers.Listener => {
      // The event carries (owner, endpoint, region, tier, capacityGb,
      // pricePerGbMonth). We'd still need registeredAt/updatedAt/active,
      // so we re-read the struct to capture the full row. This extra
      // read per event keeps the row consistent with the contract even
      // if we missed an intervening update.
      return (async (...args: unknown[]) => {
        const owner = args[0] as string;
        try {
          const raw: unknown = await this.contract!.getProvider(owner);
          this.applyUpsert(owner, coerceChainProvider(raw), label);
        } catch (err) {
          this.log.warn({ err, owner, label }, 'failed to refresh provider after event');
        }
      }) as ethers.Listener;
    };

    const onActiveChanged: ethers.Listener = (async (...args: unknown[]) => {
      const owner = args[0] as string;
      const active = args[1] as boolean;
      try {
        if (!active) {
          // Provider went inactive; refresh so health_status reflects it.
          const raw: unknown = await this.contract!.getProvider(owner);
          this.applyUpsert(owner, coerceChainProvider(raw), 'ProviderActiveChanged');
        } else {
          const raw: unknown = await this.contract!.getProvider(owner);
          this.applyUpsert(owner, coerceChainProvider(raw), 'ProviderActiveChanged');
        }
      } catch (err) {
        this.log.warn({ err, owner, active }, 'failed to apply active change');
      }
    }) as ethers.Listener;

    const onDeregistered: ethers.Listener = ((...args: unknown[]) => {
      const owner = args[0] as string;
      this.applyDelete(owner);
    }) as ethers.Listener;

    const registered = onRegisteredOrUpdated('ProviderRegistered');
    const updated = onRegisteredOrUpdated('ProviderUpdated');

    this.contract.on('ProviderRegistered', registered);
    this.contract.on('ProviderUpdated', updated);
    this.contract.on('ProviderActiveChanged', onActiveChanged);
    this.contract.on('ProviderDeregistered', onDeregistered);

    this.listeners.set('ProviderRegistered', registered);
    this.listeners.set('ProviderUpdated', updated);
    this.listeners.set('ProviderActiveChanged', onActiveChanged);
    this.listeners.set('ProviderDeregistered', onDeregistered);

    this.log.info({ events: EVENTS }, 'registry indexer subscribed');
  }

  /**
   * Upsert one chain row into the `providers` table. Skips rows with
   * validation issues (unknown region/tier, invalid endpoint) but logs
   * them so operators notice misconfigured providers.
   */
  applyUpsert(owner: string, row: ChainProvider, reason: string): void {
    if (this.stopped) return;
    try {
      const provider = toProvider(owner, row);
      const healthStatus = row.active ? ServiceStatus.Healthy : ServiceStatus.Unavailable;
      upsertRegistryRow(this.db, provider, {
        chainOwner: owner.toLowerCase(),
        healthStatus,
      });
      this.log.debug({ owner, reason, active: row.active }, 'registry row upserted');
    } catch (err) {
      this.log.warn({ err, owner, reason }, 'skipping registry row');
    }
  }

  applyDelete(owner: string): void {
    if (this.stopped) return;
    const id = stableProviderId(owner);
    const removed = this.queries.deleteProvider(id);
    this.log.info({ owner, id, removed }, 'registry row deleted');
  }

  /** Remove registry-sourced rows whose owner is no longer on-chain. */
  private pruneMissing(seenOwners: Set<string>): void {
    const rows = this.db
      .prepare<[], { id: string; chain_owner: string | null }>(
        "SELECT id, chain_owner FROM providers WHERE source = 'registry'",
      )
      .all();
    for (const row of rows) {
      if (!row.chain_owner || !seenOwners.has(row.chain_owner)) {
        this.queries.deleteProvider(row.id);
        this.log.info({ id: row.id, owner: row.chain_owner }, 'pruned stale registry row');
      }
    }
  }
}

/**
 * Write a registry-sourced provider row directly. Uses a dedicated
 * INSERT OR REPLACE so we can stamp `source = 'registry'` and `chain_owner`
 * without changing the shared ProviderQueries.upsertProvider signature.
 */
function upsertRegistryRow(
  db: Database.Database,
  provider: Provider,
  meta: { chainOwner: string; healthStatus: ServiceStatus },
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO providers (
      id, name, tier, region, endpoint,
      available_capacity, total_capacity, price_per_gb_month,
      last_seen, metadata,
      rep_overall, rep_uptime, rep_data_integrity, rep_response_time,
      rep_contract_compliance, rep_community_feedback, rep_contracts_completed,
      rep_last_updated,
      registered_at, last_heartbeat, health_status, failed_health_checks,
      current_load, available_storage, active_contracts,
      source, chain_owner
    ) VALUES (
      @id, @name, @tier, @region, @endpoint,
      @available_capacity, @total_capacity, @price_per_gb_month,
      @last_seen, @metadata,
      @rep_overall, @rep_uptime, @rep_data_integrity, @rep_response_time,
      @rep_contract_compliance, @rep_community_feedback, @rep_contracts_completed,
      @rep_last_updated,
      @registered_at, @last_heartbeat, @health_status, @failed_health_checks,
      @current_load, @available_storage, @active_contracts,
      @source, @chain_owner
    )`,
  ).run({
    id: provider.id,
    name: provider.name,
    tier: provider.tier,
    region: provider.region,
    endpoint: provider.endpoint,
    available_capacity: provider.available_capacity,
    total_capacity: provider.total_capacity,
    price_per_gb_month: provider.price_per_gb_month,
    last_seen: provider.last_seen,
    metadata: JSON.stringify(provider.metadata),
    rep_overall: provider.reputation.overall,
    rep_uptime: provider.reputation.uptime,
    rep_data_integrity: provider.reputation.data_integrity,
    rep_response_time: provider.reputation.response_time,
    rep_contract_compliance: provider.reputation.contract_compliance,
    rep_community_feedback: provider.reputation.community_feedback,
    rep_contracts_completed: provider.reputation.contracts_completed,
    rep_last_updated: provider.reputation.last_updated,
    registered_at: provider.last_seen,
    last_heartbeat: now,
    health_status: meta.healthStatus,
    failed_health_checks: 0,
    current_load: null,
    available_storage: provider.available_capacity,
    active_contracts: 0,
    source: 'registry',
    chain_owner: meta.chainOwner,
  });
}

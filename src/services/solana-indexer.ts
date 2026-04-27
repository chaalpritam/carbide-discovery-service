/**
 * carbide_registry indexer (Solana edition).
 *
 * Watches the on-chain ProviderAccount PDAs and mirrors their state into
 * the local `providers` table so the HTTP discovery surface can serve
 * provider lookups without a chain round-trip. The contract is the
 * authority; this service is just a fast read cache.
 *
 * Lifecycle:
 *   1. Backfill on startup: page through every account owned by the
 *      registry program, filtered by the 8-byte Anchor discriminator,
 *      and upsert each into `providers` (source = 'registry').
 *      Registry-sourced rows that are no longer on-chain get pruned.
 *   2. Live updates: subscribe to onProgramAccountChange so any
 *      register/update/setActive call is reflected within seconds. We
 *      do not subscribe to deletions directly — instead we re-run the
 *      backfill prune step on a slow cadence so deregistered accounts
 *      eventually fall out.
 *
 * The discriminator and account layout match the Anchor program
 * exactly (see programs/carbide_registry/src/lib.rs in
 * carbide-contracts) so any drift between this and the on-chain code
 * surfaces as decode errors during backfill.
 */

import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  Connection,
  PublicKey,
  type GetProgramAccountsResponse,
} from '@solana/web3.js';
import bs58 from 'bs58';
import type { FastifyBaseLogger } from 'fastify';

import { ProviderQueries } from '../database/queries.js';
import type { Provider } from '../types/index.js';
import { ProviderTier, Region } from '../types/provider.js';
import { DEFAULT_REPUTATION } from '../types/reputation.js';
import { ServiceStatus } from '../types/network.js';

export interface SolanaIndexerConfig {
  rpcUrl: string;
  /** Optional explicit websocket URL; defaults to the cluster's standard ws endpoint. */
  wsUrl?: string;
  registryProgramId: string;
  /**
   * How often to re-run the prune step (ms). Keeps the local table in
   * sync when providers deregister between subscription events.
   */
  pruneIntervalMs?: number;
}

/** USDC has 6 decimals; on-chain prices are stored in base units. */
const USDC_DECIMALS = 6;

/** Tier index → enum string. Matches the program's tier ordering. */
const TIER_BY_INDEX: ProviderTier[] = [
  ProviderTier.Home,
  ProviderTier.Professional,
  ProviderTier.Enterprise,
  ProviderTier.GlobalCDN,
];

/** Anchor 8-byte discriminator: sha256("account:ProviderAccount")[..8]. */
function providerAccountDiscriminator(): Buffer {
  return createHash('sha256').update('account:ProviderAccount').digest().subarray(0, 8);
}

/** Decoded ProviderAccount mirror (sans the 8-byte discriminator). */
interface ProviderRecord {
  owner: Buffer;
  endpoint: string;
  region: string;
  pricePerGbMonth: bigint;
  capacityGb: bigint;
  registeredAt: bigint;
  updatedAt: bigint;
  tier: number;
  active: boolean;
  bump: number;
}

/** Decode an on-chain ProviderAccount body byte-for-byte. */
export function decodeProviderAccount(data: Buffer): ProviderRecord {
  const disc = providerAccountDiscriminator();
  if (data.length < 8) {
    throw new Error('account data shorter than 8-byte discriminator');
  }
  if (!data.subarray(0, 8).equals(disc)) {
    throw new Error('discriminator does not match ProviderAccount');
  }

  let off = 8;
  const owner = Buffer.from(data.subarray(off, off + 32));
  off += 32;

  const readString = (): string => {
    const len = data.readUInt32LE(off);
    off += 4;
    const s = data.subarray(off, off + len).toString('utf8');
    off += len;
    return s;
  };

  const endpoint = readString();
  const region = readString();
  const pricePerGbMonth = data.readBigUInt64LE(off);
  off += 8;
  const capacityGb = data.readBigUInt64LE(off);
  off += 8;
  const registeredAt = data.readBigInt64LE(off);
  off += 8;
  const updatedAt = data.readBigInt64LE(off);
  off += 8;
  const tier = data.readUInt8(off);
  off += 1;
  const active = data.readUInt8(off) !== 0;
  off += 1;
  const bump = data.readUInt8(off);

  return {
    owner,
    endpoint,
    region,
    pricePerGbMonth,
    capacityGb,
    registeredAt,
    updatedAt,
    tier,
    active,
    bump,
  };
}

/**
 * Render USDC base units (6 decimals) as a decimal string. Strings
 * everywhere keeps us out of JS's Number.MAX_SAFE_INTEGER territory.
 */
export function priceFromBaseUnits(baseUnits: bigint): string {
  if (baseUnits === 0n) return '0';
  const scale = 10n ** BigInt(USDC_DECIMALS);
  const whole = baseUnits / scale;
  const frac = baseUnits % scale;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '');
  return `${whole.toString()}.${fracStr}`;
}

export function tierFromIndex(idx: number): ProviderTier {
  const tier = TIER_BY_INDEX[idx];
  if (!tier) {
    throw new Error(`unknown tier index ${idx}`);
  }
  return tier;
}

/**
 * Forgiving region mapping — the contract stores whatever the provider
 * wrote, accept common spellings case-insensitively.
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

/**
 * Derive a stable UUID v4 from the 32-byte owner pubkey so the same
 * on-chain entry always yields the same local id. Matches the Rust
 * client's stable_provider_id helper for cross-process parity.
 */
export function stableProviderId(owner: Buffer): string {
  const arr = Buffer.from(owner.subarray(0, 16));
  arr[6] = (arr[6] & 0x0f) | 0x40; // version 4
  arr[8] = (arr[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = arr.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

function toProvider(record: ProviderRecord): Provider {
  const tier = tierFromIndex(record.tier);
  const region = regionFromChain(record.region);
  const capacityBytes = Number(record.capacityGb) * 1_000_000_000;
  const updatedAtMs = Number(record.updatedAt) * 1000;
  const lastSeen = new Date(updatedAtMs).toISOString();
  const ownerBase58 = bs58.encode(record.owner);

  return {
    id: stableProviderId(record.owner),
    name: `on-chain:${ownerBase58}`,
    tier,
    region,
    endpoint: record.endpoint,
    available_capacity: capacityBytes,
    total_capacity: capacityBytes,
    price_per_gb_month: priceFromBaseUnits(record.pricePerGbMonth),
    reputation: { ...DEFAULT_REPUTATION, last_updated: lastSeen },
    last_seen: lastSeen,
    metadata: {
      source: 'carbide-registry',
      chain_owner: ownerBase58,
      registered_at: record.registeredAt.toString(),
    },
    wallet_address: ownerBase58,
  };
}

export class SolanaIndexer {
  private readonly db: Database.Database;
  private readonly queries: ProviderQueries;
  private readonly log: FastifyBaseLogger;
  private readonly programId: PublicKey;
  private readonly connection: Connection;
  private readonly pruneIntervalMs: number;

  private subscriptionId: number | null = null;
  private pruneTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    db: Database.Database,
    private readonly cfg: SolanaIndexerConfig,
    log: FastifyBaseLogger,
  ) {
    this.db = db;
    this.queries = new ProviderQueries(db);
    this.log = log.child({ component: 'solana-indexer' });
    this.programId = new PublicKey(cfg.registryProgramId);
    this.connection = new Connection(
      cfg.rpcUrl,
      cfg.wsUrl ? { wsEndpoint: cfg.wsUrl, commitment: 'confirmed' } : 'confirmed',
    );
    this.pruneIntervalMs = cfg.pruneIntervalMs ?? 5 * 60_000;
  }

  /** Backfill, then subscribe to live updates and a periodic prune. */
  async start(): Promise<void> {
    this.log.info(
      { registry: this.programId.toBase58(), rpc: this.cfg.rpcUrl },
      'solana indexer starting',
    );
    await this.backfill();
    this.subscribe();
    this.pruneTimer = setInterval(() => {
      void this.runPrune();
    }, this.pruneIntervalMs);
    this.pruneTimer.unref?.();
  }

  /** Tear down the websocket subscription and prune timer. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
    if (this.subscriptionId !== null) {
      try {
        await this.connection.removeProgramAccountChangeListener(this.subscriptionId);
      } catch (err) {
        this.log.warn({ err }, 'failed to remove program subscription');
      }
      this.subscriptionId = null;
    }
    this.log.info('solana indexer stopped');
  }

  /** Read every ProviderAccount the program currently holds. */
  private async backfill(): Promise<void> {
    const accounts = await this.fetchAllAccounts();
    const seen = new Set<string>();
    for (const { pubkey, account } of accounts) {
      try {
        const record = decodeProviderAccount(Buffer.from(account.data));
        const owner = bs58.encode(record.owner);
        seen.add(owner);
        this.applyUpsert(record, 'backfill');
      } catch (err) {
        this.log.warn(
          { err, account: pubkey.toBase58() },
          'skipping malformed registry account',
        );
      }
    }
    this.pruneMissing(seen);
    this.log.info({ upserted: seen.size }, 'registry backfill complete');
  }

  private async fetchAllAccounts(): Promise<GetProgramAccountsResponse> {
    const disc = providerAccountDiscriminator();
    return this.connection.getProgramAccounts(this.programId, {
      commitment: 'confirmed',
      filters: [{ memcmp: { offset: 0, bytes: bs58.encode(disc) } }],
    });
  }

  private subscribe(): void {
    const disc = providerAccountDiscriminator();
    this.subscriptionId = this.connection.onProgramAccountChange(
      this.programId,
      (info) => {
        try {
          const record = decodeProviderAccount(Buffer.from(info.accountInfo.data));
          this.applyUpsert(record, 'subscription');
        } catch (err) {
          this.log.warn(
            { err, account: info.accountId.toBase58() },
            'failed to decode subscription update',
          );
        }
      },
      {
        commitment: 'confirmed',
        filters: [{ memcmp: { offset: 0, bytes: bs58.encode(disc) } }],
      },
    );
    this.log.info({ subscription: this.subscriptionId }, 'solana indexer subscribed');
  }

  /** Re-run backfill prune in the background to catch deregistrations. */
  private async runPrune(): Promise<void> {
    if (this.stopped) return;
    try {
      const accounts = await this.fetchAllAccounts();
      const seen = new Set<string>();
      for (const { account } of accounts) {
        try {
          const record = decodeProviderAccount(Buffer.from(account.data));
          seen.add(bs58.encode(record.owner));
        } catch {
          // Already logged by backfill; skip silently here.
        }
      }
      this.pruneMissing(seen);
    } catch (err) {
      this.log.warn({ err }, 'periodic prune failed');
    }
  }

  applyUpsert(record: ProviderRecord, reason: string): void {
    if (this.stopped) return;
    try {
      const provider = toProvider(record);
      const healthStatus = record.active
        ? ServiceStatus.Healthy
        : ServiceStatus.Unavailable;
      upsertRegistryRow(this.db, provider, {
        chainOwner: bs58.encode(record.owner),
        healthStatus,
      });
      this.log.debug(
        { owner: bs58.encode(record.owner), reason, active: record.active },
        'registry row upserted',
      );
    } catch (err) {
      this.log.warn({ err, reason }, 'skipping registry row');
    }
  }

  /** Drop registry-sourced rows whose chain_owner is no longer on-chain. */
  private pruneMissing(seenOwners: Set<string>): void {
    const rows = this.db
      .prepare<[], { id: string; chain_owner: string | null }>(
        "SELECT id, chain_owner FROM providers WHERE source = 'registry'",
      )
      .all();
    for (const row of rows) {
      if (!row.chain_owner || !seenOwners.has(row.chain_owner)) {
        this.queries.deleteProvider(row.id);
        this.log.info(
          { id: row.id, owner: row.chain_owner },
          'pruned stale registry row',
        );
      }
    }
  }
}

/**
 * Upsert a registry-sourced provider row. Mirrors the Ethereum version:
 * stamp source='registry' and chain_owner=<base58 pubkey> so the HTTP
 * /providers path (source='http') can coexist.
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

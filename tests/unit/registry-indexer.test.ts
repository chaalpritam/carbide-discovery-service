import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';

import { initDatabase } from '../../src/database/index.js';
import {
  RegistryIndexer,
  priceFromBaseUnits,
  regionFromChain,
  stableProviderId,
  tierFromIndex,
} from '../../src/services/registry-indexer.js';
import { ProviderTier, Region } from '../../src/types/provider.js';
import { ServiceStatus } from '../../src/types/network.js';

// Minimal logger stub matching the subset of fastify's logger the
// indexer actually calls.
const silentLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  fatal: () => {},
  trace: () => {},
  child: () => silentLog,
  level: 'silent',
} as unknown as Parameters<typeof RegistryIndexer.prototype.applyUpsert>[0] extends never
  ? never
  : any;

// The first 16 bytes of the address seed the UUID; pick distinct prefixes
// so the two test owners don't collide in the stable-id space.
const OWNER_A = '0x1111111111111111111111111100000000000001';
const OWNER_B = '0x2222222222222222222222222200000000000002';

function chainRow(overrides: Partial<ChainRowShape> = {}): ChainRowShape {
  return {
    endpoint: 'https://alice.example:8080',
    region: 'NorthAmerica',
    pricePerGbMonth: 5_000n,
    capacityGb: 100n,
    registeredAt: 1_700_000_000n,
    updatedAt: 1_700_000_500n,
    tier: 0,
    active: true,
    ...overrides,
  };
}

interface ChainRowShape {
  endpoint: string;
  region: string;
  pricePerGbMonth: bigint;
  capacityGb: bigint;
  registeredAt: bigint;
  updatedAt: bigint;
  tier: number;
  active: boolean;
}

function makeIndexer(db: Database.Database): RegistryIndexer {
  return new RegistryIndexer(
    db,
    {
      rpcUrl: 'http://unused.invalid',
      registryAddress: '0x0000000000000000000000000000000000000000',
    },
    silentLog,
  );
}

describe('registry indexer - pure helpers', () => {
  it('stableProviderId is deterministic and matches UUID v4 shape', () => {
    const id1 = stableProviderId(OWNER_A);
    const id2 = stableProviderId(OWNER_A.toUpperCase());
    expect(id1).toBe(id2);
    expect(id1).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('stableProviderId rejects malformed addresses', () => {
    expect(() => stableProviderId('0xdeadbeef')).toThrow();
    expect(() => stableProviderId('not-an-address')).toThrow();
  });

  it('tierFromIndex maps all valid indices', () => {
    expect(tierFromIndex(0)).toBe(ProviderTier.Home);
    expect(tierFromIndex(1)).toBe(ProviderTier.Professional);
    expect(tierFromIndex(2)).toBe(ProviderTier.Enterprise);
    expect(tierFromIndex(3)).toBe(ProviderTier.GlobalCDN);
    expect(() => tierFromIndex(4)).toThrow();
  });

  it('regionFromChain is case-insensitive across common spellings', () => {
    expect(regionFromChain('NorthAmerica')).toBe(Region.NorthAmerica);
    expect(regionFromChain('northamerica')).toBe(Region.NorthAmerica);
    expect(regionFromChain('EU')).toBe(Region.Europe);
    expect(regionFromChain('ASIA')).toBe(Region.Asia);
    expect(() => regionFromChain('MARS')).toThrow();
  });

  it('priceFromBaseUnits converts USDC base units to a decimal string', () => {
    expect(priceFromBaseUnits(5_000n)).toBe('0.005');
    expect(priceFromBaseUnits(1_000_000n)).toBe('1');
    expect(priceFromBaseUnits(0n)).toBe('0');
    expect(priceFromBaseUnits(12_345_678n)).toBe('12.345678');
  });
});

describe('registry indexer - database side effects', () => {
  let db: Database.Database;
  let indexer: RegistryIndexer;

  beforeEach(() => {
    db = initDatabase(':memory:');
    indexer = makeIndexer(db);
  });

  afterEach(() => {
    db.close();
  });

  it('applyUpsert writes a registry-sourced row', () => {
    indexer.applyUpsert(OWNER_A, chainRow(), 'test');

    const row = db
      .prepare(
        "SELECT id, name, tier, region, endpoint, price_per_gb_month, source, chain_owner, health_status FROM providers WHERE chain_owner = ?",
      )
      .get(OWNER_A.toLowerCase()) as Record<string, unknown>;

    expect(row).toBeTruthy();
    expect(row.id).toBe(stableProviderId(OWNER_A));
    expect(row.tier).toBe(ProviderTier.Home);
    expect(row.region).toBe(Region.NorthAmerica);
    expect(row.endpoint).toBe('https://alice.example:8080');
    expect(row.price_per_gb_month).toBe('0.005');
    expect(row.source).toBe('registry');
    expect(row.health_status).toBe(ServiceStatus.Healthy);
  });

  it('applyUpsert marks inactive providers as Unavailable', () => {
    indexer.applyUpsert(OWNER_A, chainRow({ active: false }), 'test');

    const row = db
      .prepare('SELECT health_status FROM providers WHERE chain_owner = ?')
      .get(OWNER_A.toLowerCase()) as { health_status: string };

    expect(row.health_status).toBe(ServiceStatus.Unavailable);
  });

  it('applyUpsert overwrites an existing row (idempotent)', () => {
    indexer.applyUpsert(OWNER_A, chainRow(), 'first');
    indexer.applyUpsert(
      OWNER_A,
      chainRow({ endpoint: 'https://alice-v2.example:9090', capacityGb: 250n }),
      'second',
    );

    const row = db
      .prepare(
        'SELECT endpoint, available_capacity FROM providers WHERE chain_owner = ?',
      )
      .get(OWNER_A.toLowerCase()) as { endpoint: string; available_capacity: number };

    expect(row.endpoint).toBe('https://alice-v2.example:9090');
    expect(row.available_capacity).toBe(250 * 1_000_000_000);

    const count = db
      .prepare('SELECT COUNT(*) as c FROM providers WHERE chain_owner = ?')
      .get(OWNER_A.toLowerCase()) as { c: number };
    expect(count.c).toBe(1);
  });

  it('applyUpsert skips rows with unknown region and leaves the table untouched', () => {
    indexer.applyUpsert(OWNER_A, chainRow({ region: 'Mars' }), 'test');

    const count = db
      .prepare('SELECT COUNT(*) as c FROM providers')
      .get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('applyDelete removes the row for a specific owner', () => {
    indexer.applyUpsert(OWNER_A, chainRow(), 'test');
    indexer.applyUpsert(OWNER_B, chainRow({ region: 'Europe' }), 'test');

    const before = db
      .prepare("SELECT COUNT(*) as c FROM providers WHERE source = 'registry'")
      .get() as { c: number };
    expect(before.c).toBe(2);

    indexer.applyDelete(OWNER_A);

    const rows = db
      .prepare("SELECT chain_owner FROM providers WHERE source = 'registry'")
      .all() as { chain_owner: string }[];
    expect(rows.length).toBe(1);
    expect(rows[0].chain_owner).toBe(OWNER_B.toLowerCase());
  });
});

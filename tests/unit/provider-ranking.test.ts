import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase } from '../../src/database/index.js';
import { ProviderQueries } from '../../src/database/queries.js';
import { randomUUID } from 'node:crypto';

function insertProvider(
  db: Database.Database,
  overrides: { rep_overall?: string; price_per_gb_month?: string; name?: string } = {},
) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO providers (
      id, name, tier, region, endpoint,
      available_capacity, total_capacity, price_per_gb_month,
      last_seen, metadata,
      rep_overall, rep_uptime, rep_data_integrity,
      rep_response_time, rep_contract_compliance, rep_community_feedback,
      rep_contracts_completed, rep_last_updated,
      registered_at, last_heartbeat, health_status,
      failed_health_checks, current_load, available_storage, active_contracts
    ) VALUES (
      ?, ?, 'Home', 'NorthAmerica', ?,
      1000000, 5000000, ?,
      ?, '{}',
      ?, '0.5', '0.5',
      '0.5', '0.5', '0.5',
      0, ?,
      ?, ?, 'Healthy',
      0, 0.1, 1000000, 0
    )`,
  ).run(
    id,
    overrides.name ?? `provider-${id.slice(0, 8)}`,
    `http://localhost:${3000 + Math.floor(Math.random() * 1000)}`,
    overrides.price_per_gb_month ?? '0.005',
    now,
    overrides.rep_overall ?? '0.5',
    now,
    now,
    now,
  );
  return id;
}

describe('Provider Ranking', () => {
  let db: Database.Database;
  let queries: ProviderQueries;

  beforeEach(() => {
    db = initDatabase(':memory:');
    queries = new ProviderQueries(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should sort by reputation descending by default', () => {
    insertProvider(db, { rep_overall: '0.3', name: 'low-rep' });
    insertProvider(db, { rep_overall: '0.9', name: 'high-rep' });
    insertProvider(db, { rep_overall: '0.6', name: 'mid-rep' });

    const result = queries.searchProviders(
      {},
      60 * 60 * 1000, // 1h timeout
      50,
    );

    expect(result.providers).toHaveLength(3);
    expect(result.providers[0].name).toBe('high-rep');
    expect(result.providers[1].name).toBe('mid-rep');
    expect(result.providers[2].name).toBe('low-rep');
  });

  it('should sort by reputation when sort_by=reputation', () => {
    insertProvider(db, { rep_overall: '0.2', name: 'low' });
    insertProvider(db, { rep_overall: '0.8', name: 'high' });

    const result = queries.searchProviders(
      { sort_by: 'reputation' },
      60 * 60 * 1000,
      50,
    );

    expect(result.providers[0].name).toBe('high');
    expect(result.providers[1].name).toBe('low');
  });

  it('should sort by price ascending when sort_by=price', () => {
    insertProvider(db, { price_per_gb_month: '0.010', name: 'expensive' });
    insertProvider(db, { price_per_gb_month: '0.002', name: 'cheap' });
    insertProvider(db, { price_per_gb_month: '0.005', name: 'mid' });

    const result = queries.searchProviders(
      { sort_by: 'price' },
      60 * 60 * 1000,
      50,
    );

    expect(result.providers[0].name).toBe('cheap');
    expect(result.providers[1].name).toBe('mid');
    expect(result.providers[2].name).toBe('expensive');
  });

  it('should sort by value composite when sort_by=value', () => {
    // High rep, high price
    insertProvider(db, { rep_overall: '0.9', price_per_gb_month: '0.015', name: 'good-but-pricey' });
    // High rep, low price — best value
    insertProvider(db, { rep_overall: '0.8', price_per_gb_month: '0.002', name: 'best-value' });
    // Low rep, low price
    insertProvider(db, { rep_overall: '0.2', price_per_gb_month: '0.001', name: 'cheap-low-rep' });

    const result = queries.searchProviders(
      { sort_by: 'value' },
      60 * 60 * 1000,
      50,
    );

    // best-value should rank highest (high rep + low price)
    expect(result.providers[0].name).toBe('best-value');
  });

  it('should filter by min_reputation', () => {
    insertProvider(db, { rep_overall: '0.3', name: 'low' });
    insertProvider(db, { rep_overall: '0.8', name: 'high' });

    const result = queries.searchProviders(
      { min_reputation: '0.5' },
      60 * 60 * 1000,
      50,
    );

    expect(result.providers).toHaveLength(1);
    expect(result.providers[0].name).toBe('high');
  });

  it('should respect limit parameter', () => {
    insertProvider(db, { rep_overall: '0.9' });
    insertProvider(db, { rep_overall: '0.8' });
    insertProvider(db, { rep_overall: '0.7' });

    const result = queries.searchProviders(
      { limit: 2 },
      60 * 60 * 1000,
      50,
    );

    expect(result.providers).toHaveLength(2);
    expect(result.totalCount).toBe(3);
  });
});

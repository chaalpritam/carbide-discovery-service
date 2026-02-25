import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase } from '../../src/database/index.js';
import { AnalyticsService } from '../../src/services/analytics-service.js';
import { randomUUID } from 'node:crypto';

describe('Analytics Trending', () => {
  let db: Database.Database;
  let analyticsService: AnalyticsService;

  const insertProvider = (id: string) => {
    db.prepare(`
      INSERT INTO providers (id, name, tier, region, endpoint, available_capacity, total_capacity,
        price_per_gb_month, last_seen, metadata, rep_overall, rep_uptime, rep_data_integrity,
        rep_response_time, rep_contract_compliance, rep_community_feedback, rep_contracts_completed,
        rep_last_updated, registered_at, last_heartbeat, health_status, failed_health_checks,
        current_load, available_storage, active_contracts)
      VALUES (?, 'test-provider', 'Home', 'NorthAmerica', 'http://localhost:8080', 10000000000,
        25000000000, '0.005', datetime('now'), '{}', '0.5', '0.5', '0.5', '0.5', '0.5', '0.5',
        0, datetime('now'), datetime('now'), datetime('now'), 'Healthy', 0, 0.1, 10000000000, 0)
    `).run(id);
  };

  beforeEach(() => {
    db = initDatabase(':memory:');
    analyticsService = new AnalyticsService(db);
  });

  afterEach(() => {
    db.close();
  });

  it('recordDailySnapshot creates row in usage_snapshots', () => {
    insertProvider(randomUUID());

    analyticsService.recordDailySnapshot();

    const rows = db.prepare('SELECT * FROM usage_snapshots').all();
    expect(rows.length).toBe(1);
  });

  it('recordDailySnapshot upserts on same day (no duplicate)', () => {
    insertProvider(randomUUID());

    analyticsService.recordDailySnapshot();
    analyticsService.recordDailySnapshot();

    const rows = db.prepare('SELECT * FROM usage_snapshots').all();
    expect(rows.length).toBe(1);
  });

  it('getStorageTrend returns data with seeded snapshots', () => {
    // Insert snapshots manually for past days
    const today = new Date();
    for (let i = 3; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      db.prepare(`
        INSERT INTO usage_snapshots (snapshot_date, total_providers, online_providers, total_storage_bytes, used_storage_bytes, active_contracts, new_contracts_today, total_escrowed, avg_price_per_gb)
        VALUES (?, 5, 3, 100000000, 50000000, 10, 2, '1000', '0.005')
      `).run(dateStr);
    }

    const trend = analyticsService.getStorageTrend(7);
    expect(trend.length).toBe(4);
    expect(trend[0].total_bytes).toBe(100000000);
    expect(trend[0].used_bytes).toBe(50000000);
  });

  it('getContractTrend returns correct shape', () => {
    const dateStr = new Date().toISOString().slice(0, 10);
    db.prepare(`
      INSERT INTO usage_snapshots (snapshot_date, total_providers, online_providers, total_storage_bytes, used_storage_bytes, active_contracts, new_contracts_today, total_escrowed, avg_price_per_gb)
      VALUES (?, 5, 3, 100000000, 50000000, 10, 2, '1000', '0.005')
    `).run(dateStr);

    const trend = analyticsService.getContractTrend(7);
    expect(trend.length).toBe(1);
    expect(trend[0].active).toBe(10);
    expect(trend[0].new_today).toBe(2);
  });

  it('getProviderGrowth returns correct shape', () => {
    const dateStr = new Date().toISOString().slice(0, 10);
    db.prepare(`
      INSERT INTO usage_snapshots (snapshot_date, total_providers, online_providers, total_storage_bytes, used_storage_bytes, active_contracts, new_contracts_today, total_escrowed, avg_price_per_gb)
      VALUES (?, 5, 3, 100000000, 50000000, 10, 2, '1000', '0.005')
    `).run(dateStr);

    const trend = analyticsService.getProviderGrowth(7);
    expect(trend.length).toBe(1);
    expect(trend[0].total).toBe(5);
    expect(trend[0].online).toBe(3);
  });

  it('getPriceTrend returns avg_price', () => {
    const dateStr = new Date().toISOString().slice(0, 10);
    db.prepare(`
      INSERT INTO usage_snapshots (snapshot_date, total_providers, online_providers, total_storage_bytes, used_storage_bytes, active_contracts, new_contracts_today, total_escrowed, avg_price_per_gb)
      VALUES (?, 5, 3, 100000000, 50000000, 10, 2, '1000', '0.005000')
    `).run(dateStr);

    const trend = analyticsService.getPriceTrend(7);
    expect(trend.length).toBe(1);
    expect(trend[0].avg_price).toBe('0.005000');
  });

  it('snapshot captures actual provider and contract data', () => {
    const pid = randomUUID();
    insertProvider(pid);

    // Create an active contract
    db.prepare(`
      INSERT INTO storage_contracts (id, client_id, provider_id, price_per_gb_month, duration_months, status, total_escrowed)
      VALUES (?, ?, ?, '0.005', 12, 'active', '5000')
    `).run(randomUUID(), randomUUID(), pid);

    analyticsService.recordDailySnapshot();

    const row = db.prepare('SELECT * FROM usage_snapshots').get() as {
      total_providers: number;
      online_providers: number;
      active_contracts: number;
      total_escrowed: string;
    };
    expect(row.total_providers).toBe(1);
    expect(row.online_providers).toBe(1);
    expect(row.active_contracts).toBe(1);
    expect(parseFloat(row.total_escrowed)).toBe(5000);
  });
});

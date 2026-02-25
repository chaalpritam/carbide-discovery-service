import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase } from '../../src/database/index.js';
import { AnalyticsService } from '../../src/services/analytics-service.js';
import { randomUUID } from 'node:crypto';

function insertProvider(db: Database.Database, id?: string) {
  const pid = id ?? randomUUID();
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
      1000000, 5000000, '0.005',
      ?, '{}',
      '0.7', '0.8', '0.9', '0.6', '0.7', '0.5',
      0, ?,
      ?, ?, 'Healthy',
      0, 0.1, 1000000, 0
    )`,
  ).run(pid, `provider-${pid.slice(0, 8)}`, `http://localhost:${3000 + Math.floor(Math.random() * 1000)}`, now, now, now, now);
  return pid;
}

function insertContract(
  db: Database.Database,
  providerId: string,
  overrides: { status?: string; total_escrowed?: string; total_released?: string } = {},
) {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO storage_contracts (id, provider_id, client_id, price_per_gb_month, duration_months, status, total_escrowed, total_released)
     VALUES (?, ?, ?, '0.005', 1, ?, ?, ?)`
  ).run(
    id,
    providerId,
    randomUUID(),
    overrides.status ?? 'active',
    overrides.total_escrowed ?? '10.00',
    overrides.total_released ?? '0',
  );
  return id;
}

describe('AnalyticsService', () => {
  let db: Database.Database;
  let service: AnalyticsService;
  let providerId: string;

  beforeEach(() => {
    db = initDatabase(':memory:');
    service = new AnalyticsService(db);
    providerId = insertProvider(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('getProviderEarnings', () => {
    it('should return null when no contracts exist', () => {
      const earnings = service.getProviderEarnings(randomUUID());
      expect(earnings).toBeNull();
    });

    it('should aggregate earnings from contracts', () => {
      insertContract(db, providerId, { status: 'active', total_escrowed: '10.00', total_released: '3.00' });
      insertContract(db, providerId, { status: 'completed', total_escrowed: '5.00', total_released: '5.00' });

      const earnings = service.getProviderEarnings(providerId);
      expect(earnings).not.toBeNull();
      expect(earnings!.total_escrowed).toBeCloseTo(15.0, 2);
      expect(earnings!.total_released).toBeCloseTo(8.0, 2);
      expect(earnings!.active_contracts).toBe(1);
      expect(earnings!.completed_contracts).toBe(1);
      expect(earnings!.total_contracts).toBe(2);
    });
  });

  describe('getProviderPerformance', () => {
    it('should return null for non-existent provider', () => {
      const perf = service.getProviderPerformance(randomUUID());
      expect(perf).toBeNull();
    });

    it('should return performance metrics', () => {
      const perf = service.getProviderPerformance(providerId);
      expect(perf).not.toBeNull();
      expect(perf!.provider_id).toBe(providerId);
      expect(perf!.reputation_overall).toBeCloseTo(0.7, 2);
      expect(perf!.uptime_score).toBeCloseTo(0.8, 2);
    });

    it('should calculate proof success rate from proof_log', () => {
      const contractId = insertContract(db, providerId);

      // Insert proof log entries
      db.prepare(
        `INSERT INTO proof_log (contract_id, challenge_id, is_valid) VALUES (?, ?, ?)`
      ).run(contractId, randomUUID(), 1);
      db.prepare(
        `INSERT INTO proof_log (contract_id, challenge_id, is_valid) VALUES (?, ?, ?)`
      ).run(contractId, randomUUID(), 1);
      db.prepare(
        `INSERT INTO proof_log (contract_id, challenge_id, is_valid) VALUES (?, ?, ?)`
      ).run(contractId, randomUUID(), 0);

      const perf = service.getProviderPerformance(providerId);
      expect(perf!.proof_success_rate).toBeCloseTo(2 / 3, 2);
      expect(perf!.total_proofs).toBe(3);
    });

    it('should calculate avg response time from reputation events', () => {
      db.prepare(
        `INSERT INTO reputation_events (id, provider_id, event_type, severity, value)
         VALUES (?, ?, 'proof_success', 'positive', ?)`
      ).run(randomUUID(), providerId, 100);
      db.prepare(
        `INSERT INTO reputation_events (id, provider_id, event_type, severity, value)
         VALUES (?, ?, 'upload_success', 'positive', ?)`
      ).run(randomUUID(), providerId, 200);

      const perf = service.getProviderPerformance(providerId);
      expect(perf!.avg_response_time_ms).toBeCloseTo(150, 0);
    });
  });

  describe('getEarningsTimeseries', () => {
    it('should return empty array when no payment events', () => {
      const ts = service.getEarningsTimeseries(providerId);
      expect(ts).toEqual([]);
    });

    it('should aggregate earnings by day', () => {
      const contractId = insertContract(db, providerId);

      // Insert payment release events
      db.prepare(
        `INSERT INTO payment_events (contract_id, event_type, amount, created_at)
         VALUES (?, 'release', '2.00', datetime('now'))`
      ).run(contractId);
      db.prepare(
        `INSERT INTO payment_events (contract_id, event_type, amount, created_at)
         VALUES (?, 'release', '3.00', datetime('now'))`
      ).run(contractId);

      const ts = service.getEarningsTimeseries(providerId, 7);
      expect(ts.length).toBeGreaterThanOrEqual(1);
      expect(ts[0].amount).toBeCloseTo(5.0, 2);
      expect(ts[0].events).toBe(2);
    });
  });

  describe('getMarketplaceOverview', () => {
    it('should return marketplace-wide stats', () => {
      insertContract(db, providerId, { status: 'active', total_escrowed: '20.00', total_released: '5.00' });
      insertContract(db, providerId, { status: 'completed', total_escrowed: '10.00', total_released: '10.00' });

      // Insert a dispute
      db.prepare(
        `INSERT INTO disputes (id, contract_id, raised_by, reason) VALUES (?, ?, 'client', 'test')`
      ).run(randomUUID(), insertContract(db, providerId));

      const overview = service.getMarketplaceOverview();
      expect(overview.total_value_locked).toBeCloseTo(40.0, 2);
      expect(overview.total_earnings).toBeCloseTo(15.0, 2);
      expect(overview.active_contracts).toBe(2);
      expect(overview.total_contracts).toBe(3);
      expect(overview.total_providers).toBeGreaterThanOrEqual(1);
      expect(overview.total_disputes).toBe(1);
    });

    it('should return zeros with no data', () => {
      const overview = service.getMarketplaceOverview();
      expect(overview.total_value_locked).toBe(0);
      expect(overview.total_earnings).toBe(0);
      expect(overview.active_contracts).toBe(0);
    });
  });
});

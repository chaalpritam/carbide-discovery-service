import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase } from '../../src/database/index.js';
import { PricingService } from '../../src/services/pricing-service.js';
import { randomUUID } from 'node:crypto';

function insertProvider(
  db: Database.Database,
  overrides: { price?: string; rep_overall?: string; available_capacity?: number; total_capacity?: number } = {},
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
      ?, ?, ?,
      ?, '{}',
      ?, '0.5', '0.5', '0.5', '0.5', '0.5',
      0, ?,
      ?, ?, 'Healthy',
      0, 0.1, ?, 0
    )`,
  ).run(
    id,
    `provider-${id.slice(0, 8)}`,
    `http://localhost:${3000 + Math.floor(Math.random() * 1000)}`,
    overrides.available_capacity ?? 1000000,
    overrides.total_capacity ?? 5000000,
    overrides.price ?? '0.005',
    now,
    overrides.rep_overall ?? '0.5',
    now,
    now,
    now,
    overrides.available_capacity ?? 1000000,
  );
  return id;
}

describe('PricingService', () => {
  let db: Database.Database;
  let service: PricingService;

  beforeEach(() => {
    db = initDatabase(':memory:');
    service = new PricingService(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('calculateMarketPrice', () => {
    it('should return zeros when no providers exist', () => {
      const market = service.calculateMarketPrice();
      expect(market.active_providers).toBe(0);
      expect(market.median_price).toBe(0);
    });

    it('should calculate median for odd number of providers', () => {
      insertProvider(db, { price: '0.003' });
      insertProvider(db, { price: '0.005' });
      insertProvider(db, { price: '0.010' });

      const market = service.calculateMarketPrice();
      expect(market.median_price).toBeCloseTo(0.005, 4);
      expect(market.min_price).toBeCloseTo(0.003, 4);
      expect(market.max_price).toBeCloseTo(0.010, 4);
      expect(market.active_providers).toBe(3);
    });

    it('should calculate median for even number of providers', () => {
      insertProvider(db, { price: '0.004' });
      insertProvider(db, { price: '0.006' });

      const market = service.calculateMarketPrice();
      expect(market.median_price).toBeCloseTo(0.005, 4);
    });

    it('should compute floor and ceiling from median', () => {
      insertProvider(db, { price: '0.005' });
      insertProvider(db, { price: '0.010' });
      insertProvider(db, { price: '0.015' });

      const market = service.calculateMarketPrice();
      // median = 0.010, floor = median * 0.8 = 0.008, ceiling = median * 1.5 = 0.015
      expect(market.floor_price).toBeCloseTo(0.008, 4);
      expect(market.ceiling_price).toBeCloseTo(0.015, 4);
    });

    it('should compute supply ratio', () => {
      insertProvider(db, { available_capacity: 500000, total_capacity: 1000000 });
      insertProvider(db, { available_capacity: 250000, total_capacity: 1000000 });

      const market = service.calculateMarketPrice();
      // supply = 750000 / 2000000 = 0.375
      expect(market.supply_ratio).toBeCloseTo(0.375, 3);
    });
  });

  describe('getRecommendation', () => {
    it('should return null for non-existent provider', () => {
      const rec = service.getRecommendation(randomUUID());
      expect(rec).toBeNull();
    });

    it('should recommend price at market median for average provider', () => {
      insertProvider(db, { price: '0.005' });
      insertProvider(db, { price: '0.010' });
      const id = insertProvider(db, { price: '0.008', rep_overall: '0.5' });

      const rec = service.getRecommendation(id);
      expect(rec).not.toBeNull();
      expect(rec!.provider_id).toBe(id);
      expect(rec!.current_price).toBeCloseTo(0.008, 4);
      // median = 0.008, rep multiplier = 1 + (0.5 - 0.5) * 0.2 = 1.0
      expect(rec!.recommended_price).toBeCloseTo(0.008, 4);
      expect(rec!.position).toBe('at');
    });

    it('should recommend higher price for high-reputation provider', () => {
      insertProvider(db, { price: '0.005' });
      insertProvider(db, { price: '0.010' });
      const id = insertProvider(db, { price: '0.005', rep_overall: '0.9' });

      const rec = service.getRecommendation(id);
      expect(rec).not.toBeNull();
      // median ≈ 0.005, rep multiplier = 1 + (0.9 - 0.5) * 0.2 = 1.08
      expect(rec!.recommended_price).toBeGreaterThan(rec!.market_median);
    });

    it('should classify provider as below market', () => {
      insertProvider(db, { price: '0.010' });
      insertProvider(db, { price: '0.012' });
      const id = insertProvider(db, { price: '0.002' });

      const rec = service.getRecommendation(id);
      expect(rec!.position).toBe('below');
      expect(rec!.adjustment_pct).toBeLessThan(-5);
    });
  });

  describe('getPriceDistribution', () => {
    it('should return empty array when no providers', () => {
      const dist = service.getPriceDistribution();
      expect(dist).toEqual([]);
    });

    it('should return single bucket when all same price', () => {
      insertProvider(db, { price: '0.005' });
      insertProvider(db, { price: '0.005' });

      const dist = service.getPriceDistribution(3);
      expect(dist).toHaveLength(1);
      expect(dist[0].count).toBe(2);
    });

    it('should distribute providers across buckets', () => {
      insertProvider(db, { price: '0.002' });
      insertProvider(db, { price: '0.004' });
      insertProvider(db, { price: '0.006' });
      insertProvider(db, { price: '0.008' });
      insertProvider(db, { price: '0.010' });

      const dist = service.getPriceDistribution(4);
      expect(dist).toHaveLength(4);

      const totalCount = dist.reduce((sum, b) => sum + b.count, 0);
      expect(totalCount).toBe(5);
    });
  });
});

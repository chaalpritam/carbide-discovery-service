import type Database from 'better-sqlite3';

export interface MarketPrice {
  median_price: number;
  min_price: number;
  max_price: number;
  floor_price: number;
  ceiling_price: number;
  active_providers: number;
  supply_ratio: number;
}

export interface PriceRecommendation {
  provider_id: string;
  current_price: number;
  recommended_price: number;
  market_median: number;
  position: 'below' | 'at' | 'above';
  adjustment_pct: number;
}

export interface PriceBucket {
  range_start: number;
  range_end: number;
  count: number;
}

export class PricingService {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  calculateMarketPrice(): MarketPrice {
    const rows = this.db.prepare(
      `SELECT CAST(price_per_gb_month AS REAL) as price
       FROM providers
       WHERE health_status = 'Healthy'
       ORDER BY price ASC`
    ).all() as { price: number }[];

    if (rows.length === 0) {
      return {
        median_price: 0,
        min_price: 0,
        max_price: 0,
        floor_price: 0,
        ceiling_price: 0,
        active_providers: 0,
        supply_ratio: 0,
      };
    }

    const prices = rows.map(r => r.price);
    const mid = Math.floor(prices.length / 2);
    const median = prices.length % 2 === 0
      ? (prices[mid - 1] + prices[mid]) / 2
      : prices[mid];

    const min = prices[0];
    const max = prices[prices.length - 1];

    // Floor: 20% below median, Ceiling: 50% above median
    const floor = Math.max(min, median * 0.8);
    const ceiling = median * 1.5;

    // Supply ratio: available capacity / total capacity
    const capacityRow = this.db.prepare(
      `SELECT COALESCE(SUM(available_capacity), 0) as available,
              COALESCE(SUM(total_capacity), 1) as total
       FROM providers WHERE health_status = 'Healthy'`
    ).get() as { available: number; total: number };

    const supplyRatio = capacityRow.total > 0
      ? capacityRow.available / capacityRow.total
      : 0;

    return {
      median_price: median,
      min_price: min,
      max_price: max,
      floor_price: floor,
      ceiling_price: ceiling,
      active_providers: rows.length,
      supply_ratio: supplyRatio,
    };
  }

  getRecommendation(providerId: string): PriceRecommendation | null {
    const row = this.db.prepare(
      `SELECT id, CAST(price_per_gb_month AS REAL) as price,
              CAST(rep_overall AS REAL) as reputation
       FROM providers WHERE id = ?`
    ).get(providerId) as { id: string; price: number; reputation: number } | undefined;

    if (!row) return null;

    const market = this.calculateMarketPrice();
    if (market.active_providers === 0) return null;

    const currentPrice = row.price;
    const median = market.median_price;

    // Providers with high reputation can charge more
    const reputationMultiplier = 1 + (row.reputation - 0.5) * 0.2;
    const recommended = median * reputationMultiplier;

    const diff = currentPrice - median;
    const absPct = median > 0 ? (diff / median) * 100 : 0;

    let position: 'below' | 'at' | 'above';
    if (absPct < -5) position = 'below';
    else if (absPct > 5) position = 'above';
    else position = 'at';

    return {
      provider_id: providerId,
      current_price: currentPrice,
      recommended_price: parseFloat(recommended.toFixed(6)),
      market_median: median,
      position,
      adjustment_pct: parseFloat(absPct.toFixed(2)),
    };
  }

  getPriceDistribution(buckets: number = 5): PriceBucket[] {
    const rows = this.db.prepare(
      `SELECT CAST(price_per_gb_month AS REAL) as price
       FROM providers
       WHERE health_status = 'Healthy'
       ORDER BY price ASC`
    ).all() as { price: number }[];

    if (rows.length === 0) return [];

    const prices = rows.map(r => r.price);
    const min = prices[0];
    const max = prices[prices.length - 1];
    const range = max - min;

    if (range === 0) {
      return [{
        range_start: min,
        range_end: max,
        count: prices.length,
      }];
    }

    const bucketSize = range / buckets;
    const result: PriceBucket[] = [];

    for (let i = 0; i < buckets; i++) {
      const start = min + i * bucketSize;
      const end = i === buckets - 1 ? max + 0.000001 : min + (i + 1) * bucketSize;
      const count = prices.filter(p => p >= start && p < end).length;
      result.push({
        range_start: parseFloat(start.toFixed(6)),
        range_end: parseFloat(end.toFixed(6)),
        count,
      });
    }

    return result;
  }
}

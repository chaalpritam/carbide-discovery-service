import type Database from 'better-sqlite3';

export interface ProviderEarnings {
  provider_id: string;
  total_escrowed: number;
  total_released: number;
  active_contracts: number;
  completed_contracts: number;
  total_contracts: number;
}

export interface ProviderPerformance {
  provider_id: string;
  proof_success_rate: number;
  total_proofs: number;
  avg_response_time_ms: number;
  uptime_score: number;
  reputation_overall: number;
}

export interface EarningsBucket {
  date: string;
  amount: number;
  events: number;
}

export interface MarketplaceOverview {
  total_value_locked: number;
  total_earnings: number;
  active_contracts: number;
  total_contracts: number;
  total_providers: number;
  total_disputes: number;
}

export class AnalyticsService {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  getProviderEarnings(providerId: string): ProviderEarnings | null {
    const row = this.db.prepare(
      `SELECT
         ? as provider_id,
         COALESCE(SUM(CAST(total_escrowed AS REAL)), 0) as total_escrowed,
         COALESCE(SUM(CAST(total_released AS REAL)), 0) as total_released,
         COUNT(*) as total_contracts,
         COUNT(CASE WHEN status = 'active' THEN 1 END) as active_contracts,
         COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_contracts
       FROM storage_contracts
       WHERE provider_id = ?`
    ).get(providerId, providerId) as {
      provider_id: string;
      total_escrowed: number;
      total_released: number;
      total_contracts: number;
      active_contracts: number;
      completed_contracts: number;
    } | undefined;

    if (!row || row.total_contracts === 0) return null;

    return {
      provider_id: row.provider_id,
      total_escrowed: row.total_escrowed,
      total_released: row.total_released,
      active_contracts: row.active_contracts,
      completed_contracts: row.completed_contracts,
      total_contracts: row.total_contracts,
    };
  }

  getProviderPerformance(providerId: string): ProviderPerformance | null {
    // Get proof stats from proof_log
    const proofStats = this.db.prepare(
      `SELECT
         COUNT(*) as total,
         COUNT(CASE WHEN is_valid = 1 THEN 1 END) as successes
       FROM proof_log
       WHERE contract_id IN (SELECT id FROM storage_contracts WHERE provider_id = ?)`
    ).get(providerId) as { total: number; successes: number };

    // Get reputation scores from provider
    const provider = this.db.prepare(
      `SELECT CAST(rep_overall AS REAL) as rep_overall,
              CAST(rep_uptime AS REAL) as uptime,
              CAST(rep_response_time AS REAL) as response_time
       FROM providers WHERE id = ?`
    ).get(providerId) as { rep_overall: number; uptime: number; response_time: number } | undefined;

    if (!provider) return null;

    // Get avg response time from reputation events
    const responseRow = this.db.prepare(
      `SELECT AVG(value) as avg_ms
       FROM reputation_events
       WHERE provider_id = ? AND event_type IN ('proof_success', 'upload_success', 'download_success') AND value IS NOT NULL`
    ).get(providerId) as { avg_ms: number | null };

    return {
      provider_id: providerId,
      proof_success_rate: proofStats.total > 0 ? proofStats.successes / proofStats.total : 0,
      total_proofs: proofStats.total,
      avg_response_time_ms: responseRow.avg_ms ?? 0,
      uptime_score: provider.uptime,
      reputation_overall: provider.rep_overall,
    };
  }

  getEarningsTimeseries(providerId: string, days: number = 30): EarningsBucket[] {
    const rows = this.db.prepare(
      `SELECT
         DATE(created_at) as date,
         SUM(CAST(amount AS REAL)) as amount,
         COUNT(*) as events
       FROM payment_events
       WHERE contract_id IN (SELECT id FROM storage_contracts WHERE provider_id = ?)
         AND event_type = 'release'
         AND created_at >= datetime('now', ?)
       GROUP BY DATE(created_at)
       ORDER BY date ASC`
    ).all(providerId, `-${days} days`) as { date: string; amount: number; events: number }[];

    return rows.map(r => ({
      date: r.date,
      amount: r.amount,
      events: r.events,
    }));
  }

  getMarketplaceOverview(): MarketplaceOverview {
    const contracts = this.db.prepare(
      `SELECT
         COALESCE(SUM(CAST(total_escrowed AS REAL)), 0) as tvl,
         COALESCE(SUM(CAST(total_released AS REAL)), 0) as total_released,
         COUNT(*) as total,
         COUNT(CASE WHEN status = 'active' THEN 1 END) as active
       FROM storage_contracts`
    ).get() as { tvl: number; total_released: number; total: number; active: number };

    const providers = this.db.prepare(
      `SELECT COUNT(*) as count FROM providers`
    ).get() as { count: number };

    const disputes = this.db.prepare(
      `SELECT COUNT(*) as count FROM disputes`
    ).get() as { count: number };

    return {
      total_value_locked: contracts.tvl,
      total_earnings: contracts.total_released,
      active_contracts: contracts.active,
      total_contracts: contracts.total,
      total_providers: providers.count,
      total_disputes: disputes.count,
    };
  }
}

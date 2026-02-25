import type Database from 'better-sqlite3';
import type { Provider, ProviderListRequest } from '../types/index.js';
import type { User } from '../types/index.js';
import type { RegistryEntry, MarketplaceStats } from '../services/discovery.js';
import { ServiceStatus } from '../types/index.js';
import { ProviderTier, Region } from '../types/index.js';

/** Row shape returned from the providers table */
interface ProviderRow {
  id: string;
  name: string;
  tier: string;
  region: string;
  endpoint: string;
  available_capacity: number;
  total_capacity: number;
  price_per_gb_month: string;
  last_seen: string;
  metadata: string;
  rep_overall: string;
  rep_uptime: string;
  rep_data_integrity: string;
  rep_response_time: string;
  rep_contract_compliance: string;
  rep_community_feedback: string;
  rep_contracts_completed: number;
  rep_last_updated: string;
  registered_at: string;
  last_heartbeat: string;
  health_status: string;
  failed_health_checks: number;
  current_load: number | null;
  available_storage: number | null;
  active_contracts: number;
}

function rowToProvider(row: ProviderRow): Provider {
  return {
    id: row.id,
    name: row.name,
    tier: row.tier as ProviderTier,
    region: row.region as Region,
    endpoint: row.endpoint,
    available_capacity: row.available_capacity,
    total_capacity: row.total_capacity,
    price_per_gb_month: row.price_per_gb_month,
    last_seen: row.last_seen,
    metadata: JSON.parse(row.metadata),
    reputation: {
      overall: row.rep_overall,
      uptime: row.rep_uptime,
      data_integrity: row.rep_data_integrity,
      response_time: row.rep_response_time,
      contract_compliance: row.rep_contract_compliance,
      community_feedback: row.rep_community_feedback,
      contracts_completed: row.rep_contracts_completed,
      last_updated: row.rep_last_updated,
    },
  };
}

function rowToRegistryEntry(row: ProviderRow): RegistryEntry {
  return {
    provider: rowToProvider(row),
    registered_at: new Date(row.registered_at),
    last_heartbeat: new Date(row.last_heartbeat),
    health_status: row.health_status as ServiceStatus,
    failed_health_checks: row.failed_health_checks,
    current_load: row.current_load,
    available_storage: row.available_storage,
    active_contracts: row.active_contracts,
  };
}

export class ProviderQueries {
  private db: Database.Database;

  // Prepared statements (lazily initialized)
  private _insertStmt: Database.Statement | null = null;
  private _getByIdStmt: Database.Statement | null = null;
  private _deleteStmt: Database.Statement | null = null;
  private _updateHeartbeatStmt: Database.Statement | null = null;
  private _getAllStmt: Database.Statement | null = null;
  private _countStmt: Database.Statement | null = null;

  constructor(db: Database.Database) {
    this.db = db;
  }

  private get insertStmt(): Database.Statement {
    if (!this._insertStmt) {
      this._insertStmt = this.db.prepare(`
        INSERT OR REPLACE INTO providers (
          id, name, tier, region, endpoint,
          available_capacity, total_capacity, price_per_gb_month,
          last_seen, metadata,
          rep_overall, rep_uptime, rep_data_integrity,
          rep_response_time, rep_contract_compliance, rep_community_feedback,
          rep_contracts_completed, rep_last_updated,
          registered_at, last_heartbeat, health_status,
          failed_health_checks, current_load, available_storage, active_contracts
        ) VALUES (
          @id, @name, @tier, @region, @endpoint,
          @available_capacity, @total_capacity, @price_per_gb_month,
          @last_seen, @metadata,
          @rep_overall, @rep_uptime, @rep_data_integrity,
          @rep_response_time, @rep_contract_compliance, @rep_community_feedback,
          @rep_contracts_completed, @rep_last_updated,
          @registered_at, @last_heartbeat, @health_status,
          @failed_health_checks, @current_load, @available_storage, @active_contracts
        )
      `);
    }
    return this._insertStmt;
  }

  private get getByIdStmt(): Database.Statement {
    if (!this._getByIdStmt) {
      this._getByIdStmt = this.db.prepare('SELECT * FROM providers WHERE id = ?');
    }
    return this._getByIdStmt;
  }

  private get deleteStmt(): Database.Statement {
    if (!this._deleteStmt) {
      this._deleteStmt = this.db.prepare('DELETE FROM providers WHERE id = ?');
    }
    return this._deleteStmt;
  }

  private get updateHeartbeatStmt(): Database.Statement {
    if (!this._updateHeartbeatStmt) {
      this._updateHeartbeatStmt = this.db.prepare(`
        UPDATE providers SET
          last_heartbeat = @last_heartbeat,
          health_status = @health_status,
          current_load = @current_load,
          available_storage = @available_storage,
          failed_health_checks = @failed_health_checks
        WHERE id = @id
      `);
    }
    return this._updateHeartbeatStmt;
  }

  private get getAllStmt(): Database.Statement {
    if (!this._getAllStmt) {
      this._getAllStmt = this.db.prepare('SELECT * FROM providers');
    }
    return this._getAllStmt;
  }

  private get countStmt(): Database.Statement {
    if (!this._countStmt) {
      this._countStmt = this.db.prepare('SELECT COUNT(*) as count FROM providers');
    }
    return this._countStmt;
  }

  upsertProvider(entry: RegistryEntry): void {
    const p = entry.provider;
    this.insertStmt.run({
      id: p.id,
      name: p.name,
      tier: p.tier,
      region: p.region,
      endpoint: p.endpoint,
      available_capacity: p.available_capacity,
      total_capacity: p.total_capacity,
      price_per_gb_month: p.price_per_gb_month,
      last_seen: p.last_seen,
      metadata: JSON.stringify(p.metadata),
      rep_overall: p.reputation.overall,
      rep_uptime: p.reputation.uptime,
      rep_data_integrity: p.reputation.data_integrity,
      rep_response_time: p.reputation.response_time,
      rep_contract_compliance: p.reputation.contract_compliance,
      rep_community_feedback: p.reputation.community_feedback,
      rep_contracts_completed: p.reputation.contracts_completed,
      rep_last_updated: p.reputation.last_updated,
      registered_at: entry.registered_at.toISOString(),
      last_heartbeat: entry.last_heartbeat.toISOString(),
      health_status: entry.health_status,
      failed_health_checks: entry.failed_health_checks,
      current_load: entry.current_load,
      available_storage: entry.available_storage,
      active_contracts: entry.active_contracts,
    });
  }

  getProvider(id: string): Provider | null {
    const row = this.getByIdStmt.get(id) as ProviderRow | undefined;
    return row ? rowToProvider(row) : null;
  }

  getEntry(id: string): RegistryEntry | null {
    const row = this.getByIdStmt.get(id) as ProviderRow | undefined;
    return row ? rowToRegistryEntry(row) : null;
  }

  deleteProvider(id: string): boolean {
    const result = this.deleteStmt.run(id);
    return result.changes > 0;
  }

  updateHeartbeat(
    id: string,
    heartbeat: Date,
    healthStatus: ServiceStatus,
    currentLoad: number | null,
    availableStorage: number | null,
    failedHealthChecks: number
  ): boolean {
    const result = this.updateHeartbeatStmt.run({
      id,
      last_heartbeat: heartbeat.toISOString(),
      health_status: healthStatus,
      current_load: currentLoad,
      available_storage: availableStorage,
      failed_health_checks: failedHealthChecks,
    });
    return result.changes > 0;
  }

  searchProviders(
    request: ProviderListRequest,
    providerTimeout: number,
    maxResults: number
  ): { providers: Provider[]; totalCount: number } {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    // Only return online providers (within timeout)
    const cutoff = new Date(Date.now() - providerTimeout).toISOString();
    conditions.push('last_heartbeat > @cutoff');
    params.cutoff = cutoff;

    if (request.region) {
      conditions.push('region = @region');
      params.region = request.region;
    }

    if (request.tier) {
      conditions.push('tier = @tier');
      params.tier = request.tier;
    }

    if (request.min_reputation) {
      conditions.push('CAST(rep_overall AS REAL) >= @min_reputation');
      params.min_reputation = parseFloat(request.min_reputation);
    }

    const whereClause = conditions.length > 0
      ? 'WHERE ' + conditions.join(' AND ')
      : '';

    const limit = request.limit || maxResults;

    // Get total count
    const countSql = `SELECT COUNT(*) as count FROM providers ${whereClause}`;
    const countRow = this.db.prepare(countSql).get(params) as { count: number };
    const totalCount = countRow.count;

    // Get providers sorted by reputation descending
    const selectSql = `
      SELECT * FROM providers
      ${whereClause}
      ORDER BY CAST(rep_overall AS REAL) DESC
      LIMIT @limit
    `;
    const rows = this.db.prepare(selectSql).all({ ...params, limit }) as ProviderRow[];

    return {
      providers: rows.map(rowToProvider),
      totalCount,
    };
  }

  getAllEntries(): Map<string, RegistryEntry> {
    const rows = this.getAllStmt.all() as ProviderRow[];
    const map = new Map<string, RegistryEntry>();
    for (const row of rows) {
      map.set(row.id, rowToRegistryEntry(row));
    }
    return map;
  }

  getCount(): number {
    const row = this.countStmt.get() as { count: number };
    return row.count;
  }

  // ============================================================
  // File-Provider Mapping Queries
  // ============================================================

  registerFileProvider(fileId: string, providerId: string, fileSize: number | null): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO file_providers (file_id, provider_id, file_size)
      VALUES (?, ?, ?)
    `).run(fileId, providerId, fileSize);
  }

  removeFileProvider(fileId: string, providerId: string): boolean {
    const result = this.db.prepare(
      'DELETE FROM file_providers WHERE file_id = ? AND provider_id = ?'
    ).run(fileId, providerId);
    return result.changes > 0;
  }

  getFileProviders(fileId: string, providerTimeout: number): {
    provider_id: string;
    endpoint: string;
    file_size: number | null;
    stored_at: string;
  }[] {
    const cutoff = new Date(Date.now() - providerTimeout).toISOString();
    return this.db.prepare(`
      SELECT fp.provider_id, p.endpoint, fp.file_size, fp.stored_at
      FROM file_providers fp
      JOIN providers p ON fp.provider_id = p.id
      WHERE fp.file_id = ? AND p.last_heartbeat > ?
      ORDER BY CAST(p.rep_overall AS REAL) DESC
    `).all(fileId, cutoff) as {
      provider_id: string;
      endpoint: string;
      file_size: number | null;
      stored_at: string;
    }[];
  }

  computeStats(providerTimeout: number): MarketplaceStats {
    const cutoff = new Date(Date.now() - providerTimeout).toISOString();
    const row = this.db.prepare(`
      SELECT
        COUNT(*) as total_providers,
        COUNT(CASE WHEN last_heartbeat > ? THEN 1 END) as online_providers,
        COALESCE(SUM(CASE WHEN last_heartbeat > ? THEN total_capacity ELSE 0 END), 0) as total_capacity_bytes,
        COALESCE(SUM(CASE WHEN last_heartbeat > ? THEN available_storage ELSE 0 END), 0) as available_capacity_bytes,
        COALESCE(AVG(CASE WHEN last_heartbeat > ? THEN CAST(price_per_gb_month AS REAL) END), 0) as average_price
      FROM providers
    `).get(cutoff, cutoff, cutoff, cutoff) as {
      total_providers: number;
      online_providers: number;
      total_capacity_bytes: number;
      available_capacity_bytes: number;
      average_price: number;
    };

    return {
      total_providers: row.total_providers,
      online_providers: row.online_providers,
      total_capacity_bytes: row.total_capacity_bytes,
      available_capacity_bytes: row.available_capacity_bytes,
      average_price_per_gb: row.average_price.toFixed(6),
      total_requests: 0, // Tracked in-memory by the service
      last_updated: new Date(),
    };
  }
}

// ============================================================
// User Queries
// ============================================================

interface UserRow {
  id: string;
  wallet_address: string;
  display_name: string | null;
  public_key: string | null;
  created_at: string;
  last_seen: string;
  is_active: number;
  metadata: string;
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    wallet_address: row.wallet_address,
    display_name: row.display_name,
    public_key: row.public_key,
    created_at: row.created_at,
    last_seen: row.last_seen,
    is_active: row.is_active === 1,
    metadata: JSON.parse(row.metadata),
  };
}

export class UserQueries {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  insertUser(user: { id: string; wallet_address: string; display_name?: string; public_key?: string; metadata?: Record<string, string> }): void {
    this.db.prepare(
      `INSERT INTO users (id, wallet_address, display_name, public_key, metadata)
       VALUES (?, ?, ?, ?, ?)`
    ).run(user.id, user.wallet_address, user.display_name ?? null, user.public_key ?? null, JSON.stringify(user.metadata ?? {}));
  }

  getByWallet(walletAddress: string): User | null {
    const row = this.db.prepare('SELECT * FROM users WHERE wallet_address = ?').get(walletAddress) as UserRow | undefined;
    if (!row) return null;
    return rowToUser(row);
  }

  updateUser(walletAddress: string, updates: { display_name?: string; public_key?: string; metadata?: Record<string, string> }): boolean {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (updates.display_name !== undefined) { sets.push('display_name = ?'); values.push(updates.display_name); }
    if (updates.public_key !== undefined) { sets.push('public_key = ?'); values.push(updates.public_key); }
    if (updates.metadata !== undefined) { sets.push('metadata = ?'); values.push(JSON.stringify(updates.metadata)); }
    if (sets.length === 0) return false;
    sets.push("last_seen = datetime('now')");
    values.push(walletAddress);
    const result = this.db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE wallet_address = ?`).run(...values);
    return result.changes > 0;
  }
}

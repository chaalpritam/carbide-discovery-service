import type Database from 'better-sqlite3';

export interface SystemOverview {
  providers: { total: number; online: number; offline: number };
  contracts: { active: number; pending: number; completed: number; failed: number };
  disputes: { open: number; resolved: number };
  system: { db_size_bytes: number; migration_count: number };
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface AuditLogEntry {
  request_id: string;
  method: string;
  path: string;
  status_code: number;
  duration_ms: number;
  client_ip: string;
  created_at: string;
}

export class AdminService {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  getSystemOverview(): SystemOverview {
    const providers = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN health_status = 'Healthy' THEN 1 END) as online,
        COUNT(CASE WHEN health_status != 'Healthy' THEN 1 END) as offline
      FROM providers
    `).get() as { total: number; online: number; offline: number };

    const contracts = this.db.prepare(`
      SELECT
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active,
        COUNT(CASE WHEN status = 'pending_deposit' THEN 1 END) as pending,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
      FROM storage_contracts
    `).get() as { active: number; pending: number; completed: number; failed: number };

    const disputes = this.db.prepare(`
      SELECT
        COUNT(CASE WHEN status = 'open' THEN 1 END) as open,
        COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved
      FROM disputes
    `).get() as { open: number; resolved: number };

    const migrations = this.db.prepare(
      'SELECT COUNT(*) as count FROM _migrations'
    ).get() as { count: number };

    // SQLite page_count * page_size gives approximate DB size
    const pageCount = this.db.pragma('page_count', { simple: true }) as number;
    const pageSize = this.db.pragma('page_size', { simple: true }) as number;
    const dbSizeBytes = (pageCount ?? 0) * (pageSize ?? 4096);

    return {
      providers,
      contracts,
      disputes,
      system: { db_size_bytes: dbSizeBytes, migration_count: migrations.count },
    };
  }

  listAllProviders(opts: { page?: number; limit?: number; sort?: string }): PaginatedResult<unknown> {
    const page = opts.page ?? 1;
    const limit = Math.min(opts.limit ?? 20, 100);
    const offset = (page - 1) * limit;
    const sort = opts.sort === 'reputation' ? 'rep_overall DESC' : 'registered_at DESC';

    const total = (this.db.prepare('SELECT COUNT(*) as count FROM providers').get() as { count: number }).count;

    const data = this.db.prepare(
      `SELECT * FROM providers ORDER BY ${sort} LIMIT ? OFFSET ?`
    ).all(limit, offset);

    return { data, total, page, limit };
  }

  deactivateProvider(providerId: string): void {
    this.db.prepare(
      `UPDATE providers SET health_status = 'Deactivated', last_heartbeat = datetime('now') WHERE id = ?`
    ).run(providerId);
  }

  activateProvider(providerId: string): void {
    this.db.prepare(
      `UPDATE providers SET health_status = 'Healthy', last_heartbeat = datetime('now') WHERE id = ?`
    ).run(providerId);
  }

  queryAuditLog(filters: { since?: string; limit?: number }): AuditLogEntry[] {
    let query = 'SELECT * FROM audit_log WHERE 1=1';
    const params: unknown[] = [];

    if (filters.since) {
      query += ' AND created_at >= ?';
      params.push(filters.since);
    }

    query += ' ORDER BY created_at DESC';

    const limit = Math.min(filters.limit ?? 100, 1000);
    query += ' LIMIT ?';
    params.push(limit);

    return this.db.prepare(query).all(...params) as AuditLogEntry[];
  }
}

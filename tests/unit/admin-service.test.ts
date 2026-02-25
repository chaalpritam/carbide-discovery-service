import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase } from '../../src/database/index.js';
import { AdminService } from '../../src/services/admin-service.js';
import { ContractService } from '../../src/services/contract-service.js';
import { randomUUID } from 'node:crypto';

describe('AdminService', () => {
  let db: Database.Database;
  let adminService: AdminService;
  let contractService: ContractService;

  const insertProvider = (id: string, healthStatus = 'Healthy') => {
    db.prepare(`
      INSERT INTO providers (id, name, tier, region, endpoint, available_capacity, total_capacity,
        price_per_gb_month, last_seen, metadata, rep_overall, rep_uptime, rep_data_integrity,
        rep_response_time, rep_contract_compliance, rep_community_feedback, rep_contracts_completed,
        rep_last_updated, registered_at, last_heartbeat, health_status, failed_health_checks,
        current_load, available_storage, active_contracts)
      VALUES (?, 'test-provider', 'Home', 'NorthAmerica', 'http://localhost:8080', 10000000000,
        25000000000, '0.005', datetime('now'), '{}', '0.5', '0.5', '0.5', '0.5', '0.5', '0.5',
        0, datetime('now'), datetime('now'), datetime('now'), ?, 0, 0.1, 10000000000, 0)
    `).run(id, healthStatus);
  };

  beforeEach(() => {
    db = initDatabase(':memory:');
    adminService = new AdminService(db);
    contractService = new ContractService(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns correct system overview counts', () => {
    const p1 = randomUUID();
    const p2 = randomUUID();
    insertProvider(p1, 'Healthy');
    insertProvider(p2, 'Unhealthy');

    contractService.createContract({
      id: randomUUID(),
      client_id: randomUUID(),
      provider_id: p1,
      price_per_gb_month: '0.005',
      duration_months: 12,
    });

    const overview = adminService.getSystemOverview();

    expect(overview.providers.total).toBe(2);
    expect(overview.providers.online).toBe(1);
    expect(overview.providers.offline).toBe(1);
    expect(overview.contracts.pending).toBe(1);
    expect(overview.system.migration_count).toBeGreaterThan(0);
  });

  it('lists all providers with pagination', () => {
    for (let i = 0; i < 5; i++) {
      insertProvider(randomUUID());
    }

    const page1 = adminService.listAllProviders({ page: 1, limit: 2 });
    expect(page1.data.length).toBe(2);
    expect(page1.total).toBe(5);
    expect(page1.page).toBe(1);
    expect(page1.limit).toBe(2);

    const page3 = adminService.listAllProviders({ page: 3, limit: 2 });
    expect(page3.data.length).toBe(1);
  });

  it('deactivates a provider', () => {
    const id = randomUUID();
    insertProvider(id);

    adminService.deactivateProvider(id);

    const row = db.prepare('SELECT health_status FROM providers WHERE id = ?').get(id) as { health_status: string };
    expect(row.health_status).toBe('Deactivated');
  });

  it('activates a deactivated provider', () => {
    const id = randomUUID();
    insertProvider(id, 'Deactivated');

    adminService.activateProvider(id);

    const row = db.prepare('SELECT health_status FROM providers WHERE id = ?').get(id) as { health_status: string };
    expect(row.health_status).toBe('Healthy');
  });

  it('queries audit log with filters', () => {
    // Insert some audit entries
    db.prepare(
      `INSERT INTO audit_log (request_id, method, path, status_code, duration_ms, client_ip) VALUES (?, ?, ?, ?, ?, ?)`
    ).run('req-1', 'GET', '/api/v1/providers', 200, 10, '127.0.0.1');
    db.prepare(
      `INSERT INTO audit_log (request_id, method, path, status_code, duration_ms, client_ip) VALUES (?, ?, ?, ?, ?, ?)`
    ).run('req-2', 'POST', '/api/v1/contracts', 201, 20, '127.0.0.1');

    const entries = adminService.queryAuditLog({ limit: 10 });
    expect(entries.length).toBe(2);
  });

  it('limits audit log results', () => {
    for (let i = 0; i < 5; i++) {
      db.prepare(
        `INSERT INTO audit_log (request_id, method, path, status_code, duration_ms, client_ip) VALUES (?, 'GET', '/', 200, 1, '127.0.0.1')`
      ).run(`req-${i}`);
    }

    const entries = adminService.queryAuditLog({ limit: 2 });
    expect(entries.length).toBe(2);
  });
});

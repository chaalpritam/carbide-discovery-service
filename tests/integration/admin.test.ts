import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { createTestServer } from '../helpers/server.js';
import { randomUUID } from 'node:crypto';

describe('Admin Routes', () => {
  let server: FastifyInstance;
  let db: Database.Database;

  const insertProvider = (providerId: string, healthStatus = 'Healthy') => {
    db.prepare(`
      INSERT INTO providers (id, name, tier, region, endpoint, available_capacity, total_capacity,
        price_per_gb_month, last_seen, metadata, rep_overall, rep_uptime, rep_data_integrity,
        rep_response_time, rep_contract_compliance, rep_community_feedback, rep_contracts_completed,
        rep_last_updated, registered_at, last_heartbeat, health_status, failed_health_checks,
        current_load, available_storage, active_contracts)
      VALUES (?, 'test-provider', 'Home', 'NorthAmerica', 'http://localhost:8080', 10000000000,
        25000000000, '0.005', datetime('now'), '{}', '0.5', '0.5', '0.5', '0.5', '0.5', '0.5',
        0, datetime('now'), datetime('now'), datetime('now'), ?, 0, 0.1, 10000000000, 0)
    `).run(providerId, healthStatus);
  };

  beforeEach(async () => {
    const result = await createTestServer();
    server = result.server;
    db = result.db;
  });

  afterEach(async () => {
    await server.close();
    db.close();
  });

  it('GET /admin/overview returns system counts', async () => {
    insertProvider(randomUUID());

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/admin/overview',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.providers.total).toBe(1);
    expect(body.providers.online).toBe(1);
    expect(body.system.migration_count).toBeGreaterThan(0);
  });

  it('POST /admin/providers/:id/deactivate sets status', async () => {
    const providerId = randomUUID();
    insertProvider(providerId);

    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/admin/providers/${providerId}/deactivate`,
    });

    expect(response.statusCode).toBe(200);
    const row = db.prepare('SELECT health_status FROM providers WHERE id = ?').get(providerId) as { health_status: string };
    expect(row.health_status).toBe('Deactivated');
  });
});

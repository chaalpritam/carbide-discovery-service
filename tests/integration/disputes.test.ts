import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { createTestServer } from '../helpers/server.js';
import { makeAnnouncement } from '../helpers/fixtures.js';
import { randomUUID } from 'node:crypto';

describe('Dispute Routes', () => {
  let server: FastifyInstance;
  let db: Database.Database;
  let contractId: string;
  let providerId: string;

  beforeAll(async () => {
    ({ server, db } = await createTestServer());

    // Register a provider
    const announcement = makeAnnouncement();
    providerId = announcement.provider.id;
    await server.inject({
      method: 'POST',
      url: '/api/v1/providers',
      payload: announcement,
    });

    // Create a contract
    const clientId = randomUUID();
    const contractRes = await server.inject({
      method: 'POST',
      url: '/api/v1/contracts',
      payload: {
        provider_id: providerId,
        client_id: clientId,
        price_per_gb_month: '0.005',
        duration_months: 1,
      },
    });
    contractId = JSON.parse(contractRes.payload).id;
  });

  afterAll(async () => {
    await server.close();
    db.close();
  });

  describe('POST /api/v1/disputes', () => {
    it('should create a dispute', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/disputes',
        payload: {
          contract_id: contractId,
          raised_by: 'test-client',
          reason: 'Data integrity failure',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.id).toBeDefined();
      expect(body.status).toBe('open');
      expect(body.reason).toBe('Data integrity failure');
    });

    it('should return 400 for missing fields', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/disputes',
        payload: { contract_id: contractId },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/v1/disputes/:id', () => {
    it('should return dispute by ID', async () => {
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/disputes',
        payload: {
          contract_id: contractId,
          raised_by: 'test-client',
          reason: 'Test dispute',
        },
      });
      const disputeId = JSON.parse(createRes.payload).id;

      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/disputes/${disputeId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload).id).toBe(disputeId);
    });

    it('should return 404 for non-existent dispute', async () => {
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/disputes/${randomUUID()}`,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /api/v1/disputes/:id/evidence', () => {
    it('should add evidence to an open dispute', async () => {
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/disputes',
        payload: {
          contract_id: contractId,
          raised_by: 'test-client',
          reason: 'Evidence test',
        },
      });
      const disputeId = JSON.parse(createRes.payload).id;

      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/disputes/${disputeId}/evidence`,
        payload: { evidence: { type: 'screenshot', url: 'http://example.com/img.png' } },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      const evidence = JSON.parse(body.evidence);
      expect(evidence).toHaveLength(1);
    });
  });

  describe('POST /api/v1/disputes/:id/resolve', () => {
    it('should resolve an open dispute', async () => {
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/disputes',
        payload: {
          contract_id: contractId,
          raised_by: 'test-client',
          reason: 'Resolution test',
        },
      });
      const disputeId = JSON.parse(createRes.payload).id;

      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/disputes/${disputeId}/resolve`,
        payload: {
          resolution: 'Full refund',
          provider_amount: '0',
          client_amount: '5.00',
          resolved_by: 'admin',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.status).toBe('resolved');
      expect(body.resolution).toBe('Full refund');
    });
  });

  describe('GET /api/v1/contracts/:contractId/disputes', () => {
    it('should list disputes for a contract', async () => {
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/contracts/${contractId}/disputes`,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.disputes).toBeDefined();
      expect(body.total).toBeGreaterThanOrEqual(0);
    });
  });
});

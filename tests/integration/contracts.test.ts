import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestServer } from '../helpers/server.js';
import { makeAnnouncement } from '../helpers/fixtures.js';
import { randomUUID } from 'node:crypto';

describe('Contract routes', () => {
  let server: FastifyInstance;
  let registeredProviderId: string;

  beforeEach(async () => {
    const ctx = await createTestServer({ AUTH_ENABLED: 'false' });
    server = ctx.server;

    // Register a provider so FK constraints pass when creating contracts
    const announcement = makeAnnouncement();
    registeredProviderId = announcement.provider.id;
    await server.inject({
      method: 'POST',
      url: '/api/v1/providers',
      payload: announcement,
    });
  });

  afterEach(async () => {
    await server.close();
  });

  const makeContractPayload = (overrides: Record<string, unknown> = {}) => ({
    client_id: randomUUID(),
    provider_id: registeredProviderId,
    price_per_gb_month: '0.005',
    duration_months: 12,
    ...overrides,
  });

  describe('POST /api/v1/contracts', () => {
    it('creates a contract and returns 201', async () => {
      const payload = makeContractPayload();
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/contracts',
        payload,
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.client_id).toBe(payload.client_id);
      expect(body.provider_id).toBe(payload.provider_id);
      expect(body.status).toBe('pending_deposit');
      expect(body.id).toBeDefined();
    });

    it('returns 400 with missing required fields', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/contracts',
        payload: { client_id: randomUUID() },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBeDefined();
    });

    it('returns 400 with invalid duration_months', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/contracts',
        payload: makeContractPayload({ duration_months: 0 }),
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/v1/contracts/:id', () => {
    it('returns contract by ID', async () => {
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/contracts',
        payload: makeContractPayload(),
      });
      const contractId = createRes.json().id;

      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/contracts/${contractId}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(contractId);
    });

    it('returns 404 for non-existent contract', async () => {
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/contracts/${randomUUID()}`,
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /api/v1/contracts', () => {
    it('lists all contracts', async () => {
      await server.inject({
        method: 'POST',
        url: '/api/v1/contracts',
        payload: makeContractPayload(),
      });
      await server.inject({
        method: 'POST',
        url: '/api/v1/contracts',
        payload: makeContractPayload(),
      });

      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/contracts',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().contracts.length).toBe(2);
      expect(res.json().total).toBe(2);
    });

    it('filters by client_id', async () => {
      const clientId = randomUUID();
      await server.inject({
        method: 'POST',
        url: '/api/v1/contracts',
        payload: makeContractPayload({ client_id: clientId }),
      });
      await server.inject({
        method: 'POST',
        url: '/api/v1/contracts',
        payload: makeContractPayload(),
      });

      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/contracts?client_id=${clientId}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().contracts.length).toBe(1);
      expect(res.json().contracts[0].client_id).toBe(clientId);
    });
  });

  describe('POST /api/v1/contracts/:id/deposit', () => {
    it('records deposit and activates contract', async () => {
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/contracts',
        payload: makeContractPayload(),
      });
      const contractId = createRes.json().id;

      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/contracts/${contractId}/deposit`,
        payload: { amount: '5000000' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('active');
      expect(res.json().total_escrowed).toBe('5000000');
    });

    it('returns 404 for non-existent contract', async () => {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/contracts/${randomUUID()}/deposit`,
        payload: { amount: '5000000' },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /api/v1/contracts/:id/payments', () => {
    it('returns payment events for a contract', async () => {
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/contracts',
        payload: makeContractPayload(),
      });
      const contractId = createRes.json().id;

      await server.inject({
        method: 'POST',
        url: `/api/v1/contracts/${contractId}/deposit`,
        payload: { amount: '5000000', tx_hash: '0xabc' },
      });

      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/contracts/${contractId}/payments`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().events.length).toBe(1);
      expect(res.json().events[0].event_type).toBe('deposit');
    });
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { createTestServer } from '../helpers/server.js';
import { makeAnnouncement } from '../helpers/fixtures.js';
import { randomUUID } from 'node:crypto';

describe('Proofs routes', () => {
  let server: FastifyInstance;
  let db: Database.Database;
  let registeredProviderId: string;

  beforeEach(async () => {
    const ctx = await createTestServer({ AUTH_ENABLED: 'false' });
    server = ctx.server;
    db = ctx.db;

    // Register a provider
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

  const createActiveContract = async (): Promise<string> => {
    const createRes = await server.inject({
      method: 'POST',
      url: '/api/v1/contracts',
      payload: {
        client_id: randomUUID(),
        provider_id: registeredProviderId,
        price_per_gb_month: '0.005',
        duration_months: 12,
      },
    });
    const contractId = createRes.json().id;

    await server.inject({
      method: 'POST',
      url: `/api/v1/contracts/${contractId}/deposit`,
      payload: { amount: '12000000' },
    });

    return contractId;
  };

  describe('POST /api/v1/contracts/:id/proofs', () => {
    it('returns 200 for a valid proof submission', async () => {
      const contractId = await createActiveContract();

      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/contracts/${contractId}/proofs`,
        payload: {
          challenge_id: 'test-challenge-1',
          response_hash: 'abc123',
          merkle_proofs: [{ chunk_index: 0, chunk_hash: 'aaa' }],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.valid).toBe(true);
      expect(body.period).toBeDefined();
    });

    it('returns 422 for an invalid proof (empty merkle_proofs)', async () => {
      const contractId = await createActiveContract();

      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/contracts/${contractId}/proofs`,
        payload: {
          challenge_id: 'test-challenge-1',
          response_hash: 'abc123',
          merkle_proofs: [],
        },
      });

      // The schema validation requires min 1 merkle_proof, so 400 from Zod
      expect(res.statusCode).toBe(400);
    });

    it('returns 422 for a proof on a non-active contract', async () => {
      // Create contract but don't deposit
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/contracts',
        payload: {
          client_id: randomUUID(),
          provider_id: registeredProviderId,
          price_per_gb_month: '0.005',
          duration_months: 12,
        },
      });
      const contractId = createRes.json().id;

      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/contracts/${contractId}/proofs`,
        payload: {
          challenge_id: 'test-challenge-1',
          response_hash: 'abc123',
          merkle_proofs: [{ chunk_index: 0 }],
        },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().valid).toBe(false);
    });
  });

  describe('GET /api/v1/contracts/:id/proofs', () => {
    it('returns proof history', async () => {
      const contractId = await createActiveContract();

      // Submit two proofs
      await server.inject({
        method: 'POST',
        url: `/api/v1/contracts/${contractId}/proofs`,
        payload: {
          challenge_id: 'challenge-1',
          response_hash: 'hash1',
          merkle_proofs: [{ chunk_index: 0 }],
        },
      });
      await server.inject({
        method: 'POST',
        url: `/api/v1/contracts/${contractId}/proofs`,
        payload: {
          challenge_id: 'challenge-2',
          response_hash: 'hash2',
          merkle_proofs: [{ chunk_index: 1 }],
        },
      });

      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/contracts/${contractId}/proofs`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().proofs.length).toBe(2);
      expect(res.json().total).toBe(2);
    });
  });
});

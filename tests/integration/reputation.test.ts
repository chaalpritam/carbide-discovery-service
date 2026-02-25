import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { createTestServer } from '../helpers/server.js';
import { makeAnnouncement } from '../helpers/fixtures.js';

describe('Reputation Routes', () => {
  let server: FastifyInstance;
  let db: Database.Database;
  let providerId: string;

  beforeAll(async () => {
    ({ server, db } = await createTestServer());

    // Register a provider so FK constraints pass
    const announcement = makeAnnouncement();
    providerId = announcement.provider.id;
    await server.inject({
      method: 'POST',
      url: '/api/v1/providers',
      payload: announcement,
    });
  });

  afterAll(async () => {
    await server.close();
    db.close();
  });

  describe('POST /api/v1/reputation/events', () => {
    it('should record a reputation event', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/reputation/events',
        payload: {
          provider_id: providerId,
          event_type: 'online',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.id).toBeDefined();
      expect(body.provider_id).toBe(providerId);
      expect(body.event_type).toBe('online');
    });

    it('should return 400 for missing provider_id', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/reputation/events',
        payload: {
          event_type: 'online',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('should return 400 for missing event_type', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/reputation/events',
        payload: {
          provider_id: providerId,
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('should accept optional fields', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/reputation/events',
        payload: {
          provider_id: providerId,
          event_type: 'proof_success',
          severity: 'positive',
          value: 120,
          details: { chunks: 3 },
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.severity).toBe('positive');
      expect(body.value).toBe(120);
    });
  });

  describe('GET /api/v1/reputation/:providerId', () => {
    it('should return 404 for non-existent provider', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/reputation/non-existent-id',
      });

      expect(res.statusCode).toBe(404);
    });

    it('should return provider score after recalculation', async () => {
      // Recalculate first to populate rep columns
      await server.inject({
        method: 'POST',
        url: `/api/v1/reputation/${providerId}/recalculate`,
      });

      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/reputation/${providerId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.provider_id).toBe(providerId);
      expect(body.overall).toBeDefined();
      expect(body.uptime).toBeDefined();
      expect(body.total_events).toBeDefined();
    });
  });

  describe('GET /api/v1/reputation/:providerId/events', () => {
    it('should return events for provider', async () => {
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/reputation/${providerId}/events`,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.events).toBeDefined();
      expect(Array.isArray(body.events)).toBe(true);
      expect(body.total).toBeGreaterThanOrEqual(0);
    });

    it('should respect limit query param', async () => {
      // Record a few more events
      for (let i = 0; i < 3; i++) {
        await server.inject({
          method: 'POST',
          url: '/api/v1/reputation/events',
          payload: { provider_id: providerId, event_type: 'online' },
        });
      }

      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/reputation/${providerId}/events?limit=2`,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.events.length).toBeLessThanOrEqual(2);
    });
  });

  describe('POST /api/v1/reputation/:providerId/recalculate', () => {
    it('should recalculate and return updated score', async () => {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/reputation/${providerId}/recalculate`,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.provider_id).toBe(providerId);
      expect(typeof body.overall).toBe('number');
      expect(typeof body.uptime).toBe('number');
      expect(typeof body.data_integrity).toBe('number');
      expect(typeof body.response_time).toBe('number');
      expect(typeof body.contract_compliance).toBe('number');
      expect(typeof body.community_feedback).toBe('number');
      expect(typeof body.total_events).toBe('number');
    });
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestServer } from '../helpers/server.js';
import { makeAnnouncement } from '../helpers/fixtures.js';

describe('Marketplace routes', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    const ctx = await createTestServer({ AUTH_ENABLED: 'false' });
    server = ctx.server;
  });

  afterEach(async () => {
    await server.close();
  });

  it('GET /api/v1/marketplace/search — search providers', async () => {
    const announcement = makeAnnouncement();
    await server.inject({
      method: 'POST',
      url: '/api/v1/providers',
      payload: announcement,
    });

    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/marketplace/search',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.providers).toBeDefined();
    expect(Array.isArray(body.providers)).toBe(true);
  });

  it('GET /api/v1/marketplace/stats — get marketplace stats', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/marketplace/stats',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('total_providers');
    expect(body).toHaveProperty('online_providers');
  });
});

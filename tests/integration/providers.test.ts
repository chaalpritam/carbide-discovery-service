import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestServer } from '../helpers/server.js';
import { makeAnnouncement, makeHealthCheck } from '../helpers/fixtures.js';

describe('Provider routes', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    const ctx = await createTestServer({ AUTH_ENABLED: 'false' });
    server = ctx.server;
  });

  afterEach(async () => {
    await server.close();
  });

  it('POST /api/v1/providers — register a provider', async () => {
    const announcement = makeAnnouncement();
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/providers',
      payload: announcement,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('registered');
  });

  it('GET /api/v1/providers — list providers', async () => {
    const announcement = makeAnnouncement();
    await server.inject({
      method: 'POST',
      url: '/api/v1/providers',
      payload: announcement,
    });

    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/providers',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.providers.length).toBeGreaterThanOrEqual(1);
    expect(body.total_count).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/v1/providers/:id — get a specific provider', async () => {
    const announcement = makeAnnouncement();
    await server.inject({
      method: 'POST',
      url: '/api/v1/providers',
      payload: announcement,
    });

    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/providers/${announcement.provider.id}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(announcement.provider.id);
  });

  it('GET /api/v1/providers/:id — 404 for missing provider', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/providers/00000000-0000-0000-0000-000000000000',
    });

    expect(res.statusCode).toBe(404);
  });

  it('POST /api/v1/providers/:id/heartbeat — update heartbeat', async () => {
    const announcement = makeAnnouncement();
    await server.inject({
      method: 'POST',
      url: '/api/v1/providers',
      payload: announcement,
    });

    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/providers/${announcement.provider.id}/heartbeat`,
      payload: makeHealthCheck(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('updated');
  });

  it('DELETE /api/v1/providers/:id — unregister provider', async () => {
    const announcement = makeAnnouncement();
    await server.inject({
      method: 'POST',
      url: '/api/v1/providers',
      payload: announcement,
    });

    const res = await server.inject({
      method: 'DELETE',
      url: `/api/v1/providers/${announcement.provider.id}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('unregistered');

    // Verify it's gone
    const get = await server.inject({
      method: 'GET',
      url: `/api/v1/providers/${announcement.provider.id}`,
    });
    expect(get.statusCode).toBe(404);
  });
});

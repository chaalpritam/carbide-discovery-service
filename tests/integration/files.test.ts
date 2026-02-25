import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestServer } from '../helpers/server.js';
import { makeAnnouncement } from '../helpers/fixtures.js';

describe('File-provider routes', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    const ctx = await createTestServer({ AUTH_ENABLED: 'false' });
    server = ctx.server;
  });

  afterEach(async () => {
    await server.close();
  });

  it('POST + GET file-provider mapping', async () => {
    const announcement = makeAnnouncement();
    await server.inject({
      method: 'POST',
      url: '/api/v1/providers',
      payload: announcement,
    });

    const fileId = 'c'.repeat(64);

    const postRes = await server.inject({
      method: 'POST',
      url: `/api/v1/files/${fileId}/providers`,
      payload: {
        provider_id: announcement.provider.id,
        file_size: 1024,
      },
    });
    expect(postRes.statusCode).toBe(200);
    expect(postRes.json().status).toBe('registered');

    const getRes = await server.inject({
      method: 'GET',
      url: `/api/v1/files/${fileId}/providers`,
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().providers.length).toBe(1);
  });

  it('DELETE file-provider mapping', async () => {
    const announcement = makeAnnouncement();
    await server.inject({
      method: 'POST',
      url: '/api/v1/providers',
      payload: announcement,
    });

    const fileId = 'd'.repeat(64);
    await server.inject({
      method: 'POST',
      url: `/api/v1/files/${fileId}/providers`,
      payload: {
        provider_id: announcement.provider.id,
      },
    });

    const delRes = await server.inject({
      method: 'DELETE',
      url: `/api/v1/files/${fileId}/providers/${announcement.provider.id}`,
    });
    expect(delRes.statusCode).toBe(200);
    expect(delRes.json().status).toBe('removed');
  });
});

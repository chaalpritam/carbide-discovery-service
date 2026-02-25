import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { createTestServer } from '../helpers/server.js';

describe('Webhook Routes', () => {
  let server: FastifyInstance;
  let db: Database.Database;

  beforeEach(async () => {
    const result = await createTestServer();
    server = result.server;
    db = result.db;
  });

  afterEach(async () => {
    await server.close();
    db.close();
  });

  it('POST /webhooks registers a webhook', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      payload: {
        owner_id: 'owner-1',
        url: 'https://example.com/hook',
        event_types: ['contract.created', 'proof.success'],
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.payload);
    expect(body.owner_id).toBe('owner-1');
    expect(body.url).toBe('https://example.com/hook');
    expect(body.event_types).toEqual(['contract.created', 'proof.success']);
  });

  it('GET /webhooks returns webhooks for owner', async () => {
    await server.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      payload: {
        owner_id: 'owner-1',
        url: 'https://example.com/hook',
        event_types: ['contract.created'],
      },
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/webhooks?owner_id=owner-1',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.webhooks.length).toBe(1);
  });

  it('DELETE /webhooks/:id deactivates webhook', async () => {
    const createResp = await server.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      payload: {
        owner_id: 'owner-1',
        url: 'https://example.com/hook',
        event_types: ['contract.created'],
      },
    });
    const { id } = JSON.parse(createResp.payload);

    const deleteResp = await server.inject({
      method: 'DELETE',
      url: `/api/v1/webhooks/${id}`,
    });
    expect(deleteResp.statusCode).toBe(204);

    const listResp = await server.inject({
      method: 'GET',
      url: '/api/v1/webhooks?owner_id=owner-1',
    });
    const body = JSON.parse(listResp.payload);
    expect(body.webhooks.length).toBe(0);
  });

  it('GET /webhooks/:id/deliveries returns delivery records', async () => {
    const createResp = await server.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      payload: {
        owner_id: 'owner-1',
        url: 'https://example.com/hook',
        event_types: ['contract.created'],
      },
    });
    const { id } = JSON.parse(createResp.payload);

    const deliveriesResp = await server.inject({
      method: 'GET',
      url: `/api/v1/webhooks/${id}/deliveries`,
    });
    expect(deliveriesResp.statusCode).toBe(200);
    const body = JSON.parse(deliveriesResp.payload);
    expect(body.deliveries).toEqual([]);
  });
});

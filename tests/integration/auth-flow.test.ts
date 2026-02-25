import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestServer } from '../helpers/server.js';
import { makeAnnouncement } from '../helpers/fixtures.js';

const AUTH_SECRET = 'test-auth-secret';

describe('Auth flow (auth enabled)', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    const ctx = await createTestServer({
      AUTH_ENABLED: 'true',
      AUTH_SECRET,
    });
    server = ctx.server;
  });

  afterEach(async () => {
    await server.close();
  });

  it('GET /api/v1/health is always public', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/health',
    });
    expect(res.statusCode).toBe(200);
  });

  it('GET /api/v1/providers is public (read-only)', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/providers',
    });
    expect(res.statusCode).toBe(200);
  });

  it('POST /api/v1/providers is rejected without auth', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/providers',
      payload: makeAnnouncement(),
    });
    expect(res.statusCode).toBe(401);
  });

  it('bootstrap → API key → register provider', async () => {
    // Step 1: Bootstrap
    const bootstrapRes = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/bootstrap',
      headers: { 'x-auth-secret': AUTH_SECRET },
    });
    expect(bootstrapRes.statusCode).toBe(200);
    const { api_key } = bootstrapRes.json();
    expect(api_key).toMatch(/^cbk_/);

    // Step 2: Use API key to register a provider
    const registerRes = await server.inject({
      method: 'POST',
      url: '/api/v1/providers',
      headers: { 'x-api-key': api_key },
      payload: makeAnnouncement(),
    });
    expect(registerRes.statusCode).toBe(200);
  });

  it('bootstrap → token exchange → bearer auth on mutation', async () => {
    // Step 1: Bootstrap admin key
    const bootstrapRes = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/bootstrap',
      headers: { 'x-auth-secret': AUTH_SECRET },
    });
    const { api_key } = bootstrapRes.json();

    // Step 2: Exchange for JWT
    const tokenRes = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/token',
      headers: { 'x-api-key': api_key },
    });
    expect(tokenRes.statusCode).toBe(200);
    const { token, token_type } = tokenRes.json();
    expect(token_type).toBe('Bearer');
    expect(token).toBeTruthy();

    // Step 3: Use bearer token for mutation
    const registerRes = await server.inject({
      method: 'POST',
      url: '/api/v1/providers',
      headers: { authorization: `Bearer ${token}` },
      payload: makeAnnouncement(),
    });
    expect(registerRes.statusCode).toBe(200);
  });

  it('admin can create provider keys', async () => {
    // Bootstrap admin key
    const bootstrapRes = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/bootstrap',
      headers: { 'x-auth-secret': AUTH_SECRET },
    });
    const { api_key: adminKey } = bootstrapRes.json();

    // Exchange for JWT
    const tokenRes = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/token',
      headers: { 'x-api-key': adminKey },
    });
    const { token } = tokenRes.json();

    // Create provider key
    const createRes = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/keys',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'my-provider', role: 'provider' },
    });
    expect(createRes.statusCode).toBe(200);
    const body = createRes.json();
    expect(body.role).toBe('provider');
    expect(body.api_key).toMatch(/^cbk_/);

    // Use provider key to register
    const registerRes = await server.inject({
      method: 'POST',
      url: '/api/v1/providers',
      headers: { 'x-api-key': body.api_key },
      payload: makeAnnouncement(),
    });
    expect(registerRes.statusCode).toBe(200);
  });

  it('bootstrap with wrong secret is rejected', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/bootstrap',
      headers: { 'x-auth-secret': 'wrong-secret' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('invalid API key is rejected', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/providers',
      headers: { 'x-api-key': 'cbk_invalid' },
      payload: makeAnnouncement(),
    });
    expect(res.statusCode).toBe(401);
  });
});

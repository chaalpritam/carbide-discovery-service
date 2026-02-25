import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { generateApiKey, createApiKeyQueries, hashApiKey, type AuthContext } from '../middleware/auth.js';
import { signToken } from '../middleware/jwt.js';

export async function authRoutes(
  server: FastifyInstance,
  db: Database.Database,
  authSecret: string,
  jwtSecret: string,
  jwtExpiresIn: string
): Promise<void> {
  const queries = createApiKeyQueries(db);

  // Bootstrap: create the initial admin API key (protected by AUTH_SECRET)
  server.post('/auth/bootstrap', async (request, reply) => {
    const secret = request.headers['x-auth-secret'] as string | undefined;
    if (!secret || secret !== authSecret) {
      return reply.status(403).send({ error: 'Invalid auth secret' });
    }

    const { raw, hash, prefix } = generateApiKey();
    queries.insert('bootstrap-admin', hash, prefix, 'admin');

    return {
      api_key: raw,
      prefix,
      role: 'admin',
      message: 'Store this key securely. It will not be shown again.',
    };
  });

  // Exchange API key for JWT token
  server.post('/auth/token', async (request, reply) => {
    const apiKey = request.headers['x-api-key'] as string | undefined;
    if (!apiKey) {
      return reply.status(401).send({ error: 'Missing X-API-Key header' });
    }

    const hash = hashApiKey(apiKey);
    const key = queries.getByHash(hash);
    if (!key) {
      return reply.status(401).send({ error: 'Invalid API key' });
    }

    if (key.expires_at && new Date(key.expires_at) < new Date()) {
      return reply.status(401).send({ error: 'API key expired' });
    }

    queries.touchLastUsed(key.id);

    const token = signToken(
      { keyId: key.id, role: key.role },
      jwtSecret,
      jwtExpiresIn
    );

    return {
      token,
      token_type: 'Bearer',
      expires_in: jwtExpiresIn,
    };
  });

  // Admin: create a new API key (requires admin role via auth hook)
  server.post('/auth/keys', async (request, reply) => {
    const auth = (request as typeof request & { authContext?: AuthContext }).authContext;
    if (!auth || auth.role !== 'admin') {
      return reply.status(403).send({ error: 'Admin role required' });
    }

    const body = request.body as { name?: string; role?: string; expires_in_days?: number } | null;
    const name = body?.name || 'provider-key';
    const role = body?.role === 'admin' ? 'admin' : 'provider';
    const expiresInDays = body?.expires_in_days;

    let expiresAt: string | undefined;
    if (expiresInDays && expiresInDays > 0) {
      const d = new Date();
      d.setDate(d.getDate() + expiresInDays);
      expiresAt = d.toISOString();
    }

    const { raw, hash, prefix } = generateApiKey();
    queries.insert(name, hash, prefix, role, expiresAt);

    return {
      api_key: raw,
      prefix,
      role,
      name,
      expires_at: expiresAt ?? null,
      message: 'Store this key securely. It will not be shown again.',
    };
  });
}

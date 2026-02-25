import { randomBytes, createHash } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import { createBearerAuthHook } from './jwt.js';

export interface ApiKey {
  id: number;
  name: string;
  key_hash: string;
  key_prefix: string;
  role: 'admin' | 'provider';
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
}

export interface AuthContext {
  keyId: number;
  role: 'admin' | 'provider';
}

const API_KEY_PREFIX = 'cbk_';

export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const bytes = randomBytes(32);
  const raw = API_KEY_PREFIX + bytes.toString('hex');
  const hash = hashApiKey(raw);
  const prefix = raw.substring(0, 8);
  return { raw, hash, prefix };
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function createApiKeyQueries(db: Database.Database) {
  const insertStmt = db.prepare(`
    INSERT INTO api_keys (name, key_hash, key_prefix, role, is_active, expires_at)
    VALUES (?, ?, ?, ?, 1, ?)
  `);

  const getByHashStmt = db.prepare(`
    SELECT * FROM api_keys WHERE key_hash = ? AND is_active = 1
  `);

  const touchStmt = db.prepare(`
    UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?
  `);

  return {
    insert(name: string, hash: string, prefix: string, role: string, expiresAt?: string) {
      return insertStmt.run(name, hash, prefix, role, expiresAt ?? null);
    },
    getByHash(hash: string): ApiKey | undefined {
      return getByHashStmt.get(hash) as ApiKey | undefined;
    },
    touchLastUsed(id: number) {
      touchStmt.run(id);
    },
  };
}

export function createAuthHook(
  db: Database.Database,
  enabled: boolean,
  jwtSecret?: string
) {
  const queries = createApiKeyQueries(db);
  const tryBearer = jwtSecret ? createBearerAuthHook(jwtSecret) : null;

  return async function authHook(request: FastifyRequest, reply: FastifyReply) {
    if (!enabled) return;

    // Public endpoints — always bypass
    const url = request.url;
    if (
      url.startsWith('/api/v1/health') ||
      url.startsWith('/api/v1/auth/bootstrap')
    ) {
      return;
    }

    // GET requests are public (read-only)
    if (request.method === 'GET') return;

    // Try Bearer JWT first
    if (tryBearer && tryBearer(request, reply)) {
      return;
    }

    // Fall back to API key
    const apiKey = request.headers['x-api-key'] as string | undefined;
    if (!apiKey) {
      return reply.status(401).send({ error: 'Missing authentication. Provide Authorization: Bearer <jwt> or X-API-Key header.' });
    }

    if (!apiKey.startsWith(API_KEY_PREFIX)) {
      return reply.status(401).send({ error: 'Invalid API key format' });
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
    (request as FastifyRequest & { authContext: AuthContext }).authContext = {
      keyId: key.id,
      role: key.role as 'admin' | 'provider',
    };
  };
}

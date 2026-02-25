import type { FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import type { AuthContext } from './auth.js';

interface AuditableRequest extends FastifyRequest {
  requestId?: string;
  authContext?: AuthContext;
  _auditStartTime?: bigint;
}

export function createAuditLogger(db: Database.Database) {
  const insertStmt = db.prepare(`
    INSERT INTO audit_log (request_id, method, path, status_code, duration_ms, client_ip, key_id, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  function onRequest(request: FastifyRequest, _reply: FastifyReply, done: () => void) {
    (request as AuditableRequest)._auditStartTime = process.hrtime.bigint();
    done();
  }

  function onResponse(request: FastifyRequest, reply: FastifyReply, done: () => void) {
    const req = request as AuditableRequest;

    // Only audit mutations and errors
    const isError = reply.statusCode >= 400;
    const isMutation = request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS';
    if (!isError && !isMutation) {
      done();
      return;
    }

    const startTime = req._auditStartTime ?? process.hrtime.bigint();
    const durationMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;

    try {
      insertStmt.run(
        req.requestId ?? null,
        request.method,
        request.url,
        reply.statusCode,
        Math.round(durationMs),
        request.ip,
        req.authContext?.keyId ?? null,
        request.headers['user-agent'] ?? null
      );
    } catch {
      // Audit logging should never crash the request
    }

    done();
  }

  return { onRequest, onResponse };
}

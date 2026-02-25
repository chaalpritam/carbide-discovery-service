import { randomUUID } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';

export async function requestIdHook(request: FastifyRequest, reply: FastifyReply) {
  const existing = request.headers['x-request-id'] as string | undefined;
  const requestId = existing || randomUUID();
  (request as FastifyRequest & { requestId: string }).requestId = requestId;
  void reply.header('X-Request-ID', requestId);
}

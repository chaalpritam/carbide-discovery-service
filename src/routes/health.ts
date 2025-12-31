import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ServiceStatus } from '../types/index.js';

/**
 * Health check route plugin
 * Provides service health status
 */
export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/health
   * Discovery service health check
   */
  fastify.get('/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    const health = {
      status: ServiceStatus.Healthy,
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      service: 'carbide-discovery-service'
    };

    return reply.code(200).send(health);
  });
}

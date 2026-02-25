import type { FastifyInstance } from 'fastify';
import { metricsRegistry } from '../middleware/metrics.js';

export async function metricsRoutes(instance: FastifyInstance) {
  instance.get('/metrics', async (_request, reply) => {
    const metrics = await metricsRegistry.metrics();
    reply.header('content-type', metricsRegistry.contentType);
    return metrics;
  });
}

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { DiscoveryService } from '../services/discovery.js';
import {
  ProviderAnnouncementSchema,
  ProviderListRequestSchema,
  HealthCheckResponseSchema
} from '../types/index.js';

/**
 * Provider routes plugin
 * Handles provider registration, listing, and heartbeat updates
 */
export async function providersRoutes(
  fastify: FastifyInstance,
  discoveryService: DiscoveryService
): Promise<void> {
  /**
   * POST /api/v1/providers
   * Register a new provider
   */
  fastify.post('/providers', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const announcement = ProviderAnnouncementSchema.parse(request.body);
      discoveryService.registerProvider(announcement);

      fastify.log.info(`Provider registered: ${announcement.provider.name} (${announcement.provider.id})`);

      return reply.code(200).send({ status: 'registered' });
    } catch (error) {
      fastify.log.error({ err: error }, 'Failed to register provider');
      return reply.code(500).send({ error: 'Registration failed' });
    }
  });

  /**
   * GET /api/v1/providers
   * List providers with optional filters
   */
  fastify.get('/providers', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Parse query parameters
      const query = ProviderListRequestSchema.parse(request.query);
      const response = discoveryService.searchProviders(query);

      return reply.code(200).send(response);
    } catch (error) {
      fastify.log.error({ err: error }, 'Failed to list providers');
      return reply.code(400).send({ error: 'Invalid request parameters' });
    }
  });

  /**
   * GET /api/v1/providers/:id
   * Get a specific provider by ID
   */
  fastify.get<{ Params: { id: string } }>(
    '/providers/:id',
    async (request, reply) => {
      const { id } = request.params;

      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return reply.code(400).send({ error: 'Invalid provider ID format' });
      }

      const provider = discoveryService.getProvider(id);

      if (!provider) {
        return reply.code(404).send({ error: 'Provider not found' });
      }

      return reply.code(200).send(provider);
    }
  );

  /**
   * DELETE /api/v1/providers/:id
   * Unregister a provider
   */
  fastify.delete<{ Params: { id: string } }>(
    '/providers/:id',
    async (request, reply) => {
      const { id } = request.params;

      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return reply.code(400).send({ error: 'Invalid provider ID format' });
      }

      const removed = discoveryService.unregisterProvider(id);

      if (!removed) {
        return reply.code(404).send({ error: 'Provider not found' });
      }

      fastify.log.info(`Provider unregistered: ${id}`);

      return reply.code(200).send({ status: 'unregistered' });
    }
  );

  /**
   * POST /api/v1/providers/:id/heartbeat
   * Update provider heartbeat
   */
  fastify.post<{ Params: { id: string } }>(
    '/providers/:id/heartbeat',
    async (request, reply) => {
      const { id } = request.params;

      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return reply.code(400).send({ error: 'Invalid provider ID format' });
      }

      try {
        const health = HealthCheckResponseSchema.parse(request.body);
        const updated = discoveryService.updateHeartbeat(id, health);

        if (!updated) {
          return reply.code(404).send({ error: 'Provider not found' });
        }

        return reply.code(200).send({ status: 'updated' });
      } catch (error) {
        fastify.log.error({ err: error }, 'Failed to update heartbeat');
        return reply.code(400).send({ error: 'Invalid heartbeat data' });
      }
    }
  );
}

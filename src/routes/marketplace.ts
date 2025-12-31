import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { DiscoveryService } from '../services/discovery.js';
import {
  ProviderListRequestSchema,
  StorageQuoteRequestSchema
} from '../types/index.js';

/**
 * Marketplace routes plugin
 * Handles provider search, quote requests, and statistics
 */
export async function marketplaceRoutes(
  fastify: FastifyInstance,
  discoveryService: DiscoveryService
): Promise<void> {
  /**
   * GET /api/v1/marketplace/search
   * Search for providers (alias for GET /api/v1/providers)
   */
  fastify.get('/marketplace/search', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = ProviderListRequestSchema.parse(request.query);
      const response = discoveryService.searchProviders(query);

      return reply.code(200).send(response);
    } catch (error) {
      fastify.log.error({ err: error }, 'Failed to search providers');
      return reply.code(400).send({ error: 'Invalid search parameters' });
    }
  });

  /**
   * POST /api/v1/marketplace/quotes
   * Request quotes from multiple providers
   */
  fastify.post('/marketplace/quotes', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const quoteRequest = StorageQuoteRequestSchema.parse(request.body);
      const quotes = await discoveryService.requestQuotes(quoteRequest);

      fastify.log.info(`Quote request processed: ${quotes.length} quotes received`);

      return reply.code(200).send(quotes);
    } catch (error) {
      fastify.log.error({ err: error }, 'Failed to request quotes');
      return reply.code(400).send({ error: 'Invalid quote request' });
    }
  });

  /**
   * GET /api/v1/marketplace/stats
   * Get marketplace statistics
   */
  fastify.get('/marketplace/stats', async (_request: FastifyRequest, reply: FastifyReply) => {
    const stats = discoveryService.getMarketplaceStats();

    return reply.code(200).send({
      total_providers: stats.total_providers,
      online_providers: stats.online_providers,
      total_capacity_bytes: stats.total_capacity_bytes,
      available_capacity_bytes: stats.available_capacity_bytes,
      average_price_per_gb: stats.average_price_per_gb,
      total_requests: stats.total_requests,
      last_updated: stats.last_updated.toISOString()
    });
  });
}

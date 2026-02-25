import type { FastifyInstance } from 'fastify';
import type { PricingService } from '../services/pricing-service.js';

export async function pricingRoutes(
  instance: FastifyInstance,
  pricingService: PricingService,
): Promise<void> {
  // Get current market price data
  instance.get('/pricing/market', async (_request, reply) => {
    const market = pricingService.calculateMarketPrice();
    return reply.send(market);
  });

  // Get pricing recommendation for a provider
  instance.get('/pricing/recommend/:providerId', async (request, reply) => {
    const { providerId } = request.params as { providerId: string };
    const recommendation = pricingService.getRecommendation(providerId);
    if (!recommendation) {
      return reply.status(404).send({ error: 'Provider not found or no market data' });
    }
    return reply.send(recommendation);
  });

  // Get price distribution histogram
  instance.get('/pricing/distribution', async (request, reply) => {
    const query = request.query as { buckets?: string };
    const buckets = query.buckets ? parseInt(query.buckets, 10) : 5;
    const distribution = pricingService.getPriceDistribution(buckets);
    return reply.send({ buckets: distribution });
  });
}

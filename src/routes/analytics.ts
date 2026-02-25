import type { FastifyInstance } from 'fastify';
import type { AnalyticsService } from '../services/analytics-service.js';

export async function analyticsRoutes(
  instance: FastifyInstance,
  analyticsService: AnalyticsService,
): Promise<void> {
  // Get provider earnings summary
  instance.get('/analytics/provider/:id/earnings', async (request, reply) => {
    const { id } = request.params as { id: string };
    const earnings = analyticsService.getProviderEarnings(id);
    if (!earnings) {
      return reply.status(404).send({ error: 'No contract data for provider' });
    }
    return reply.send(earnings);
  });

  // Get provider performance metrics
  instance.get('/analytics/provider/:id/performance', async (request, reply) => {
    const { id } = request.params as { id: string };
    const performance = analyticsService.getProviderPerformance(id);
    if (!performance) {
      return reply.status(404).send({ error: 'Provider not found' });
    }
    return reply.send(performance);
  });

  // Get provider earnings timeseries
  instance.get('/analytics/provider/:id/timeseries', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { days?: string };
    const days = query.days ? parseInt(query.days, 10) : 30;
    const timeseries = analyticsService.getEarningsTimeseries(id, days);
    return reply.send({ data: timeseries, days });
  });

  // Get marketplace overview
  instance.get('/analytics/marketplace', async (_request, reply) => {
    const overview = analyticsService.getMarketplaceOverview();
    return reply.send(overview);
  });
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ReputationService } from '../services/reputation-service.js';

const ReputationEventSchema = z.object({
  provider_id: z.string(),
  event_type: z.string(),
  severity: z.string().optional(),
  value: z.number().optional(),
  details: z.record(z.unknown()).optional(),
  contract_id: z.string().optional(),
  file_id: z.string().optional(),
  client_id: z.string().optional(),
});

export async function reputationRoutes(
  instance: FastifyInstance,
  reputationService: ReputationService,
): Promise<void> {
  // Record a reputation event
  instance.post('/reputation/events', async (request, reply) => {
    const parsed = ReputationEventSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid event', details: parsed.error.issues });
    }
    const event = reputationService.recordEvent(parsed.data);
    return reply.status(201).send(event);
  });

  // Get provider reputation score
  instance.get('/reputation/:providerId', async (request, reply) => {
    const { providerId } = request.params as { providerId: string };
    const score = reputationService.getProviderScore(providerId);
    if (!score) {
      return reply.status(404).send({ error: 'Provider not found' });
    }
    return reply.send(score);
  });

  // Get provider reputation events
  instance.get('/reputation/:providerId/events', async (request, reply) => {
    const { providerId } = request.params as { providerId: string };
    const query = request.query as { since?: string; limit?: string };
    const events = reputationService.getProviderEvents(
      providerId,
      query.since,
      query.limit ? parseInt(query.limit, 10) : undefined,
    );
    return reply.send({ events, total: events.length });
  });

  // Recalculate provider reputation score
  instance.post('/reputation/:providerId/recalculate', async (request, reply) => {
    const { providerId } = request.params as { providerId: string };
    const score = reputationService.recalculateScore(providerId);
    return reply.send(score);
  });
}

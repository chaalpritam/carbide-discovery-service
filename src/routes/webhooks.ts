import type { FastifyInstance } from 'fastify';
import { WebhookService } from '../services/webhook-service.js';

export async function webhooksRoutes(
  instance: FastifyInstance,
  webhookService: WebhookService,
): Promise<void> {
  // Register a new webhook
  instance.post('/webhooks', async (request, reply) => {
    const body = request.body as {
      owner_id: string;
      url: string;
      event_types: string[];
      secret?: string;
    };

    if (!body.owner_id || !body.url || !body.event_types?.length) {
      return reply.status(400).send({ error: 'owner_id, url, and event_types are required' });
    }

    const webhook = webhookService.register(body);
    return reply.status(201).send(webhook);
  });

  // List webhooks for an owner
  instance.get('/webhooks', async (request, reply) => {
    const query = request.query as { owner_id?: string };
    if (!query.owner_id) {
      return reply.status(400).send({ error: 'owner_id query parameter is required' });
    }
    const webhooks = webhookService.listForOwner(query.owner_id);
    return reply.send({ webhooks });
  });

  // Delete (deactivate) a webhook
  instance.delete('/webhooks/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    webhookService.unregister(id);
    return reply.status(204).send();
  });

  // Get deliveries for a webhook
  instance.get('/webhooks/:id/deliveries', async (request, reply) => {
    const { id } = request.params as { id: string };
    const deliveries = webhookService.getDeliveries(id);
    return reply.send({ deliveries });
  });
}

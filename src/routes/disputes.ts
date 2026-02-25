import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DisputeService } from '../services/dispute-service.js';

const RaiseDisputeSchema = z.object({
  contract_id: z.string(),
  raised_by: z.string(),
  reason: z.string().min(1),
  evidence: z.array(z.unknown()).optional(),
});

const ResolveDisputeSchema = z.object({
  resolution: z.string().min(1),
  provider_amount: z.string().optional(),
  client_amount: z.string().optional(),
  resolved_by: z.string(),
});

const AddEvidenceSchema = z.object({
  evidence: z.unknown(),
});

export async function disputesRoutes(
  instance: FastifyInstance,
  disputeService: DisputeService,
): Promise<void> {
  // Raise a new dispute
  instance.post('/disputes', async (request, reply) => {
    const parsed = RaiseDisputeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid dispute', details: parsed.error.issues });
    }
    const dispute = disputeService.raiseDispute(parsed.data);
    return reply.status(201).send(dispute);
  });

  // Get dispute by ID
  instance.get('/disputes/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const dispute = disputeService.getDispute(id);
    if (!dispute) {
      return reply.status(404).send({ error: 'Dispute not found' });
    }
    return reply.send(dispute);
  });

  // Add evidence to a dispute
  instance.post('/disputes/:id/evidence', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = AddEvidenceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid evidence', details: parsed.error.issues });
    }
    const dispute = disputeService.addEvidence(id, parsed.data.evidence);
    if (!dispute) {
      return reply.status(404).send({ error: 'Dispute not found or not open' });
    }
    return reply.send(dispute);
  });

  // Resolve a dispute
  instance.post('/disputes/:id/resolve', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = ResolveDisputeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid resolution', details: parsed.error.issues });
    }
    const dispute = disputeService.resolveDispute(id, parsed.data);
    if (!dispute) {
      return reply.status(404).send({ error: 'Dispute not found or not open' });
    }
    return reply.send(dispute);
  });

  // List disputes for a contract
  instance.get('/contracts/:contractId/disputes', async (request, reply) => {
    const { contractId } = request.params as { contractId: string };
    const query = request.query as { status?: string };
    const disputes = disputeService.listDisputes(contractId, query.status);
    return reply.send({ disputes, total: disputes.length });
  });
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ProofVerifierService } from '../services/proof-verifier.js';

const ProofSubmissionSchema = z.object({
  challenge_id: z.string(),
  response_hash: z.string(),
  merkle_proofs: z.array(z.unknown()).min(1),
});

export async function proofsRoutes(instance: FastifyInstance, proofVerifier: ProofVerifierService): Promise<void> {
  // Submit a proof for a contract
  instance.post('/contracts/:id/proofs', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = ProofSubmissionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid proof submission', details: parsed.error.issues });
    }

    const result = await proofVerifier.verifyProof(id, parsed.data);
    const statusCode = result.valid ? 200 : 422;
    return reply.status(statusCode).send(result);
  });

  // Get proof history for a contract
  instance.get('/contracts/:id/proofs', async (request, reply) => {
    const { id } = request.params as { id: string };
    const proofs = proofVerifier.getProofHistory(id);
    return reply.send({ proofs, total: proofs.length });
  });
}

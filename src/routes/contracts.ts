import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ContractService } from '../services/contract-service.js';

const CreateContractSchema = z.object({
  client_id: z.string().uuid(),
  provider_id: z.string().uuid(),
  file_id: z.string().optional(),
  file_size: z.number().int().positive().optional(),
  price_per_gb_month: z.string(),
  duration_months: z.number().int().min(1).max(120),
  chain_id: z.number().int().optional(),
});

const DepositSchema = z.object({
  amount: z.string(),
  tx_hash: z.string().optional(),
});

export async function contractsRoutes(instance: FastifyInstance, db: Database.Database): Promise<void> {
  const contractService = new ContractService(db);

  // Create a new storage contract
  instance.post('/contracts', async (request, reply) => {
    const parsed = CreateContractSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.issues });
    }

    const contract = contractService.createContract({
      id: randomUUID(),
      ...parsed.data,
    });

    return reply.status(201).send(contract);
  });

  // Get a contract by ID
  instance.get('/contracts/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const contract = contractService.getContract(id);
    if (!contract) {
      return reply.status(404).send({ error: 'Contract not found' });
    }
    return reply.send(contract);
  });

  // List contracts with optional filters
  instance.get('/contracts', async (request, reply) => {
    const query = request.query as { client_id?: string; provider_id?: string; status?: string };
    const contracts = contractService.listContracts(query);
    return reply.send({ contracts, total: contracts.length });
  });

  // Record a deposit for a contract
  instance.post('/contracts/:id/deposit', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = DepositSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.issues });
    }

    const contract = contractService.getContract(id);
    if (!contract) {
      return reply.status(404).send({ error: 'Contract not found' });
    }

    contractService.recordDeposit(id, parsed.data.amount, parsed.data.tx_hash);
    return reply.send(contractService.getContract(id));
  });

  // Get payment events for a contract
  instance.get('/contracts/:id/payments', async (request, reply) => {
    const { id } = request.params as { id: string };
    const events = contractService.getPaymentEvents(id);
    return reply.send({ events, total: events.length });
  });
}

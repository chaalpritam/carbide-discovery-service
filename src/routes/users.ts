import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { UserRegistrationSchema, UserUpdateSchema } from '../types/user.js';
import { UserQueries } from '../database/queries.js';

export async function usersRoutes(instance: FastifyInstance, db: Database.Database): Promise<void> {
  const queries = new UserQueries(db);

  // Register a new user
  instance.post('/users', async (request, reply) => {
    const parsed = UserRegistrationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.issues });
    }

    const existing = queries.getByWallet(parsed.data.wallet_address);
    if (existing) {
      return reply.status(409).send({ error: 'User with this wallet address already exists' });
    }

    const user = {
      id: randomUUID(),
      wallet_address: parsed.data.wallet_address,
      display_name: parsed.data.display_name,
      public_key: parsed.data.public_key,
      metadata: parsed.data.metadata,
    };

    queries.insertUser(user);
    const created = queries.getByWallet(parsed.data.wallet_address);
    return reply.status(201).send(created);
  });

  // Get user by wallet address
  instance.get('/users/:wallet', async (request, reply) => {
    const { wallet } = request.params as { wallet: string };
    const user = queries.getByWallet(wallet);
    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }
    return reply.send(user);
  });

  // Update user
  instance.put('/users/:wallet', async (request, reply) => {
    const { wallet } = request.params as { wallet: string };
    const parsed = UserUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.issues });
    }

    const updated = queries.updateUser(wallet, parsed.data);
    if (!updated) {
      return reply.status(404).send({ error: 'User not found' });
    }
    const user = queries.getByWallet(wallet);
    return reply.send(user);
  });
}

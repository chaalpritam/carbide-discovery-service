import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { DiscoveryService } from '../services/discovery.js';
import { z } from 'zod';

const RegisterFileProviderSchema = z.object({
  provider_id: z.string().uuid(),
  file_size: z.number().int().nonnegative().nullable().optional(),
});

/**
 * File-provider mapping routes plugin
 * Maps files to the providers that store them
 */
export async function filesRoutes(
  fastify: FastifyInstance,
  discoveryService: DiscoveryService
): Promise<void> {
  /**
   * POST /api/v1/files/:fileId/providers
   * Register that a provider holds a file
   */
  fastify.post<{ Params: { fileId: string } }>(
    '/files/:fileId/providers',
    async (request: FastifyRequest<{ Params: { fileId: string } }>, reply: FastifyReply) => {
      try {
        const { fileId } = request.params;
        const body = RegisterFileProviderSchema.parse(request.body);

        discoveryService.registerFileProvider(
          fileId,
          body.provider_id,
          body.file_size ?? null
        );

        fastify.log.info(`File ${fileId} registered with provider ${body.provider_id}`);

        return reply.code(200).send({ status: 'registered' });
      } catch (error) {
        fastify.log.error({ err: error }, 'Failed to register file provider');
        return reply.code(400).send({ error: 'Invalid request' });
      }
    }
  );

  /**
   * GET /api/v1/files/:fileId/providers
   * Look up which (online) providers hold a file
   */
  fastify.get<{ Params: { fileId: string } }>(
    '/files/:fileId/providers',
    async (request: FastifyRequest<{ Params: { fileId: string } }>, reply: FastifyReply) => {
      const { fileId } = request.params;
      const providers = discoveryService.getFileProviders(fileId);

      return reply.code(200).send({ providers });
    }
  );

  /**
   * DELETE /api/v1/files/:fileId/providers/:providerId
   * Remove a file-provider mapping
   */
  fastify.delete<{ Params: { fileId: string; providerId: string } }>(
    '/files/:fileId/providers/:providerId',
    async (
      request: FastifyRequest<{ Params: { fileId: string; providerId: string } }>,
      reply: FastifyReply
    ) => {
      const { fileId, providerId } = request.params;

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(providerId)) {
        return reply.code(400).send({ error: 'Invalid provider ID format' });
      }

      const removed = discoveryService.removeFileProvider(fileId, providerId);

      if (!removed) {
        return reply.code(404).send({ error: 'File-provider mapping not found' });
      }

      return reply.code(200).send({ status: 'removed' });
    }
  );
}

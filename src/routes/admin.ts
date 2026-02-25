import type { FastifyInstance } from 'fastify';
import { AdminService } from '../services/admin-service.js';

export async function adminRoutes(
  instance: FastifyInstance,
  adminService: AdminService,
): Promise<void> {
  // System overview
  instance.get('/admin/overview', async (_request, reply) => {
    const overview = adminService.getSystemOverview();
    return reply.send(overview);
  });

  // List all providers (paginated)
  instance.get('/admin/providers', async (request, reply) => {
    const query = request.query as { page?: string; limit?: string; sort?: string };
    const result = adminService.listAllProviders({
      page: query.page ? parseInt(query.page, 10) : undefined,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      sort: query.sort,
    });
    return reply.send(result);
  });

  // Deactivate a provider
  instance.post('/admin/providers/:id/deactivate', async (request, reply) => {
    const { id } = request.params as { id: string };
    adminService.deactivateProvider(id);
    return reply.send({ message: 'Provider deactivated', provider_id: id });
  });

  // Activate a provider
  instance.post('/admin/providers/:id/activate', async (request, reply) => {
    const { id } = request.params as { id: string };
    adminService.activateProvider(id);
    return reply.send({ message: 'Provider activated', provider_id: id });
  });

  // Query audit log
  instance.get('/admin/audit-log', async (request, reply) => {
    const query = request.query as { since?: string; limit?: string };
    const entries = adminService.queryAuditLog({
      since: query.since,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
    });
    return reply.send({ entries });
  });
}

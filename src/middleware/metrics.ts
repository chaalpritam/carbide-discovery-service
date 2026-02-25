import client from 'prom-client';
import type { FastifyRequest, FastifyReply } from 'fastify';

// Create a private registry (avoids polluting the global default)
export const metricsRegistry = new client.Registry();

// Collect default Node.js metrics (event loop, heap, GC, etc.)
client.collectDefaultMetrics({ register: metricsRegistry });

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------

export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'path', 'status'] as const,
  registers: [metricsRegistry],
});

export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'path'] as const,
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 5],
  registers: [metricsRegistry],
});

export const discoveryProvidersTotal = new client.Gauge({
  name: 'discovery_providers_total',
  help: 'Number of registered providers',
  registers: [metricsRegistry],
});

export const discoveryFilesTotal = new client.Gauge({
  name: 'discovery_files_total',
  help: 'Number of tracked file-provider mappings',
  registers: [metricsRegistry],
});

// ---------------------------------------------------------------------------
// Fastify hooks
// ---------------------------------------------------------------------------

const REQUEST_START = Symbol('requestStart');

export function metricsOnRequest(request: FastifyRequest, _reply: FastifyReply, done: () => void) {
  (request as any)[REQUEST_START] = process.hrtime.bigint();
  done();
}

export function metricsOnResponse(request: FastifyRequest, reply: FastifyReply, done: () => void) {
  const start = (request as any)[REQUEST_START] as bigint | undefined;
  if (start) {
    const durationNs = Number(process.hrtime.bigint() - start);
    const durationSec = durationNs / 1e9;

    // Normalize the path to avoid high-cardinality explosion
    const path = normalizePath(request.routeOptions?.url || request.url);

    httpRequestDuration.observe({ method: request.method, path }, durationSec);
    httpRequestsTotal.inc({ method: request.method, path, status: reply.statusCode.toString() });
  }
  done();
}

/**
 * Replace dynamic path segments (:id, UUIDs, hex hashes) with placeholders
 * to keep cardinality manageable.
 */
function normalizePath(raw: string): string {
  return raw
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/[0-9a-f]{64}/gi, '/:hash');
}

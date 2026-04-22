import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type Database from 'better-sqlite3';
import { loadConfig, validateConfig, type DiscoveryConfig } from './config/index.js';
import { initDatabase } from './database/index.js';
import { DiscoveryService } from './services/discovery.js';
import { HealthChecker } from './services/health-checker.js';
import { StatsUpdater } from './services/stats-updater.js';
import { providersRoutes } from './routes/providers.js';
import { marketplaceRoutes } from './routes/marketplace.js';
import { healthRoutes } from './routes/health.js';
import { filesRoutes } from './routes/files.js';
import { authRoutes } from './routes/auth.js';
import { usersRoutes } from './routes/users.js';
import { contractsRoutes } from './routes/contracts.js';
import { proofsRoutes } from './routes/proofs.js';
import { PaymentSigner } from './services/payment-signer.js';
import { ProofVerifierService } from './services/proof-verifier.js';
import { ReputationService } from './services/reputation-service.js';
import { reputationRoutes } from './routes/reputation.js';
import { PricingService } from './services/pricing-service.js';
import { pricingRoutes } from './routes/pricing.js';
import { DisputeService } from './services/dispute-service.js';
import { disputesRoutes } from './routes/disputes.js';
import { AnalyticsService } from './services/analytics-service.js';
import { analyticsRoutes } from './routes/analytics.js';
import { ContractLifecycleManager } from './services/contract-lifecycle.js';
import { ContractService } from './services/contract-service.js';
import { WebhookService } from './services/webhook-service.js';
import { webhooksRoutes } from './routes/webhooks.js';
import { AdminService } from './services/admin-service.js';
import { adminRoutes } from './routes/admin.js';
import { RegistryIndexer } from './services/registry-indexer.js';
import { createAuthHook } from './middleware/auth.js';
import helmet from '@fastify/helmet';
import { requestIdHook } from './middleware/request-id.js';
import { createAuditLogger } from './middleware/audit-logger.js';
import { metricsOnRequest, metricsOnResponse } from './middleware/metrics.js';
import { metricsRoutes } from './routes/metrics.js';

/**
 * Create and configure the Fastify server
 */
async function createServer(): Promise<{ server: FastifyInstance; config: DiscoveryConfig; db: Database.Database }> {
  // Load configuration
  const config = loadConfig();

  // Validate numeric/structural constraints
  validateConfig(config);

  // Validate secrets are not using dangerous defaults
  if (config.nodeEnv === 'production') {
    if (config.authSecret.includes('changeme')) {
      throw new Error('AUTH_SECRET must be changed from default in production. Set the AUTH_SECRET environment variable.');
    }
    if (config.jwtSecret.includes('changeme')) {
      throw new Error('JWT_SECRET must be changed from default in production. Set the JWT_SECRET environment variable.');
    }
  } else if (config.authEnabled) {
    if (config.authSecret.includes('changeme')) {
      console.warn('⚠️  AUTH_SECRET is using the default value. Set AUTH_SECRET env var before deploying.');
    }
    if (config.jwtSecret.includes('changeme')) {
      console.warn('⚠️  JWT_SECRET is using the default value. Set JWT_SECRET env var before deploying.');
    }
  }

  // Initialize SQLite database
  const db = initDatabase(config.databasePath);

  // Create Fastify instance with logger
  const loggerOptions: Record<string, unknown> = {
    level: config.logLevel,
  };

  if (config.nodeEnv !== 'production') {
    loggerOptions.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    };
  }

  const server = Fastify({ logger: loggerOptions });

  // Register CORS plugin
  await server.register(cors, {
    origin: config.corsOrigin,
    credentials: true,
  });

  // Register rate limiting
  await server.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: '1 minute',
  });

  // Stricter rate limit for mutating endpoints
  server.addHook('onRoute', (routeOptions) => {
    if (routeOptions.method === 'POST' || routeOptions.method === 'DELETE') {
      const existing = routeOptions.config || {};
      routeOptions.config = {
        ...existing,
        rateLimit: { max: 20, timeWindow: '1 minute' },
      };
    }
  });

  // Security headers (CSP, HSTS, X-Frame-Options, etc.)
  await server.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
      },
    },
  });

  // Hook order: requestId → auth → audit
  server.addHook('onRequest', requestIdHook);

  // API key / JWT authentication
  const authHook = createAuthHook(db, config.authEnabled, config.jwtSecret);
  server.addHook('onRequest', authHook);

  // Audit logging for mutations and errors
  const auditLogger = createAuditLogger(db);
  server.addHook('onRequest', auditLogger.onRequest);
  server.addHook('onResponse', auditLogger.onResponse);

  // Prometheus metrics collection
  server.addHook('onRequest', metricsOnRequest);
  server.addHook('onResponse', metricsOnResponse);

  // Create discovery service with database
  const discoveryService = new DiscoveryService(config, db);

  // Create payment signer (only if verifier key is configured)
  const paymentSigner = config.verifierPrivateKey
    ? new PaymentSigner(config.verifierPrivateKey, config.chainId, config.escrowContract)
    : null;

  const reputationService = new ReputationService(db);

  const proofVerifier = new ProofVerifierService(db, paymentSigner, reputationService);

  // Register routes
  await server.register(
    async (instance) => {
      await providersRoutes(instance, discoveryService);
    },
    { prefix: '/api/v1' }
  );

  await server.register(
    async (instance) => {
      await marketplaceRoutes(instance, discoveryService);
    },
    { prefix: '/api/v1' }
  );

  await server.register(
    async (instance) => {
      await healthRoutes(instance);
    },
    { prefix: '/api/v1' }
  );

  await server.register(
    async (instance) => {
      await filesRoutes(instance, discoveryService);
    },
    { prefix: '/api/v1' }
  );

  await server.register(
    async (instance) => {
      await authRoutes(instance, db, config.authSecret, config.jwtSecret, config.jwtExpiresIn);
    },
    { prefix: '/api/v1' }
  );

  await server.register(
    async (instance) => {
      await usersRoutes(instance, db);
    },
    { prefix: '/api/v1' }
  );

  await server.register(
    async (instance) => {
      await contractsRoutes(instance, db);
    },
    { prefix: '/api/v1' }
  );

  await server.register(
    async (instance) => {
      await proofsRoutes(instance, proofVerifier);
    },
    { prefix: '/api/v1' }
  );
  await server.register(
    async (instance) => {
      await reputationRoutes(instance, reputationService);
    },
    { prefix: '/api/v1' }
  );

  const pricingService = new PricingService(db);
  await server.register(
    async (instance) => {
      await pricingRoutes(instance, pricingService);
    },
    { prefix: '/api/v1' }
  );

  const disputeService = new DisputeService(db);
  await server.register(
    async (instance) => {
      await disputesRoutes(instance, disputeService);
    },
    { prefix: '/api/v1' }
  );

  const analyticsService = new AnalyticsService(db);
  await server.register(
    async (instance) => {
      await analyticsRoutes(instance, analyticsService);
    },
    { prefix: '/api/v1' }
  );

  const adminService = new AdminService(db);
  await server.register(
    async (instance) => {
      await adminRoutes(instance, adminService);
    },
    { prefix: '/api/v1' }
  );

  const webhookService = new WebhookService(db);
  await server.register(
    async (instance) => {
      await webhooksRoutes(instance, webhookService);
    },
    { prefix: '/api/v1' }
  );

  // Metrics endpoint (Prometheus scrape target, no prefix)
  await server.register(
    async (instance) => {
      await metricsRoutes(instance);
    }
  );

  // Start background tasks
  const healthChecker = new HealthChecker(
    discoveryService,
    config.healthCheckInterval,
    server.log
  );
  healthChecker.start();

  const statsUpdater = new StatsUpdater(
    discoveryService,
    60000, // Update stats every 60 seconds
    server.log
  );
  statsUpdater.start();

  const contractLifecycle = new ContractLifecycleManager(
    db,
    new ContractService(db),
    reputationService
  );
  contractLifecycle.start(60_000);

  // Start the on-chain registry indexer when a CarbideRegistry address
  // is configured. Failures don't prevent the server from coming up:
  // the HTTP registration path still works standalone, this just means
  // the service won't mirror on-chain providers until operators fix
  // the RPC/address.
  let registryIndexer: RegistryIndexer | null = null;
  if (config.registryContract) {
    registryIndexer = new RegistryIndexer(
      db,
      {
        rpcUrl: config.rpcUrl,
        registryAddress: config.registryContract,
      },
      server.log
    );
    registryIndexer.start().catch((err) => {
      server.log.error({ err }, 'registry indexer failed to start');
    });
  } else {
    server.log.info(
      'REGISTRY_CONTRACT not set; on-chain registry indexer disabled'
    );
  }

  // Graceful shutdown with 30-second timeout
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  signals.forEach((signal) => {
    process.on(signal, async () => {
      server.log.info(`Received ${signal}, shutting down gracefully...`);
      healthChecker.stop();
      statsUpdater.stop();
      contractLifecycle.stop();
      if (registryIndexer) {
        await registryIndexer.stop().catch((err) => {
          server.log.warn({ err }, 'registry indexer stop failed');
        });
      }

      // Force exit if graceful close takes too long (e.g. stuck connections)
      const forceTimer = setTimeout(() => {
        server.log.error('Graceful shutdown timed out after 30s, forcing exit');
        process.exit(1);
      }, 30_000);
      forceTimer.unref();

      try {
        await server.close();
      } finally {
        db.close();
      }
      process.exit(0);
    });
  });

  // Crash handlers — log and exit rather than silently dying
  process.on('uncaughtException', (err) => {
    server.log.fatal({ err }, 'Uncaught exception');
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    server.log.fatal({ reason }, 'Unhandled promise rejection');
    process.exit(1);
  });

  return { server, config, db };
}

/**
 * Start the server
 */
async function start() {
  try {
    const { server, config } = await createServer();

    await server.listen({
      host: config.host,
      port: config.port
    });

    server.log.info(`Carbide Discovery Service started`);
    server.log.info(`Server listening on ${config.host}:${config.port}`);
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}

export { createServer, start };

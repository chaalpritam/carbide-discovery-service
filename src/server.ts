import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { loadConfig } from './config/index.js';
import { initDatabase } from './database/index.js';
import { DiscoveryService } from './services/discovery.js';
import { HealthChecker } from './services/health-checker.js';
import { StatsUpdater } from './services/stats-updater.js';
import { providersRoutes } from './routes/providers.js';
import { marketplaceRoutes } from './routes/marketplace.js';
import { healthRoutes } from './routes/health.js';

/**
 * Create and configure the Fastify server
 */
async function createServer() {
  // Load configuration
  const config = loadConfig();

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

  // Create discovery service with database
  const discoveryService = new DiscoveryService(config, db);

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

  // Graceful shutdown
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  signals.forEach((signal) => {
    process.on(signal, async () => {
      server.log.info(`Received ${signal}, shutting down gracefully...`);
      healthChecker.stop();
      statsUpdater.stop();
      db.close();
      await server.close();
      process.exit(0);
    });
  });

  return { server, config };
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

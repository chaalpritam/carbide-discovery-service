import 'dotenv/config';

/**
 * Discovery service configuration
 */
export interface DiscoveryConfig {
  host: string;                     // Server bind address
  port: number;                     // Server port
  healthCheckInterval: number;      // Health check interval (ms)
  providerTimeout: number;          // Provider timeout (ms)
  maxSearchResults: number;         // Max providers in search results
  logLevel: string;                 // Log level
  nodeEnv: string;                  // Node environment
  corsOrigin: string | boolean;     // CORS origin
  databasePath: string;             // SQLite database file path
  authEnabled: boolean;             // Enable API key authentication
  authSecret: string;               // Secret for bootstrap endpoint
  jwtSecret: string;                // Secret for signing JWTs
  jwtExpiresIn: string;             // JWT token expiry (e.g., '1h', '30m')
}

/**
 * Load configuration from environment variables
 */
export function loadConfig(): DiscoveryConfig {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const corsOrigin = process.env.CORS_ORIGIN || (nodeEnv === 'production' ? 'https://carbide.network' : true);

  return {
    host: process.env.HOST || '0.0.0.0',
    port: parseInt(process.env.PORT || '9090', 10),
    healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '30000', 10),
    providerTimeout: parseInt(process.env.PROVIDER_TIMEOUT || '300000', 10),
    maxSearchResults: parseInt(process.env.MAX_SEARCH_RESULTS || '100', 10),
    logLevel: process.env.LOG_LEVEL || 'info',
    nodeEnv,
    corsOrigin,
    databasePath: process.env.DATABASE_PATH || './data/carbide-discovery.db',
    authEnabled: process.env.AUTH_ENABLED !== 'false',
    authSecret: process.env.AUTH_SECRET || 'changeme-in-production',
    jwtSecret: process.env.JWT_SECRET || 'jwt-changeme-in-production',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
  };
}

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
  verifierPrivateKey: string;       // Private key for payment attestation signing
  escrowContract: string;           // Escrow contract address
  usdcAddress: string;              // USDC token contract address
  chainId: number;                  // Blockchain chain ID
  rpcUrl: string;                   // Blockchain RPC endpoint
}

/**
 * Load configuration from environment variables
 */
/**
 * Validate configuration values before starting the server.
 *
 * Catches misconfigurations early (invalid port, zero intervals) instead of
 * crashing at runtime with confusing errors.
 */
export function validateConfig(config: DiscoveryConfig): void {
  if (config.port < 1 || config.port > 65535) {
    throw new Error(`Invalid port ${config.port}: must be between 1 and 65535`);
  }
  if (config.healthCheckInterval <= 0) {
    throw new Error(`healthCheckInterval must be > 0 (got ${config.healthCheckInterval})`);
  }
  if (config.providerTimeout <= 0) {
    throw new Error(`providerTimeout must be > 0 (got ${config.providerTimeout})`);
  }
  if (config.maxSearchResults < 1 || config.maxSearchResults > 1000) {
    throw new Error(`maxSearchResults must be between 1 and 1000 (got ${config.maxSearchResults})`);
  }
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
    verifierPrivateKey: process.env.VERIFIER_PRIVATE_KEY ?? '',
    escrowContract: process.env.ESCROW_CONTRACT ?? '',
    usdcAddress: process.env.USDC_ADDRESS ?? '',
    chainId: parseInt(process.env.CHAIN_ID ?? '421614', 10),
    rpcUrl: process.env.RPC_URL ?? 'https://sepolia-rollup.arbitrum.io/rpc',
  };
}

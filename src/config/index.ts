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
  solanaCluster: string;            // Cluster label (devnet | mainnet-beta | ...)
  solanaRpcUrl: string;             // JSON-RPC endpoint
  solanaWsUrl: string;              // Optional explicit websocket endpoint (empty = derived from RPC)
  registryProgramId: string;        // carbide_registry program ID (empty disables indexer)
  escrowProgramId: string;          // carbide_escrow program ID
  usdcMint: string;                 // SPL token mint used for payments
  verifierKeypairPath: string;      // Path to a solana-keygen JSON keypair for the verifier
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
    solanaCluster: process.env.CARBIDE_SOLANA_CLUSTER ?? 'devnet',
    solanaRpcUrl: process.env.CARBIDE_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com',
    solanaWsUrl: process.env.CARBIDE_SOLANA_WS_URL ?? '',
    registryProgramId: process.env.CARBIDE_REGISTRY_PROGRAM_ID ?? '',
    escrowProgramId: process.env.CARBIDE_ESCROW_PROGRAM_ID ?? '',
    usdcMint: process.env.CARBIDE_USDC_MINT ?? '',
    verifierKeypairPath: process.env.CARBIDE_VERIFIER_KEYPAIR_PATH ?? '',
  };
}

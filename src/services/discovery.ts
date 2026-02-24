import type { DiscoveryConfig } from '../config/index.js';
import type {
  Provider,
  ProviderAnnouncement,
  ProviderListRequest,
  ProviderListResponse,
  HealthCheckResponse,
  StorageQuoteRequest,
  StorageQuoteResponse
} from '../types/index.js';
import { ServiceStatus } from '../types/index.js';
import type Database from 'better-sqlite3';
import { ProviderQueries } from '../database/queries.js';

/**
 * Registry entry for a provider with metadata
 */
export interface RegistryEntry {
  provider: Provider;
  registered_at: Date;
  last_heartbeat: Date;
  health_status: ServiceStatus;
  failed_health_checks: number;
  current_load: number | null;
  available_storage: number | null;
  active_contracts: number;
}

/**
 * Marketplace statistics
 */
export interface MarketplaceStats {
  total_providers: number;
  online_providers: number;
  total_capacity_bytes: number;
  available_capacity_bytes: number;
  average_price_per_gb: string;
  total_requests: number;
  last_updated: Date;
}

/**
 * Main discovery service class
 * Manages provider registry using SQLite persistent storage
 */
export class DiscoveryService {
  private queries: ProviderQueries;
  private stats: MarketplaceStats;
  private config: DiscoveryConfig;
  private totalRequests: number;

  constructor(config: DiscoveryConfig, db: Database.Database) {
    this.config = config;
    this.queries = new ProviderQueries(db);
    this.totalRequests = 0;

    // Initialize stats
    this.stats = {
      total_providers: 0,
      online_providers: 0,
      total_capacity_bytes: 0,
      available_capacity_bytes: 0,
      average_price_per_gb: '0.0',
      total_requests: 0,
      last_updated: new Date()
    };
  }

  /**
   * Register a new provider
   */
  registerProvider(announcement: ProviderAnnouncement): void {
    const { provider } = announcement;
    const now = new Date();

    const entry: RegistryEntry = {
      provider,
      registered_at: now,
      last_heartbeat: now,
      health_status: ServiceStatus.Healthy,
      failed_health_checks: 0,
      current_load: 0.0,
      available_storage: provider.available_capacity,
      active_contracts: 0
    };

    this.queries.upsertProvider(entry);
    this.stats.total_providers = this.queries.getCount();
  }

  /**
   * Unregister a provider
   */
  unregisterProvider(providerId: string): boolean {
    const removed = this.queries.deleteProvider(providerId);
    if (removed) {
      this.stats.total_providers = this.queries.getCount();
    }
    return removed;
  }

  /**
   * Update provider heartbeat
   */
  updateHeartbeat(providerId: string, health: HealthCheckResponse): boolean {
    const entry = this.queries.getEntry(providerId);
    if (!entry) {
      return false;
    }

    const now = new Date();
    let failedChecks = entry.failed_health_checks;

    if (health.status === ServiceStatus.Healthy) {
      failedChecks = 0;
    } else {
      failedChecks++;
    }

    return this.queries.updateHeartbeat(
      providerId,
      now,
      health.status,
      health.load ?? null,
      health.available_storage ?? null,
      failedChecks
    );
  }

  /**
   * Get a specific provider by ID
   */
  getProvider(providerId: string): Provider | null {
    return this.queries.getProvider(providerId);
  }

  /**
   * Search for providers with filters and ranking
   */
  searchProviders(request: ProviderListRequest): ProviderListResponse {
    this.totalRequests++;

    const { providers, totalCount } = this.queries.searchProviders(
      request,
      this.config.providerTimeout,
      this.config.maxSearchResults
    );

    return {
      providers,
      total_count: totalCount,
      has_more: totalCount >= this.config.maxSearchResults
    };
  }

  /**
   * Request quotes from multiple providers in parallel
   */
  async requestQuotes(request: StorageQuoteRequest): Promise<StorageQuoteResponse[]> {
    const searchResults = this.searchProviders({
      region: request.preferred_regions[0] || null,
      limit: 10,
      min_reputation: '0.30'
    });

    const quotePromises = searchResults.providers.map(async (provider): Promise<StorageQuoteResponse | null> => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(
          `${provider.endpoint}/api/v1/marketplace/quote`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
            signal: controller.signal
          }
        );

        clearTimeout(timeoutId);

        if (!response.ok) {
          return null;
        }

        return await response.json() as StorageQuoteResponse;
      } catch {
        return null;
      }
    });

    const quotes = (await Promise.all(quotePromises))
      .filter((q): q is StorageQuoteResponse => q !== null);

    quotes.sort((a, b) => {
      const priceA = parseFloat(a.price_per_gb_month);
      const priceB = parseFloat(b.price_per_gb_month);
      return priceA - priceB;
    });

    return quotes;
  }

  /**
   * Get marketplace statistics
   */
  getMarketplaceStats(): MarketplaceStats {
    return { ...this.stats };
  }

  /**
   * Update marketplace statistics
   * Called periodically by stats updater
   */
  updateStats(): void {
    const computed = this.queries.computeStats(this.config.providerTimeout);
    this.stats = {
      ...computed,
      total_requests: this.totalRequests,
    };
  }

  /**
   * Get all registry entries (for health checker)
   */
  getAllEntries(): Map<string, RegistryEntry> {
    return this.queries.getAllEntries();
  }

  // ============================================================
  // File-Provider Mapping
  // ============================================================

  /**
   * Register that a provider holds a file
   */
  registerFileProvider(fileId: string, providerId: string, fileSize: number | null): void {
    this.queries.registerFileProvider(fileId, providerId, fileSize);
  }

  /**
   * Remove a file-provider mapping
   */
  removeFileProvider(fileId: string, providerId: string): boolean {
    return this.queries.removeFileProvider(fileId, providerId);
  }

  /**
   * Get online providers that hold a specific file
   */
  getFileProviders(fileId: string): {
    provider_id: string;
    endpoint: string;
    file_size: number | null;
    stored_at: string;
  }[] {
    return this.queries.getFileProviders(fileId, this.config.providerTimeout);
  }
}

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
import { ProviderTier, Region, ServiceStatus } from '../types/index.js';

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
 * Manages provider registry, indexing, and marketplace operations
 */
export class DiscoveryService {
  private registry: Map<string, RegistryEntry>;
  private regionalIndex: Map<Region, Set<string>>;
  private tierIndex: Map<ProviderTier, Set<string>>;
  private stats: MarketplaceStats;
  private config: DiscoveryConfig;
  private totalRequests: number;

  constructor(config: DiscoveryConfig) {
    this.config = config;
    this.registry = new Map();
    this.regionalIndex = new Map();
    this.tierIndex = new Map();
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

    // Initialize region and tier indexes
    Object.values(Region).forEach(region => {
      this.regionalIndex.set(region as Region, new Set());
    });
    Object.values(ProviderTier).forEach(tier => {
      this.tierIndex.set(tier as ProviderTier, new Set());
    });
  }

  /**
   * Register a new provider
   */
  registerProvider(announcement: ProviderAnnouncement): void {
    const { provider } = announcement;
    const entry: RegistryEntry = {
      provider,
      registered_at: new Date(),
      last_heartbeat: new Date(),
      health_status: ServiceStatus.Healthy,
      failed_health_checks: 0,
      current_load: 0.0,
      available_storage: provider.available_capacity,
      active_contracts: 0
    };

    // Add to main registry
    this.registry.set(provider.id, entry);

    // Add to regional index
    const regionalSet = this.regionalIndex.get(provider.region);
    if (regionalSet) {
      regionalSet.add(provider.id);
    }

    // Add to tier index
    const tierSet = this.tierIndex.get(provider.tier);
    if (tierSet) {
      tierSet.add(provider.id);
    }

    this.stats.total_providers = this.registry.size;
  }

  /**
   * Unregister a provider
   */
  unregisterProvider(providerId: string): boolean {
    const entry = this.registry.get(providerId);
    if (!entry) {
      return false;
    }

    // Remove from main registry
    this.registry.delete(providerId);

    // Remove from regional index
    const regionalSet = this.regionalIndex.get(entry.provider.region);
    if (regionalSet) {
      regionalSet.delete(providerId);
    }

    // Remove from tier index
    const tierSet = this.tierIndex.get(entry.provider.tier);
    if (tierSet) {
      tierSet.delete(providerId);
    }

    this.stats.total_providers = this.registry.size;
    return true;
  }

  /**
   * Update provider heartbeat
   */
  updateHeartbeat(providerId: string, health: HealthCheckResponse): boolean {
    const entry = this.registry.get(providerId);
    if (!entry) {
      return false;
    }

    entry.last_heartbeat = new Date();
    entry.health_status = health.status;
    entry.current_load = health.load ?? null;
    entry.available_storage = health.available_storage ?? null;

    // Reset failed health checks on successful heartbeat
    if (health.status === ServiceStatus.Healthy) {
      entry.failed_health_checks = 0;
    } else {
      entry.failed_health_checks++;
    }

    return true;
  }

  /**
   * Get a specific provider by ID
   */
  getProvider(providerId: string): Provider | null {
    const entry = this.registry.get(providerId);
    return entry ? entry.provider : null;
  }

  /**
   * Check if a provider is online (within timeout)
   */
  private isOnline(entry: RegistryEntry): boolean {
    const now = Date.now();
    const lastSeen = entry.last_heartbeat.getTime();
    return (now - lastSeen) < this.config.providerTimeout;
  }

  /**
   * Search for providers with filters and ranking
   */
  searchProviders(request: ProviderListRequest): ProviderListResponse {
    this.totalRequests++;

    // 1. Get candidates from regional or tier index
    let candidateIds: string[];
    if (request.region) {
      const regionalSet = this.regionalIndex.get(request.region);
      candidateIds = regionalSet ? Array.from(regionalSet) : [];
    } else if (request.tier) {
      const tierSet = this.tierIndex.get(request.tier);
      candidateIds = tierSet ? Array.from(tierSet) : [];
    } else {
      candidateIds = Array.from(this.registry.keys());
    }

    // 2. Filter by online status, reputation, and tier
    const minReputation = request.min_reputation ? parseFloat(request.min_reputation) : 0;
    const limit = request.limit || this.config.maxSearchResults;

    const matchingEntries = candidateIds
      .map(id => this.registry.get(id)!)
      .filter(entry => entry !== undefined)
      .filter(entry => this.isOnline(entry))
      .filter(entry => {
        const reputation = parseFloat(entry.provider.reputation.overall);
        return reputation >= minReputation;
      })
      .filter(entry => {
        // Apply tier filter if specified
        if (request.tier && entry.provider.tier !== request.tier) {
          return false;
        }
        return true;
      });

    // 3. Sort by reputation descending
    matchingEntries.sort((a, b) => {
      const repA = parseFloat(a.provider.reputation.overall);
      const repB = parseFloat(b.provider.reputation.overall);
      return repB - repA;
    });

    // 4. Apply limit
    const limitedEntries = matchingEntries.slice(0, limit);

    return {
      providers: limitedEntries.map(e => e.provider),
      total_count: matchingEntries.length,
      has_more: matchingEntries.length >= this.config.maxSearchResults
    };
  }

  /**
   * Request quotes from multiple providers in parallel
   */
  async requestQuotes(request: StorageQuoteRequest): Promise<StorageQuoteResponse[]> {
    // 1. Search for providers
    const searchResults = this.searchProviders({
      region: request.preferred_regions[0] || null,
      limit: 10,
      min_reputation: '0.30'
    });

    // 2. Request quotes in parallel with timeout
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

    // 3. Collect successful quotes
    const quotes = (await Promise.all(quotePromises))
      .filter((q): q is StorageQuoteResponse => q !== null);

    // 4. Sort by price ascending (cheapest first)
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
    let onlineCount = 0;
    let totalCapacity = 0;
    let availableCapacity = 0;
    let priceSum = 0;
    let priceCount = 0;

    for (const entry of this.registry.values()) {
      if (this.isOnline(entry)) {
        onlineCount++;
        totalCapacity += entry.provider.total_capacity;
        availableCapacity += entry.available_storage || 0;

        const price = parseFloat(entry.provider.price_per_gb_month);
        if (!isNaN(price)) {
          priceSum += price;
          priceCount++;
        }
      }
    }

    const avgPrice = priceCount > 0 ? priceSum / priceCount : 0;

    this.stats = {
      total_providers: this.registry.size,
      online_providers: onlineCount,
      total_capacity_bytes: totalCapacity,
      available_capacity_bytes: availableCapacity,
      average_price_per_gb: avgPrice.toFixed(6),
      total_requests: this.totalRequests,
      last_updated: new Date()
    };
  }

  /**
   * Get all registry entries (for health checker)
   */
  getAllEntries(): Map<string, RegistryEntry> {
    return this.registry;
  }
}

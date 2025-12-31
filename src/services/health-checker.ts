import type { DiscoveryService } from './discovery.js';
import type { HealthCheckResponse } from '../types/index.js';
import { ServiceStatus } from '../types/index.js';
import type { FastifyBaseLogger } from 'fastify';

/**
 * Health checker runs periodically to check all registered providers
 * Automatically removes providers that fail health checks more than 5 times
 */
export class HealthChecker {
  private discoveryService: DiscoveryService;
  private intervalMs: number;
  private intervalId: NodeJS.Timeout | null;
  private logger: FastifyBaseLogger;

  constructor(
    discoveryService: DiscoveryService,
    intervalMs: number,
    logger: FastifyBaseLogger
  ) {
    this.discoveryService = discoveryService;
    this.intervalMs = intervalMs;
    this.intervalId = null;
    this.logger = logger;
  }

  /**
   * Start the health checker
   */
  start(): void {
    if (this.intervalId) {
      this.logger.warn('Health checker already running');
      return;
    }

    this.logger.info(`Starting health checker (interval: ${this.intervalMs}ms)`);

    // Run immediately on start
    this.runHealthCheck();

    // Then run periodically
    this.intervalId = setInterval(() => {
      this.runHealthCheck();
    }, this.intervalMs);
  }

  /**
   * Stop the health checker
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.logger.info('Health checker stopped');
    }
  }

  /**
   * Run health check on all providers in parallel
   */
  private async runHealthCheck(): Promise<void> {
    const entries = this.discoveryService.getAllEntries();
    const providerIds = Array.from(entries.keys());

    if (providerIds.length === 0) {
      return;
    }

    this.logger.debug(`Running health check on ${providerIds.length} providers`);

    // Check all providers in parallel
    const results = await Promise.all(
      providerIds.map(id => this.checkProvider(id))
    );

    const successCount = results.filter(r => r).length;
    this.logger.info(`Health check complete: ${successCount}/${providerIds.length} healthy`);
  }

  /**
   * Check a single provider's health
   */
  private async checkProvider(providerId: string): Promise<boolean> {
    const entries = this.discoveryService.getAllEntries();
    const entry = entries.get(providerId);

    if (!entry) {
      return false;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(
        `${entry.provider.endpoint}/api/v1/health`,
        { signal: controller.signal }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        this.handleFailure(providerId, entry.provider.name);
        return false;
      }

      const health = await response.json() as HealthCheckResponse;

      // Update provider status
      this.discoveryService.updateHeartbeat(providerId, health);

      if (health.status === 'Healthy') {
        return true;
      } else {
        this.handleFailure(providerId, entry.provider.name);
        return false;
      }
    } catch (error) {
      this.handleFailure(providerId, entry.provider.name);
      return false;
    }
  }

  /**
   * Handle provider health check failure
   */
  private handleFailure(providerId: string, providerName: string): void {
    const entries = this.discoveryService.getAllEntries();
    const entry = entries.get(providerId);

    if (!entry) {
      return;
    }

    entry.failed_health_checks++;
    entry.health_status = ServiceStatus.Unavailable;

    this.logger.warn(
      `Provider ${providerName} (${providerId}) health check failed ` +
      `(${entry.failed_health_checks} consecutive failures)`
    );

    // Auto-remove providers with >5 failed checks
    if (entry.failed_health_checks > 5) {
      this.logger.warn(
        `Removing provider ${providerName} (${providerId}) after ${entry.failed_health_checks} failed checks`
      );
      this.discoveryService.unregisterProvider(providerId);
    }
  }
}

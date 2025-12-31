import type { DiscoveryService } from './discovery.js';
import type { FastifyBaseLogger } from 'fastify';

/**
 * Stats updater runs periodically to recalculate marketplace statistics
 */
export class StatsUpdater {
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
   * Start the stats updater
   */
  start(): void {
    if (this.intervalId) {
      this.logger.warn('Stats updater already running');
      return;
    }

    this.logger.info(`Starting stats updater (interval: ${this.intervalMs}ms)`);

    // Run immediately on start
    this.updateStats();

    // Then run periodically
    this.intervalId = setInterval(() => {
      this.updateStats();
    }, this.intervalMs);
  }

  /**
   * Stop the stats updater
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.logger.info('Stats updater stopped');
    }
  }

  /**
   * Update marketplace statistics
   */
  private updateStats(): void {
    this.discoveryService.updateStats();
    const stats = this.discoveryService.getMarketplaceStats();

    this.logger.info(
      `Marketplace stats updated: ${stats.online_providers}/${stats.total_providers} online, ` +
      `${(stats.available_capacity_bytes / 1e9).toFixed(2)}GB available, ` +
      `avg price: $${stats.average_price_per_gb}/GB/month`
    );
  }
}

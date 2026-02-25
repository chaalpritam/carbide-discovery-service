import type Database from 'better-sqlite3';
import { ContractService } from './contract-service.js';
import { ReputationService } from './reputation-service.js';

export class ContractLifecycleManager {
  private db: Database.Database;
  private contractService: ContractService;
  private reputationService: ReputationService;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(db: Database.Database, contractService: ContractService, reputationService: ReputationService) {
    this.db = db;
    this.contractService = contractService;
    this.reputationService = reputationService;
  }

  start(intervalMs: number): void {
    this.intervalId = setInterval(() => {
      this.checkExpiredContracts();
      this.checkStaleProofs();
    }, intervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  checkExpiredContracts(): number {
    const expired = this.contractService.getExpiredContracts();
    for (const contract of expired) {
      this.contractService.updateStatus(contract.id, 'completed');
      this.reputationService.recordEvent({
        provider_id: contract.provider_id,
        event_type: 'contract_completed',
        severity: 'positive',
        contract_id: contract.id,
      });
      this.reputationService.recalculateScore(contract.provider_id);
    }
    return expired.length;
  }

  checkStaleProofs(hoursThreshold: number = 48): number {
    const stale = this.contractService.getStaleContracts(hoursThreshold);
    for (const contract of stale) {
      this.contractService.updateStatus(contract.id, 'failed');
      this.reputationService.recordEvent({
        provider_id: contract.provider_id,
        event_type: 'contract_violated',
        severity: 'negative',
        contract_id: contract.id,
      });
      this.reputationService.recalculateScore(contract.provider_id);
    }
    return stale.length;
  }
}

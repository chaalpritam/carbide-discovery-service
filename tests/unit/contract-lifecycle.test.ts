import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase } from '../../src/database/index.js';
import { ContractService } from '../../src/services/contract-service.js';
import { ReputationService } from '../../src/services/reputation-service.js';
import { ContractLifecycleManager } from '../../src/services/contract-lifecycle.js';
import { randomUUID } from 'node:crypto';

describe('ContractLifecycleManager', () => {
  let db: Database.Database;
  let contractService: ContractService;
  let reputationService: ReputationService;
  let lifecycle: ContractLifecycleManager;
  let providerId: string;

  const insertProvider = (id: string) => {
    db.prepare(`
      INSERT INTO providers (id, name, tier, region, endpoint, available_capacity, total_capacity,
        price_per_gb_month, last_seen, metadata, rep_overall, rep_uptime, rep_data_integrity,
        rep_response_time, rep_contract_compliance, rep_community_feedback, rep_contracts_completed,
        rep_last_updated, registered_at, last_heartbeat, health_status, failed_health_checks,
        current_load, available_storage, active_contracts)
      VALUES (?, 'test-provider', 'Home', 'NorthAmerica', 'http://localhost:8080', 10000000000,
        25000000000, '0.005', datetime('now'), '{}', '0.5', '0.5', '0.5', '0.5', '0.5', '0.5',
        0, datetime('now'), datetime('now'), datetime('now'), 'Healthy', 0, 0.1, 10000000000, 0)
    `).run(id);
  };

  beforeEach(() => {
    db = initDatabase(':memory:');
    contractService = new ContractService(db);
    reputationService = new ReputationService(db);
    lifecycle = new ContractLifecycleManager(db, contractService, reputationService);
    providerId = randomUUID();
    insertProvider(providerId);
  });

  afterEach(() => {
    lifecycle.stop();
    db.close();
  });

  it('transitions expired contracts to completed', () => {
    // Create a contract with duration_months=1 and created_at 2 months ago
    const contractId = randomUUID();
    contractService.createContract({
      id: contractId,
      client_id: randomUUID(),
      provider_id: providerId,
      price_per_gb_month: '0.005',
      duration_months: 1,
    });
    contractService.recordDeposit(contractId, '1000');
    // Backdate created_at so the contract is past its duration
    db.prepare(`UPDATE storage_contracts SET created_at = datetime('now', '-2 months') WHERE id = ?`).run(contractId);

    const count = lifecycle.checkExpiredContracts();
    expect(count).toBe(1);

    const updated = contractService.getContract(contractId)!;
    expect(updated.status).toBe('completed');
  });

  it('emits contract_completed reputation event on expiry', () => {
    const contractId = randomUUID();
    contractService.createContract({
      id: contractId,
      client_id: randomUUID(),
      provider_id: providerId,
      price_per_gb_month: '0.005',
      duration_months: 1,
    });
    contractService.recordDeposit(contractId, '1000');
    db.prepare(`UPDATE storage_contracts SET created_at = datetime('now', '-2 months') WHERE id = ?`).run(contractId);

    lifecycle.checkExpiredContracts();

    const events = db.prepare(
      "SELECT * FROM reputation_events WHERE provider_id = ? AND event_type = 'contract_completed'"
    ).all(providerId) as { event_type: string; severity: string }[];
    expect(events.length).toBe(1);
    expect(events[0].severity).toBe('positive');
  });

  it('transitions stale proof contracts to failed', () => {
    const contractId = randomUUID();
    contractService.createContract({
      id: contractId,
      client_id: randomUUID(),
      provider_id: providerId,
      price_per_gb_month: '0.005',
      duration_months: 12,
    });
    contractService.recordDeposit(contractId, '12000');

    // Manually set last_proof_at to 72 hours ago and created_at to 5 days ago
    db.prepare(
      `UPDATE storage_contracts SET last_proof_at = datetime('now', '-72 hours'), created_at = datetime('now', '-5 days') WHERE id = ?`
    ).run(contractId);

    const count = lifecycle.checkStaleProofs(48);
    expect(count).toBe(1);

    const updated = contractService.getContract(contractId)!;
    expect(updated.status).toBe('failed');
  });

  it('emits contract_violated reputation event on stale failure', () => {
    const contractId = randomUUID();
    contractService.createContract({
      id: contractId,
      client_id: randomUUID(),
      provider_id: providerId,
      price_per_gb_month: '0.005',
      duration_months: 12,
    });
    contractService.recordDeposit(contractId, '12000');

    db.prepare(
      `UPDATE storage_contracts SET last_proof_at = datetime('now', '-72 hours'), created_at = datetime('now', '-5 days') WHERE id = ?`
    ).run(contractId);

    lifecycle.checkStaleProofs(48);

    const events = db.prepare(
      "SELECT * FROM reputation_events WHERE provider_id = ? AND event_type = 'contract_violated'"
    ).all(providerId) as { event_type: string; severity: string }[];
    expect(events.length).toBe(1);
    expect(events[0].severity).toBe('negative');
  });

  it('does not transition non-expired contracts', () => {
    const contractId = randomUUID();
    contractService.createContract({
      id: contractId,
      client_id: randomUUID(),
      provider_id: providerId,
      price_per_gb_month: '0.005',
      duration_months: 12,
    });
    contractService.recordDeposit(contractId, '12000');

    const count = lifecycle.checkExpiredContracts();
    expect(count).toBe(0);

    const updated = contractService.getContract(contractId)!;
    expect(updated.status).toBe('active');
  });
});

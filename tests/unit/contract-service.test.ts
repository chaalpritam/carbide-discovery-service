import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase } from '../../src/database/index.js';
import { ContractService } from '../../src/services/contract-service.js';
import { randomUUID } from 'node:crypto';

describe('ContractService', () => {
  let db: Database.Database;
  let service: ContractService;
  let defaultProviderId: string;

  beforeEach(() => {
    db = initDatabase(':memory:');
    service = new ContractService(db);

    // Insert a provider to satisfy FOREIGN KEY constraint
    defaultProviderId = randomUUID();
    db.prepare(`
      INSERT INTO providers (id, name, tier, region, endpoint, available_capacity, total_capacity,
        price_per_gb_month, last_seen, metadata, rep_overall, rep_uptime, rep_data_integrity,
        rep_response_time, rep_contract_compliance, rep_community_feedback, rep_contracts_completed,
        rep_last_updated, registered_at, last_heartbeat, health_status, failed_health_checks,
        current_load, available_storage, active_contracts)
      VALUES (?, 'test-provider', 'Home', 'NorthAmerica', 'http://localhost:8080', 10000000000,
        25000000000, '0.005', datetime('now'), '{}', '0.5', '1.0', '1.0', '0.8', '1.0', '0.5',
        0, datetime('now'), datetime('now'), datetime('now'), 'Healthy', 0, 0.1, 10000000000, 0)
    `).run(defaultProviderId);
  });

  afterEach(() => {
    db.close();
  });

  const makeContract = (overrides: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    client_id: randomUUID(),
    provider_id: defaultProviderId,
    price_per_gb_month: '0.005',
    duration_months: 12,
    ...overrides,
  });

  describe('createContract', () => {
    it('returns record with default status pending_deposit', () => {
      const input = makeContract();
      const result = service.createContract(input);

      expect(result.id).toBe(input.id);
      expect(result.client_id).toBe(input.client_id);
      expect(result.provider_id).toBe(input.provider_id);
      expect(result.status).toBe('pending_deposit');
      expect(result.total_escrowed).toBe('0');
      expect(result.total_released).toBe('0');
      expect(result.proofs_submitted).toBe(0);
      expect(result.proofs_failed).toBe(0);
    });

    it('creates contract with optional fields (file_id, file_size, chain_id)', () => {
      const input = makeContract({
        file_id: 'abc123hash',
        file_size: 1048576,
        chain_id: 421614,
      });
      const result = service.createContract(input);

      expect(result.file_id).toBe('abc123hash');
      expect(result.file_size).toBe(1048576);
      expect(result.chain_id).toBe(421614);
    });

    it('creates contract without optional fields (null defaults)', () => {
      const input = makeContract();
      const result = service.createContract(input);

      expect(result.file_id).toBeNull();
      expect(result.file_size).toBeNull();
      expect(result.chain_id).toBeNull();
    });
  });

  describe('getContract', () => {
    it('returns null/undefined for non-existent ID', () => {
      const result = service.getContract(randomUUID());
      expect(result).toBeFalsy();
    });

    it('returns contract by ID', () => {
      const input = makeContract();
      service.createContract(input);

      const result = service.getContract(input.id);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(input.id);
    });
  });

  describe('listContracts', () => {
    it('returns all contracts with no filters', () => {
      service.createContract(makeContract());
      service.createContract(makeContract());

      const result = service.listContracts();
      expect(result.length).toBe(2);
    });

    it('filters by client_id', () => {
      const clientId = randomUUID();
      service.createContract(makeContract({ client_id: clientId }));
      service.createContract(makeContract());

      const result = service.listContracts({ client_id: clientId });
      expect(result.length).toBe(1);
      expect(result[0].client_id).toBe(clientId);
    });

    it('filters by provider_id', () => {
      // Insert a second provider
      const providerId2 = randomUUID();
      db.prepare(`
        INSERT INTO providers (id, name, tier, region, endpoint, available_capacity, total_capacity,
          price_per_gb_month, last_seen, metadata, rep_overall, rep_uptime, rep_data_integrity,
          rep_response_time, rep_contract_compliance, rep_community_feedback, rep_contracts_completed,
          rep_last_updated, registered_at, last_heartbeat, health_status, failed_health_checks,
          current_load, available_storage, active_contracts)
        VALUES (?, 'test-provider-2', 'Home', 'Europe', 'http://localhost:8081', 10000000000,
          25000000000, '0.005', datetime('now'), '{}', '0.5', '1.0', '1.0', '0.8', '1.0', '0.5',
          0, datetime('now'), datetime('now'), datetime('now'), 'Healthy', 0, 0.1, 10000000000, 0)
      `).run(providerId2);

      service.createContract(makeContract({ provider_id: defaultProviderId }));
      service.createContract(makeContract({ provider_id: providerId2 }));

      const result = service.listContracts({ provider_id: defaultProviderId });
      expect(result.length).toBe(1);
      expect(result[0].provider_id).toBe(defaultProviderId);
    });

    it('filters by status', () => {
      const c = makeContract();
      service.createContract(c);
      service.recordDeposit(c.id, '1000000');

      service.createContract(makeContract());

      const active = service.listContracts({ status: 'active' });
      expect(active.length).toBe(1);
      expect(active[0].id).toBe(c.id);

      const pending = service.listContracts({ status: 'pending_deposit' });
      expect(pending.length).toBe(1);
    });

    it('filters by combined client_id and status', () => {
      const clientId = randomUUID();
      const c1 = makeContract({ client_id: clientId });
      service.createContract(c1);
      service.recordDeposit(c1.id, '1000');

      service.createContract(makeContract({ client_id: clientId }));
      service.createContract(makeContract());

      const result = service.listContracts({ client_id: clientId, status: 'active' });
      expect(result.length).toBe(1);
      expect(result[0].id).toBe(c1.id);
    });
  });

  describe('recordDeposit', () => {
    it('updates status to active and sets total_escrowed', () => {
      const c = makeContract();
      service.createContract(c);
      service.recordDeposit(c.id, '5000000');

      const updated = service.getContract(c.id)!;
      expect(updated.status).toBe('active');
      expect(updated.total_escrowed).toBe('5000000');
    });

    it('inserts a deposit payment event', () => {
      const c = makeContract();
      service.createContract(c);
      service.recordDeposit(c.id, '5000000', '0xabc123');

      const events = service.getPaymentEvents(c.id);
      expect(events.length).toBe(1);
      expect(events[0].event_type).toBe('deposit');
      expect(events[0].amount).toBe('5000000');
      expect(events[0].tx_hash).toBe('0xabc123');
    });
  });

  describe('recordPaymentRelease', () => {
    it('accumulates total_released', () => {
      const c = makeContract();
      service.createContract(c);
      service.recordDeposit(c.id, '12000000');

      service.recordPaymentRelease(c.id, 1, '1000000');
      let updated = service.getContract(c.id)!;
      expect(updated.total_released).toBe('1000000');

      service.recordPaymentRelease(c.id, 2, '1000000');
      updated = service.getContract(c.id)!;
      expect(updated.total_released).toBe('2000000');
    });

    it('inserts release event with period', () => {
      const c = makeContract();
      service.createContract(c);
      service.recordDeposit(c.id, '12000000');
      service.recordPaymentRelease(c.id, 1, '1000000', '0xtx1');

      const events = service.getPaymentEvents(c.id);
      const release = events.find(e => e.event_type === 'release');
      expect(release).toBeDefined();
      expect(release!.period).toBe(1);
      expect(release!.amount).toBe('1000000');
      expect(release!.tx_hash).toBe('0xtx1');
    });

    it('does nothing for non-existent contract', () => {
      service.recordPaymentRelease(randomUUID(), 1, '1000');
      // Should not throw
    });
  });

  describe('getPaymentEvents', () => {
    it('returns events in chronological order', () => {
      const c = makeContract();
      service.createContract(c);
      service.recordDeposit(c.id, '12000000');
      service.recordPaymentRelease(c.id, 1, '1000000');
      service.recordPaymentRelease(c.id, 2, '1000000');

      const events = service.getPaymentEvents(c.id);
      expect(events.length).toBe(3);
      expect(events[0].event_type).toBe('deposit');
      expect(events[1].event_type).toBe('release');
      expect(events[2].event_type).toBe('release');
    });

    it('returns empty array for contract with no events', () => {
      const c = makeContract();
      service.createContract(c);

      const events = service.getPaymentEvents(c.id);
      expect(events.length).toBe(0);
    });
  });

  describe('getActiveContractsForProvider', () => {
    it('returns only active contracts for the provider', () => {
      const c1 = makeContract();
      service.createContract(c1);
      service.recordDeposit(c1.id, '5000000');

      const c2 = makeContract();
      service.createContract(c2);
      // c2 stays pending_deposit

      // Insert another provider for c3
      const otherProviderId = randomUUID();
      db.prepare(`
        INSERT INTO providers (id, name, tier, region, endpoint, available_capacity, total_capacity,
          price_per_gb_month, last_seen, metadata, rep_overall, rep_uptime, rep_data_integrity,
          rep_response_time, rep_contract_compliance, rep_community_feedback, rep_contracts_completed,
          rep_last_updated, registered_at, last_heartbeat, health_status, failed_health_checks,
          current_load, available_storage, active_contracts)
        VALUES (?, 'other-provider', 'Home', 'Europe', 'http://localhost:8082', 10000000000,
          25000000000, '0.005', datetime('now'), '{}', '0.5', '1.0', '1.0', '0.8', '1.0', '0.5',
          0, datetime('now'), datetime('now'), datetime('now'), 'Healthy', 0, 0.1, 10000000000, 0)
      `).run(otherProviderId);

      const c3 = makeContract({ provider_id: otherProviderId });
      service.createContract(c3);
      service.recordDeposit(c3.id, '5000000');

      const result = service.getActiveContractsForProvider(defaultProviderId);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe(c1.id);
    });
  });
});

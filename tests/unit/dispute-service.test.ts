import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase } from '../../src/database/index.js';
import { DisputeService } from '../../src/services/dispute-service.js';
import { randomUUID } from 'node:crypto';

describe('DisputeService', () => {
  let db: Database.Database;
  let service: DisputeService;
  let contractId: string;
  let providerId: string;

  beforeEach(() => {
    db = initDatabase(':memory:');
    service = new DisputeService(db);

    // Insert a provider and contract so FK constraints pass
    providerId = randomUUID();
    contractId = randomUUID();
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO providers (id, name, endpoint, available_capacity, total_capacity, price_per_gb_month, tier, region, last_seen, rep_last_updated, registered_at, last_heartbeat)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(providerId, 'test-provider', 'http://localhost:9000', 1000000, 5000000, '0.005', 'Home', 'NorthAmerica', now, now, now, now);

    db.prepare(
      `INSERT INTO storage_contracts (id, provider_id, client_id, status, price_per_gb_month, duration_months)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(contractId, providerId, 'client-1', 'active', '0.005', 1);
  });

  afterEach(() => {
    db.close();
  });

  describe('raiseDispute', () => {
    it('should create a dispute with default status open', () => {
      const dispute = service.raiseDispute({
        contract_id: contractId,
        raised_by: 'client-1',
        reason: 'Data not available',
      });

      expect(dispute.id).toBeDefined();
      expect(dispute.contract_id).toBe(contractId);
      expect(dispute.raised_by).toBe('client-1');
      expect(dispute.reason).toBe('Data not available');
      expect(dispute.status).toBe('open');
      expect(dispute.evidence).toBe('[]');
    });

    it('should store initial evidence', () => {
      const dispute = service.raiseDispute({
        contract_id: contractId,
        raised_by: 'client-1',
        reason: 'Missing data',
        evidence: [{ type: 'proof_failure', timestamp: '2025-01-01' }],
      });

      const parsed = JSON.parse(dispute.evidence);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].type).toBe('proof_failure');
    });
  });

  describe('addEvidence', () => {
    it('should append evidence to an open dispute', () => {
      const dispute = service.raiseDispute({
        contract_id: contractId,
        raised_by: 'client-1',
        reason: 'Issues',
      });

      const updated = service.addEvidence(dispute.id, { screenshot: 'img1.png' });
      expect(updated).not.toBeNull();
      const evidence = JSON.parse(updated!.evidence);
      expect(evidence).toHaveLength(1);
      expect(evidence[0].screenshot).toBe('img1.png');
    });

    it('should return null for non-existent dispute', () => {
      const result = service.addEvidence(randomUUID(), { data: 'test' });
      expect(result).toBeNull();
    });

    it('should not add evidence to resolved dispute', () => {
      const dispute = service.raiseDispute({
        contract_id: contractId,
        raised_by: 'client-1',
        reason: 'Issues',
      });
      service.resolveDispute(dispute.id, {
        resolution: 'Provider refund',
        resolved_by: 'admin',
      });

      const result = service.addEvidence(dispute.id, { data: 'test' });
      expect(result).toBeNull();
    });
  });

  describe('resolveDispute', () => {
    it('should resolve an open dispute', () => {
      const dispute = service.raiseDispute({
        contract_id: contractId,
        raised_by: 'client-1',
        reason: 'Test',
      });

      const resolved = service.resolveDispute(dispute.id, {
        resolution: 'Full refund to client',
        provider_amount: '0',
        client_amount: '10.00',
        resolved_by: 'admin',
      });

      expect(resolved).not.toBeNull();
      expect(resolved!.status).toBe('resolved');
      expect(resolved!.resolution).toBe('Full refund to client');
      expect(resolved!.provider_amount).toBe('0');
      expect(resolved!.client_amount).toBe('10.00');
      expect(resolved!.resolved_by).toBe('admin');
      expect(resolved!.resolved_at).toBeDefined();
    });

    it('should return null for already resolved dispute', () => {
      const dispute = service.raiseDispute({
        contract_id: contractId,
        raised_by: 'client-1',
        reason: 'Test',
      });
      service.resolveDispute(dispute.id, {
        resolution: 'First resolution',
        resolved_by: 'admin',
      });

      const result = service.resolveDispute(dispute.id, {
        resolution: 'Second attempt',
        resolved_by: 'admin',
      });
      expect(result).toBeNull();
    });
  });

  describe('getDispute', () => {
    it('should return null for non-existent dispute', () => {
      expect(service.getDispute(randomUUID())).toBeNull();
    });

    it('should return dispute by ID', () => {
      const created = service.raiseDispute({
        contract_id: contractId,
        raised_by: 'client-1',
        reason: 'Test',
      });

      const fetched = service.getDispute(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
    });
  });

  describe('listDisputes', () => {
    it('should list all disputes', () => {
      service.raiseDispute({ contract_id: contractId, raised_by: 'c1', reason: 'r1' });
      service.raiseDispute({ contract_id: contractId, raised_by: 'c2', reason: 'r2' });

      const disputes = service.listDisputes();
      expect(disputes).toHaveLength(2);
    });

    it('should filter by contract ID', () => {
      service.raiseDispute({ contract_id: contractId, raised_by: 'c1', reason: 'r1' });

      const disputes = service.listDisputes(contractId);
      expect(disputes).toHaveLength(1);

      const empty = service.listDisputes(randomUUID());
      expect(empty).toHaveLength(0);
    });

    it('should filter by status', () => {
      const d = service.raiseDispute({ contract_id: contractId, raised_by: 'c1', reason: 'r1' });
      service.raiseDispute({ contract_id: contractId, raised_by: 'c2', reason: 'r2' });
      service.resolveDispute(d.id, { resolution: 'done', resolved_by: 'admin' });

      const open = service.listDisputes(undefined, 'open');
      expect(open).toHaveLength(1);

      const resolved = service.listDisputes(undefined, 'resolved');
      expect(resolved).toHaveLength(1);
    });
  });
});

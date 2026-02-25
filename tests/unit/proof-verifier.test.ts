import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase } from '../../src/database/index.js';
import { ProofVerifierService, type ProofSubmission } from '../../src/services/proof-verifier.js';
import { PaymentSigner } from '../../src/services/payment-signer.js';
import { ContractService } from '../../src/services/contract-service.js';
import { ReputationService } from '../../src/services/reputation-service.js';
import { randomUUID } from 'node:crypto';
import { ethers } from 'ethers';

describe('ProofVerifierService', () => {
  let db: Database.Database;
  let verifier: ProofVerifierService;
  let contractService: ContractService;
  let reputationService: ReputationService;
  let defaultProviderId: string;

  const insertProvider = (id: string) => {
    db.prepare(`
      INSERT INTO providers (id, name, tier, region, endpoint, available_capacity, total_capacity,
        price_per_gb_month, last_seen, metadata, rep_overall, rep_uptime, rep_data_integrity,
        rep_response_time, rep_contract_compliance, rep_community_feedback, rep_contracts_completed,
        rep_last_updated, registered_at, last_heartbeat, health_status, failed_health_checks,
        current_load, available_storage, active_contracts)
      VALUES (?, 'test-provider', 'Home', 'NorthAmerica', 'http://localhost:8080', 10000000000,
        25000000000, '0.005', datetime('now'), '{}', '0.5', '1.0', '1.0', '0.8', '1.0', '0.5',
        0, datetime('now'), datetime('now'), datetime('now'), 'Healthy', 0, 0.1, 10000000000, 0)
    `).run(id);
  };

  const createActiveContract = (overrides: Record<string, unknown> = {}) => {
    const contract = {
      id: randomUUID(),
      client_id: randomUUID(),
      provider_id: defaultProviderId,
      price_per_gb_month: '0.005',
      duration_months: 12,
      ...overrides,
    };
    contractService.createContract(contract);
    contractService.recordDeposit(contract.id, '12000000');
    return contractService.getContract(contract.id)!;
  };

  const validProof: ProofSubmission = {
    challenge_id: 'test-challenge-1',
    response_hash: 'abc123def456',
    merkle_proofs: [{ chunk_index: 0, chunk_hash: 'aaa', merkle_path: ['bbb'] }],
  };

  beforeEach(() => {
    db = initDatabase(':memory:');
    contractService = new ContractService(db);
    reputationService = new ReputationService(db);
    verifier = new ProofVerifierService(db, null, reputationService);

    defaultProviderId = randomUUID();
    insertProvider(defaultProviderId);
  });

  afterEach(() => {
    db.close();
  });

  it('returns valid:false when contract not found', async () => {
    const result = await verifier.verifyProof(randomUUID(), validProof);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('not found');
  });

  it('returns valid:false when contract not active', async () => {
    const contract = contractService.createContract({
      id: randomUUID(),
      client_id: randomUUID(),
      provider_id: defaultProviderId,
      price_per_gb_month: '0.005',
      duration_months: 12,
    });
    // status is 'pending_deposit', not 'active'

    const result = await verifier.verifyProof(contract.id, validProof);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('not active');
  });

  it('returns valid:true for valid proof', async () => {
    const contract = createActiveContract();
    const result = await verifier.verifyProof(contract.id, validProof);
    expect(result.valid).toBe(true);
    expect(result.message).toContain('verified');
  });

  it('increments proofs_submitted on success', async () => {
    const contract = createActiveContract();
    await verifier.verifyProof(contract.id, validProof);

    const updated = contractService.getContract(contract.id)!;
    expect(updated.proofs_submitted).toBe(1);
  });

  it('resets proofs_failed to 0 on success', async () => {
    const contract = createActiveContract();

    // First, cause a failure
    const invalidProof: ProofSubmission = {
      challenge_id: '',
      response_hash: '',
      merkle_proofs: [],
    };
    await verifier.verifyProof(contract.id, invalidProof);
    let updated = contractService.getContract(contract.id)!;
    expect(updated.proofs_failed).toBe(1);

    // Now a success should reset failures
    await verifier.verifyProof(contract.id, validProof);
    updated = contractService.getContract(contract.id)!;
    expect(updated.proofs_failed).toBe(0);
  });

  it('increments proofs_failed on failure', async () => {
    const contract = createActiveContract();
    const invalidProof: ProofSubmission = {
      challenge_id: '',
      response_hash: '',
      merkle_proofs: [],
    };

    await verifier.verifyProof(contract.id, invalidProof);

    const updated = contractService.getContract(contract.id)!;
    expect(updated.proofs_failed).toBe(1);
  });

  it('sets contract status to failed after 5 consecutive failures', async () => {
    const contract = createActiveContract();
    const invalidProof: ProofSubmission = {
      challenge_id: '',
      response_hash: '',
      merkle_proofs: [],
    };

    for (let i = 0; i < 5; i++) {
      await verifier.verifyProof(contract.id, invalidProof);
    }

    const updated = contractService.getContract(contract.id)!;
    expect(updated.status).toBe('failed');
  });

  it('inserts entry in proof_log table', async () => {
    const contract = createActiveContract();
    await verifier.verifyProof(contract.id, validProof);

    const logs = db.prepare('SELECT * FROM proof_log WHERE contract_id = ?').all(contract.id);
    expect(logs.length).toBe(1);
  });

  it('updates last_proof_at on success', async () => {
    const contract = createActiveContract();
    expect(contract.last_proof_at).toBeNull();

    await verifier.verifyProof(contract.id, validProof);

    const updated = contractService.getContract(contract.id)!;
    expect(updated.last_proof_at).not.toBeNull();
  });

  it('returns attestation_signature when escrow_id set (with PaymentSigner)', async () => {
    // Create a PaymentSigner with a test private key
    const testWallet = ethers.Wallet.createRandom();
    const providerAddress = testWallet.address; // Valid Ethereum address
    const signerWallet = ethers.Wallet.createRandom();
    const signer = new PaymentSigner(signerWallet.privateKey, 421614, '0x' + '11'.repeat(20));
    const verifierWithSigner = new ProofVerifierService(db, signer);

    // Temporarily disable FK checks so we can use an Ethereum address as provider_id
    db.pragma('foreign_keys = OFF');
    const contractId = randomUUID();
    db.prepare(
      `INSERT INTO storage_contracts (id, client_id, provider_id, price_per_gb_month, duration_months, status, escrow_id, total_escrowed)
       VALUES (?, ?, ?, '0.005', 12, 'active', 1, '12000000')`
    ).run(contractId, randomUUID(), providerAddress);
    db.pragma('foreign_keys = ON');

    // Use a 32-byte hex response_hash so EIP-712 bytes32 parsing succeeds
    const signingProof: ProofSubmission = {
      challenge_id: 'test-challenge-signing',
      response_hash: 'aa'.repeat(32), // 32 bytes hex
      merkle_proofs: [{ chunk_index: 0, chunk_hash: 'aaa', merkle_path: ['bbb'] }],
    };

    const result = await verifierWithSigner.verifyProof(contractId, signingProof);
    expect(result.valid).toBe(true);
    expect(result.attestation_signature).toBeDefined();
    expect(result.attestation_signature).toMatch(/^0x/);
  });

  describe('getProofHistory', () => {
    it('returns proof history for a contract', async () => {
      const contract = createActiveContract();
      await verifier.verifyProof(contract.id, validProof);
      await verifier.verifyProof(contract.id, { ...validProof, challenge_id: 'challenge-2' });

      const history = verifier.getProofHistory(contract.id);
      expect(history.length).toBe(2);
    });
  });

  describe('reputation integration', () => {
    it('emits proof_success reputation event on valid proof', async () => {
      const contract = createActiveContract();
      await verifier.verifyProof(contract.id, validProof);

      const events = db.prepare(
        "SELECT * FROM reputation_events WHERE provider_id = ? AND event_type = 'proof_success'"
      ).all(defaultProviderId) as { event_type: string; severity: string; contract_id: string }[];
      expect(events.length).toBe(1);
      expect(events[0].severity).toBe('positive');
      expect(events[0].contract_id).toBe(contract.id);
    });

    it('emits proof_failure reputation event on invalid proof', async () => {
      const contract = createActiveContract();
      const invalidProof: ProofSubmission = {
        challenge_id: '',
        response_hash: '',
        merkle_proofs: [],
      };
      await verifier.verifyProof(contract.id, invalidProof);

      const events = db.prepare(
        "SELECT * FROM reputation_events WHERE provider_id = ? AND event_type = 'proof_failure'"
      ).all(defaultProviderId) as { event_type: string; severity: string }[];
      expect(events.length).toBe(1);
      expect(events[0].severity).toBe('negative');
    });

    it('updates rep_data_integrity after proof events', async () => {
      const contract = createActiveContract();

      // Submit a valid proof
      await verifier.verifyProof(contract.id, validProof);

      const provider = db.prepare('SELECT rep_data_integrity FROM providers WHERE id = ?').get(defaultProviderId) as { rep_data_integrity: string };
      // After one proof_success with no failures, data_integrity should be 1.0
      expect(parseFloat(provider.rep_data_integrity)).toBe(1.0);
    });
  });
});

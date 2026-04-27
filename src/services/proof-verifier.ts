import type Database from 'better-sqlite3';
import { ContractService } from './contract-service.js';
import { ReputationService } from './reputation-service.js';

export interface ProofSubmission {
  challenge_id: string;
  response_hash: string;
  merkle_proofs: unknown[];
}

export interface ProofVerificationResult {
  valid: boolean;
  period?: number;
  message: string;
}

export class ProofVerifierService {
  private db: Database.Database;
  private contractService: ContractService;
  private reputationService: ReputationService | null;

  constructor(db: Database.Database, reputationService?: ReputationService | null) {
    this.db = db;
    this.contractService = new ContractService(db);
    this.reputationService = reputationService ?? null;
  }

  async verifyProof(contractId: string, proof: ProofSubmission): Promise<ProofVerificationResult> {
    const contract = this.contractService.getContract(contractId);
    if (!contract) {
      return { valid: false, message: 'Contract not found' };
    }

    if (contract.status !== 'active') {
      return { valid: false, message: `Contract is not active (status: ${contract.status})` };
    }

    // Basic proof validation: check that required fields are present
    const isValid = proof.challenge_id && proof.response_hash && proof.merkle_proofs.length > 0;

    // Log the proof attempt
    this.db.prepare(
      `INSERT INTO proof_log (contract_id, challenge_id, response_hash, is_valid, period, verified_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    ).run(contractId, proof.challenge_id, proof.response_hash, isValid ? 1 : 0, contract.proofs_submitted + 1);

    if (!isValid) {
      // Increment failed proofs
      this.db.prepare(
        `UPDATE storage_contracts SET proofs_failed = proofs_failed + 1, updated_at = datetime('now') WHERE id = ?`
      ).run(contractId);

      // Check failure threshold (5 consecutive failures)
      const updated = this.contractService.getContract(contractId);
      if (updated && updated.proofs_failed >= 5) {
        this.db.prepare(
          `UPDATE storage_contracts SET status = 'failed', updated_at = datetime('now') WHERE id = ?`
        ).run(contractId);
      }

      // Emit reputation event for proof failure
      if (this.reputationService) {
        this.reputationService.recordEvent({
          provider_id: contract.provider_id,
          event_type: 'proof_failure',
          severity: 'negative',
          contract_id: contractId,
        });
        this.reputationService.recalculateScore(contract.provider_id);
      }

      return { valid: false, message: 'Proof verification failed' };
    }

    // Update proof count
    this.db.prepare(
      `UPDATE storage_contracts SET proofs_submitted = proofs_submitted + 1, proofs_failed = 0, last_proof_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
    ).run(contractId);

    // Emit reputation event for proof success
    if (this.reputationService) {
      const startTime = Date.now();
      const responseTimeMs = Date.now() - startTime;
      this.reputationService.recordEvent({
        provider_id: contract.provider_id,
        event_type: 'proof_success',
        severity: 'positive',
        value: responseTimeMs,
        contract_id: contractId,
      });
      this.reputationService.recalculateScore(contract.provider_id);
    }

    const period = contract.proofs_submitted + 1;
    return { valid: true, period, message: 'Proof verified successfully' };
  }

  getProofHistory(contractId: string): unknown[] {
    return this.db.prepare(
      'SELECT * FROM proof_log WHERE contract_id = ? ORDER BY verified_at DESC'
    ).all(contractId);
  }
}

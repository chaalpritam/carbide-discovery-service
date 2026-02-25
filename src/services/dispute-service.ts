import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export interface DisputeRecord {
  id: string;
  contract_id: string;
  raised_by: string;
  reason: string;
  evidence: string;
  status: string;
  resolution: string | null;
  provider_amount: string | null;
  client_amount: string | null;
  resolved_by: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface RaiseDisputeInput {
  contract_id: string;
  raised_by: string;
  reason: string;
  evidence?: unknown[];
}

export interface ResolveDisputeInput {
  resolution: string;
  provider_amount?: string;
  client_amount?: string;
  resolved_by: string;
}

export class DisputeService {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  raiseDispute(input: RaiseDisputeInput): DisputeRecord {
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO disputes (id, contract_id, raised_by, reason, evidence)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      id,
      input.contract_id,
      input.raised_by,
      input.reason,
      JSON.stringify(input.evidence ?? []),
    );
    return this.db.prepare('SELECT * FROM disputes WHERE id = ?').get(id) as DisputeRecord;
  }

  addEvidence(disputeId: string, evidence: unknown): DisputeRecord | null {
    const dispute = this.getDispute(disputeId);
    if (!dispute || dispute.status !== 'open') return null;

    const existing = JSON.parse(dispute.evidence) as unknown[];
    existing.push(evidence);

    this.db.prepare(
      `UPDATE disputes SET evidence = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(JSON.stringify(existing), disputeId);

    return this.db.prepare('SELECT * FROM disputes WHERE id = ?').get(disputeId) as DisputeRecord;
  }

  resolveDispute(disputeId: string, input: ResolveDisputeInput): DisputeRecord | null {
    const dispute = this.getDispute(disputeId);
    if (!dispute || dispute.status !== 'open') return null;

    this.db.prepare(
      `UPDATE disputes SET
        status = 'resolved',
        resolution = ?,
        provider_amount = ?,
        client_amount = ?,
        resolved_by = ?,
        resolved_at = datetime('now'),
        updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      input.resolution,
      input.provider_amount ?? null,
      input.client_amount ?? null,
      input.resolved_by,
      disputeId,
    );

    return this.db.prepare('SELECT * FROM disputes WHERE id = ?').get(disputeId) as DisputeRecord;
  }

  getDispute(id: string): DisputeRecord | null {
    const row = this.db.prepare('SELECT * FROM disputes WHERE id = ?').get(id) as DisputeRecord | undefined;
    return row ?? null;
  }

  listDisputes(contractId?: string, status?: string): DisputeRecord[] {
    let query = 'SELECT * FROM disputes';
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (contractId) {
      conditions.push('contract_id = ?');
      params.push(contractId);
    }
    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY created_at DESC';

    return this.db.prepare(query).all(...params) as DisputeRecord[];
  }
}

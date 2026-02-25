import type Database from 'better-sqlite3';

export interface StorageContractRecord {
  id: string;
  client_id: string;
  provider_id: string;
  file_id: string | null;
  file_size: number | null;
  price_per_gb_month: string;
  duration_months: number;
  status: string;
  chain_id: number | null;
  escrow_id: number | null;
  total_escrowed: string;
  total_released: string;
  proofs_submitted: number;
  proofs_failed: number;
  last_proof_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentEvent {
  id: number;
  contract_id: string;
  event_type: string;
  amount: string;
  period: number | null;
  tx_hash: string | null;
  created_at: string;
}

export class ContractService {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  createContract(contract: {
    id: string;
    client_id: string;
    provider_id: string;
    file_id?: string;
    file_size?: number;
    price_per_gb_month: string;
    duration_months: number;
    chain_id?: number;
  }): StorageContractRecord {
    this.db.prepare(
      `INSERT INTO storage_contracts (id, client_id, provider_id, file_id, file_size, price_per_gb_month, duration_months, chain_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      contract.id, contract.client_id, contract.provider_id,
      contract.file_id ?? null, contract.file_size ?? null,
      contract.price_per_gb_month, contract.duration_months,
      contract.chain_id ?? null
    );
    return this.getContract(contract.id)!;
  }

  getContract(id: string): StorageContractRecord | null {
    return this.db.prepare('SELECT * FROM storage_contracts WHERE id = ?').get(id) as StorageContractRecord | null;
  }

  listContracts(filters?: { client_id?: string; provider_id?: string; status?: string }): StorageContractRecord[] {
    let query = 'SELECT * FROM storage_contracts WHERE 1=1';
    const params: unknown[] = [];
    if (filters?.client_id) { query += ' AND client_id = ?'; params.push(filters.client_id); }
    if (filters?.provider_id) { query += ' AND provider_id = ?'; params.push(filters.provider_id); }
    if (filters?.status) { query += ' AND status = ?'; params.push(filters.status); }
    query += ' ORDER BY created_at DESC';
    return this.db.prepare(query).all(...params) as StorageContractRecord[];
  }

  recordDeposit(contractId: string, amount: string, txHash?: string): void {
    this.db.prepare(
      `UPDATE storage_contracts SET status = 'active', total_escrowed = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(amount, contractId);

    this.db.prepare(
      `INSERT INTO payment_events (contract_id, event_type, amount, tx_hash) VALUES (?, 'deposit', ?, ?)`
    ).run(contractId, amount, txHash ?? null);
  }

  recordPaymentRelease(contractId: string, period: number, amount: string, txHash?: string): void {
    const contract = this.getContract(contractId);
    if (!contract) return;

    const newReleased = (BigInt(contract.total_released) + BigInt(amount)).toString();
    this.db.prepare(
      `UPDATE storage_contracts SET total_released = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(newReleased, contractId);

    this.db.prepare(
      `INSERT INTO payment_events (contract_id, event_type, amount, period, tx_hash) VALUES (?, 'release', ?, ?, ?)`
    ).run(contractId, amount, period, txHash ?? null);
  }

  getPaymentEvents(contractId: string): PaymentEvent[] {
    return this.db.prepare(
      'SELECT * FROM payment_events WHERE contract_id = ? ORDER BY created_at ASC'
    ).all(contractId) as PaymentEvent[];
  }

  getActiveContractsForProvider(providerId: string): StorageContractRecord[] {
    return this.db.prepare(
      "SELECT * FROM storage_contracts WHERE provider_id = ? AND status = 'active'"
    ).all(providerId) as StorageContractRecord[];
  }

  getExpiredContracts(): StorageContractRecord[] {
    return this.db.prepare(
      `SELECT * FROM storage_contracts
       WHERE status = 'active'
         AND datetime(created_at, '+' || duration_months || ' months') < datetime('now')`
    ).all() as StorageContractRecord[];
  }

  getStaleContracts(hoursThreshold: number = 48): StorageContractRecord[] {
    return this.db.prepare(
      `SELECT * FROM storage_contracts
       WHERE status = 'active'
         AND last_proof_at IS NOT NULL
         AND last_proof_at < datetime('now', ? || ' hours')
         AND created_at < datetime('now', '-48 hours')`
    ).all(`-${hoursThreshold}`) as StorageContractRecord[];
  }

  updateStatus(contractId: string, newStatus: string): void {
    this.db.prepare(
      `UPDATE storage_contracts SET status = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(newStatus, contractId);
  }
}

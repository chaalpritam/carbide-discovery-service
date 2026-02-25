CREATE TABLE IF NOT EXISTS proof_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id TEXT NOT NULL,
  challenge_id TEXT NOT NULL,
  response_hash TEXT,
  is_valid INTEGER NOT NULL DEFAULT 0,
  period INTEGER,
  verified_at TEXT NOT NULL DEFAULT (datetime('now')),
  attestation_signature TEXT,
  FOREIGN KEY (contract_id) REFERENCES storage_contracts(id)
);

CREATE INDEX IF NOT EXISTS idx_proof_log_contract ON proof_log(contract_id);
CREATE INDEX IF NOT EXISTS idx_proof_log_period ON proof_log(contract_id, period);

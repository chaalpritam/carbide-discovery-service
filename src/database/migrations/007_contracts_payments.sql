CREATE TABLE IF NOT EXISTS storage_contracts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  file_id TEXT,
  file_size INTEGER,
  price_per_gb_month TEXT NOT NULL,
  duration_months INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_deposit',
  chain_id INTEGER,
  escrow_id INTEGER,
  total_escrowed TEXT DEFAULT '0',
  total_released TEXT DEFAULT '0',
  proofs_submitted INTEGER NOT NULL DEFAULT 0,
  proofs_failed INTEGER NOT NULL DEFAULT 0,
  last_proof_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (provider_id) REFERENCES providers(id)
);

CREATE TABLE IF NOT EXISTS payment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  amount TEXT NOT NULL,
  period INTEGER,
  tx_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (contract_id) REFERENCES storage_contracts(id)
);

CREATE INDEX IF NOT EXISTS idx_contracts_client ON storage_contracts(client_id);
CREATE INDEX IF NOT EXISTS idx_contracts_provider ON storage_contracts(provider_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON storage_contracts(status);
CREATE INDEX IF NOT EXISTS idx_payment_events_contract ON payment_events(contract_id);

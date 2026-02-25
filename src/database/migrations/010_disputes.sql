CREATE TABLE IF NOT EXISTS disputes (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL,
  raised_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence TEXT DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open',
  resolution TEXT,
  provider_amount TEXT,
  client_amount TEXT,
  resolved_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  FOREIGN KEY (contract_id) REFERENCES storage_contracts(id)
);

CREATE INDEX IF NOT EXISTS idx_disputes_contract ON disputes(contract_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status);

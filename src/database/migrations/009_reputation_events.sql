CREATE TABLE IF NOT EXISTS reputation_events (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'neutral',
  value REAL,
  details TEXT DEFAULT '{}',
  contract_id TEXT,
  file_id TEXT,
  client_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (provider_id) REFERENCES providers(id)
);

CREATE INDEX IF NOT EXISTS idx_reputation_events_provider ON reputation_events(provider_id);
CREATE INDEX IF NOT EXISTS idx_reputation_events_type ON reputation_events(event_type);
CREATE INDEX IF NOT EXISTS idx_reputation_events_created ON reputation_events(created_at);

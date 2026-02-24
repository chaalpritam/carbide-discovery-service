CREATE TABLE IF NOT EXISTS file_providers (
  file_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  stored_at TEXT NOT NULL DEFAULT (datetime('now')),
  file_size INTEGER,
  PRIMARY KEY (file_id, provider_id),
  FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_file_providers_file ON file_providers(file_id);
CREATE INDEX IF NOT EXISTS idx_file_providers_provider ON file_providers(provider_id);

-- Migration 013: Track where each provider row came from.
--
-- Adds a `source` column so the registry indexer and the HTTP register
-- endpoint can coexist on the same providers table. Registry-sourced
-- rows are reconstructed from on-chain events and never heartbeat via
-- HTTP, so background jobs (HealthChecker, etc.) can skip them.

ALTER TABLE providers ADD COLUMN source TEXT NOT NULL DEFAULT 'http'
  CHECK(source IN ('http', 'registry'));

-- Ethereum owner address for on-chain rows; NULL for legacy HTTP rows.
ALTER TABLE providers ADD COLUMN chain_owner TEXT;

CREATE INDEX IF NOT EXISTS idx_providers_source ON providers(source);
CREATE INDEX IF NOT EXISTS idx_providers_chain_owner ON providers(chain_owner);

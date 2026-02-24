-- Migration 001: Initial schema for Carbide Discovery Service
-- Creates the providers table with flattened reputation and registry fields

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tier TEXT NOT NULL CHECK(tier IN ('Home','Professional','Enterprise','GlobalCDN')),
  region TEXT NOT NULL CHECK(region IN ('NorthAmerica','Europe','Asia','SouthAmerica','Africa','Oceania')),
  endpoint TEXT NOT NULL,
  available_capacity INTEGER NOT NULL,
  total_capacity INTEGER NOT NULL,
  price_per_gb_month TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  metadata TEXT DEFAULT '{}',
  -- Reputation fields (flattened to avoid joins)
  rep_overall TEXT NOT NULL DEFAULT '0.5',
  rep_uptime TEXT NOT NULL DEFAULT '0.5',
  rep_data_integrity TEXT NOT NULL DEFAULT '0.5',
  rep_response_time TEXT NOT NULL DEFAULT '0.5',
  rep_contract_compliance TEXT NOT NULL DEFAULT '0.5',
  rep_community_feedback TEXT NOT NULL DEFAULT '0.5',
  rep_contracts_completed INTEGER NOT NULL DEFAULT 0,
  rep_last_updated TEXT NOT NULL,
  -- Registry entry fields
  registered_at TEXT NOT NULL,
  last_heartbeat TEXT NOT NULL,
  health_status TEXT NOT NULL DEFAULT 'Healthy',
  failed_health_checks INTEGER NOT NULL DEFAULT 0,
  current_load REAL,
  available_storage INTEGER,
  active_contracts INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_providers_region ON providers(region);
CREATE INDEX IF NOT EXISTS idx_providers_tier ON providers(tier);
CREATE INDEX IF NOT EXISTS idx_providers_health ON providers(health_status);
CREATE INDEX IF NOT EXISTS idx_providers_reputation ON providers(rep_overall);

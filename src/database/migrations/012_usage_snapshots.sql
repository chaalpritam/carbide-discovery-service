CREATE TABLE IF NOT EXISTS usage_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_date TEXT NOT NULL,
  total_providers INTEGER NOT NULL,
  online_providers INTEGER NOT NULL,
  total_storage_bytes INTEGER NOT NULL,
  used_storage_bytes INTEGER NOT NULL,
  active_contracts INTEGER NOT NULL,
  new_contracts_today INTEGER NOT NULL,
  total_escrowed TEXT NOT NULL DEFAULT '0',
  avg_price_per_gb TEXT NOT NULL DEFAULT '0',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_snapshots_date ON usage_snapshots(snapshot_date);

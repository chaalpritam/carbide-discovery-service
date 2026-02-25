import Database from 'better-sqlite3';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function initDatabase(dbPath: string): Database.Database {
  // Auto-create data directory if it doesn't exist
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);

  // Enable WAL mode for concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  // Run migrations
  runMigrations(db);

  return db;
}

function runMigrations(db: Database.Database): void {
  // Create migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const migrationDir = resolve(__dirname, 'migrations');
  const migrationFiles = ['001_initial.sql', '002_file_providers.sql', '003_api_keys.sql', '004_audit_log.sql', '005_users.sql', '006_provider_wallet.sql', '007_contracts_payments.sql', '008_proof_log.sql', '009_reputation_events.sql', '010_disputes.sql'];

  const applied = new Set(
    db.prepare('SELECT name FROM _migrations').all()
      .map((row: unknown) => (row as { name: string }).name)
  );

  for (const file of migrationFiles) {
    if (applied.has(file)) {
      continue;
    }

    const sql = readFileSync(resolve(migrationDir, file), 'utf-8');
    db.exec(sql);
    db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
  }
}

export type { Database };

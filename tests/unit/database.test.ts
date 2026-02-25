import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDatabase } from '../../src/database/index.js';
import { ProviderQueries } from '../../src/database/queries.js';
import { makeProvider } from '../helpers/fixtures.js';
import type Database from 'better-sqlite3';

function makeEntry(overrides: Record<string, unknown> = {}) {
  const provider = makeProvider(overrides);
  return {
    provider,
    registered_at: new Date(),
    last_heartbeat: new Date(),
    health_status: 'Healthy' as const,
    failed_health_checks: 0,
    current_load: 0.1,
    available_storage: provider.available_capacity,
    active_contracts: 0,
  };
}

describe('ProviderQueries', () => {
  let db: Database.Database;
  let queries: ProviderQueries;

  beforeEach(() => {
    db = initDatabase(':memory:');
    queries = new ProviderQueries(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should insert and retrieve a provider', () => {
    const entry = makeEntry();
    queries.upsertProvider(entry);

    const result = queries.getProvider(entry.provider.id);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(entry.provider.id);
    expect(result!.name).toBe(entry.provider.name);
    expect(result!.tier).toBe(entry.provider.tier);
  });

  it('should delete a provider', () => {
    const entry = makeEntry();
    queries.upsertProvider(entry);

    const deleted = queries.deleteProvider(entry.provider.id);
    expect(deleted).toBe(true);

    const result = queries.getProvider(entry.provider.id);
    expect(result).toBeNull();
  });

  it('should search providers with filters', () => {
    queries.upsertProvider(makeEntry({ region: 'NorthAmerica' }));
    queries.upsertProvider(makeEntry({ region: 'Europe' }));

    const result = queries.searchProviders(
      { region: 'NorthAmerica' as never },
      300000,
      100
    );
    expect(result.providers.length).toBe(1);
    expect(result.providers[0].region).toBe('NorthAmerica');
    expect(result.totalCount).toBe(1);
  });

  it('should compute stats', () => {
    queries.upsertProvider(makeEntry());

    const stats = queries.computeStats(300000);
    expect(stats.total_providers).toBe(1);
    expect(stats.online_providers).toBe(1);
  });

  it('should register and query file-provider mappings', () => {
    const entry = makeEntry();
    queries.upsertProvider(entry);

    const fileId = 'a'.repeat(64);
    queries.registerFileProvider(fileId, entry.provider.id, 1024);

    const providers = queries.getFileProviders(fileId, 300000);
    expect(providers.length).toBe(1);
    expect(providers[0].provider_id).toBe(entry.provider.id);
  });

  it('should remove file-provider mappings', () => {
    const entry = makeEntry();
    queries.upsertProvider(entry);

    const fileId = 'b'.repeat(64);
    queries.registerFileProvider(fileId, entry.provider.id, 2048);

    const removed = queries.removeFileProvider(fileId, entry.provider.id);
    expect(removed).toBe(true);

    const providers = queries.getFileProviders(fileId, 300000);
    expect(providers.length).toBe(0);
  });
});

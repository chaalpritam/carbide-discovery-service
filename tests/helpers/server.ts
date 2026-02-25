import { createServer } from '../../src/server.js';

export async function createTestServer(envOverrides: Record<string, string> = {}) {
  // Apply env overrides
  const original: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(envOverrides)) {
    original[key] = process.env[key];
    process.env[key] = value;
  }

  // Always use in-memory SQLite and silent logging for tests
  const prev = {
    DATABASE_PATH: process.env.DATABASE_PATH,
    LOG_LEVEL: process.env.LOG_LEVEL,
    NODE_ENV: process.env.NODE_ENV,
  };
  process.env.DATABASE_PATH = ':memory:';
  process.env.LOG_LEVEL = 'silent';
  process.env.NODE_ENV = 'test';

  const { server, config, db } = await createServer();

  // Restore env
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  process.env.DATABASE_PATH = prev.DATABASE_PATH;
  process.env.LOG_LEVEL = prev.LOG_LEVEL;
  process.env.NODE_ENV = prev.NODE_ENV;

  return { server, config, db };
}

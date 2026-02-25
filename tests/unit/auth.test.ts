import { describe, it, expect } from 'vitest';
import { generateApiKey, hashApiKey } from '../../src/middleware/auth.js';

describe('Auth utilities', () => {
  it('should generate an API key with cbk_ prefix', () => {
    const { raw, hash, prefix } = generateApiKey();

    expect(raw).toMatch(/^cbk_[a-f0-9]{64}$/);
    expect(hash).toHaveLength(64); // SHA-256 hex
    expect(prefix).toBe(raw.substring(0, 8));
  });

  it('should produce deterministic hashes', () => {
    const key = 'cbk_' + 'ab'.repeat(32);
    const h1 = hashApiKey(key);
    const h2 = hashApiKey(key);
    expect(h1).toBe(h2);
  });

  it('should produce different hashes for different keys', () => {
    const { hash: h1 } = generateApiKey();
    const { hash: h2 } = generateApiKey();
    expect(h1).not.toBe(h2);
  });
});

import { describe, it, expect } from 'vitest';
import { validateConfig, type DiscoveryConfig } from '../../src/config/index.js';

function makeConfig(overrides: Partial<DiscoveryConfig> = {}): DiscoveryConfig {
  return {
    host: '0.0.0.0',
    port: 9090,
    healthCheckInterval: 30000,
    providerTimeout: 300000,
    maxSearchResults: 100,
    logLevel: 'info',
    nodeEnv: 'test',
    corsOrigin: true,
    databasePath: ':memory:',
    authEnabled: false,
    authSecret: 'test-secret',
    jwtSecret: 'test-jwt-secret',
    jwtExpiresIn: '1h',
    ...overrides,
  };
}

describe('validateConfig', () => {
  it('accepts valid defaults', () => {
    expect(() => validateConfig(makeConfig())).not.toThrow();
  });

  it('rejects port 0', () => {
    expect(() => validateConfig(makeConfig({ port: 0 }))).toThrow('Invalid port');
  });

  it('rejects port above 65535', () => {
    expect(() => validateConfig(makeConfig({ port: 70000 }))).toThrow('Invalid port');
  });

  it('rejects zero healthCheckInterval', () => {
    expect(() => validateConfig(makeConfig({ healthCheckInterval: 0 }))).toThrow('healthCheckInterval');
  });

  it('rejects negative providerTimeout', () => {
    expect(() => validateConfig(makeConfig({ providerTimeout: -1 }))).toThrow('providerTimeout');
  });

  it('rejects maxSearchResults below 1', () => {
    expect(() => validateConfig(makeConfig({ maxSearchResults: 0 }))).toThrow('maxSearchResults');
  });

  it('rejects maxSearchResults above 1000', () => {
    expect(() => validateConfig(makeConfig({ maxSearchResults: 1500 }))).toThrow('maxSearchResults');
  });
});

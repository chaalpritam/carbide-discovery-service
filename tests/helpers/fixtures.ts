import { randomUUID } from 'node:crypto';

export function makeProvider(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  return {
    id,
    name: `test-provider-${id.slice(0, 8)}`,
    tier: 'Home',
    region: 'NorthAmerica',
    endpoint: `http://localhost:${3000 + Math.floor(Math.random() * 1000)}`,
    available_capacity: 10_000_000_000,
    total_capacity: 25_000_000_000,
    price_per_gb_month: '0.005',
    reputation: {
      overall: '0.5',
      uptime: '1.0',
      data_integrity: '1.0',
      response_time: '0.8',
      contract_compliance: '1.0',
      community_feedback: '0.5',
      contracts_completed: 0,
      last_updated: new Date().toISOString(),
    },
    last_seen: new Date().toISOString(),
    metadata: {},
    ...overrides,
  };
}

export function makeAnnouncement(overrides: Record<string, unknown> = {}) {
  const provider = makeProvider(overrides);
  return {
    provider,
    endpoint: provider.endpoint,
    supported_versions: ['1.0'],
    public_key: null,
  };
}

export function makeHealthCheck() {
  return {
    status: 'Healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    available_storage: 10_000_000_000,
    load: 0.1,
    reputation: '0.5',
  };
}

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase } from '../../src/database/index.js';
import { WebhookService } from '../../src/services/webhook-service.js';
import { randomUUID } from 'node:crypto';

describe('WebhookService', () => {
  let db: Database.Database;
  let service: WebhookService;

  beforeEach(() => {
    db = initDatabase(':memory:');
    service = new WebhookService(db);
  });

  afterEach(() => {
    db.close();
  });

  it('registers a webhook and creates DB row', () => {
    const webhook = service.register({
      owner_id: 'owner-1',
      url: 'https://example.com/hook',
      event_types: ['contract.created', 'proof.success'],
    });

    expect(webhook.id).toBeDefined();
    expect(webhook.owner_id).toBe('owner-1');
    expect(webhook.url).toBe('https://example.com/hook');
    expect(webhook.event_types).toEqual(['contract.created', 'proof.success']);
    expect(webhook.active).toBe(true);
  });

  it('lists webhooks for owner', () => {
    service.register({ owner_id: 'owner-1', url: 'https://a.com/hook', event_types: ['proof.success'] });
    service.register({ owner_id: 'owner-1', url: 'https://b.com/hook', event_types: ['proof.failure'] });
    service.register({ owner_id: 'owner-2', url: 'https://c.com/hook', event_types: ['proof.success'] });

    const hooks = service.listForOwner('owner-1');
    expect(hooks.length).toBe(2);
  });

  it('unregisters (deactivates) a webhook', () => {
    const webhook = service.register({
      owner_id: 'owner-1',
      url: 'https://example.com/hook',
      event_types: ['contract.created'],
    });

    service.unregister(webhook.id);

    const hooks = service.listForOwner('owner-1');
    expect(hooks.length).toBe(0);
  });

  it('dispatches event and creates delivery record', () => {
    const webhook = service.register({
      owner_id: 'owner-1',
      url: 'https://example.com/hook',
      event_types: ['contract.created'],
    });

    service.dispatch('contract.created', { contract_id: 'c-1', status: 'created' });

    const deliveries = service.getDeliveries(webhook.id);
    expect(deliveries.length).toBe(1);
    expect(deliveries[0].event_type).toBe('contract.created');
    expect(JSON.parse(deliveries[0].payload)).toEqual({ contract_id: 'c-1', status: 'created' });
  });

  it('does not create delivery for inactive webhook', () => {
    const webhook = service.register({
      owner_id: 'owner-1',
      url: 'https://example.com/hook',
      event_types: ['contract.created'],
    });

    service.unregister(webhook.id);
    service.dispatch('contract.created', { contract_id: 'c-2' });

    const deliveries = service.getDeliveries(webhook.id);
    expect(deliveries.length).toBe(0);
  });

  it('only dispatches to webhooks subscribed to the event type', () => {
    const hook1 = service.register({
      owner_id: 'owner-1',
      url: 'https://a.com/hook',
      event_types: ['contract.created'],
    });
    const hook2 = service.register({
      owner_id: 'owner-1',
      url: 'https://b.com/hook',
      event_types: ['proof.success'],
    });

    service.dispatch('contract.created', { test: true });

    expect(service.getDeliveries(hook1.id).length).toBe(1);
    expect(service.getDeliveries(hook2.id).length).toBe(0);
  });
});

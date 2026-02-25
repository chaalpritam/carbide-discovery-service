import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase } from '../../src/database/index.js';
import { ReputationService } from '../../src/services/reputation-service.js';
import { randomUUID } from 'node:crypto';

describe('ReputationService', () => {
  let db: Database.Database;
  let service: ReputationService;
  let providerId: string;

  beforeEach(() => {
    db = initDatabase(':memory:');
    service = new ReputationService(db);

    // Insert a provider so FK constraints pass
    providerId = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO providers (id, name, endpoint, available_capacity, total_capacity, price_per_gb_month, tier, region, last_seen, rep_last_updated, registered_at, last_heartbeat)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(providerId, 'test-provider', 'http://localhost:9000', 1000000, 5000000, '0.005', 'Home', 'NorthAmerica', now, now, now, now);
  });

  afterEach(() => {
    db.close();
  });

  describe('recordEvent', () => {
    it('should insert and return a reputation event', () => {
      const event = service.recordEvent({
        provider_id: providerId,
        event_type: 'online',
      });

      expect(event).toBeDefined();
      expect(event.id).toBeDefined();
      expect(event.provider_id).toBe(providerId);
      expect(event.event_type).toBe('online');
      expect(event.severity).toBe('neutral');
      expect(event.created_at).toBeDefined();
    });

    it('should store optional fields', () => {
      const contractId = randomUUID();
      const fileId = randomUUID();
      const clientId = randomUUID();

      const event = service.recordEvent({
        provider_id: providerId,
        event_type: 'proof_success',
        severity: 'positive',
        value: 150,
        details: { chunks: 5, method: 'merkle' },
        contract_id: contractId,
        file_id: fileId,
        client_id: clientId,
      });

      expect(event.severity).toBe('positive');
      expect(event.value).toBe(150);
      expect(JSON.parse(event.details)).toEqual({ chunks: 5, method: 'merkle' });
      expect(event.contract_id).toBe(contractId);
      expect(event.file_id).toBe(fileId);
      expect(event.client_id).toBe(clientId);
    });

    it('should default severity to neutral', () => {
      const event = service.recordEvent({
        provider_id: providerId,
        event_type: 'offline',
      });
      expect(event.severity).toBe('neutral');
    });
  });

  describe('getProviderEvents', () => {
    it('should return events for a provider', () => {
      service.recordEvent({ provider_id: providerId, event_type: 'online' });
      service.recordEvent({ provider_id: providerId, event_type: 'proof_success' });

      const events = service.getProviderEvents(providerId);
      expect(events).toHaveLength(2);
    });

    it('should return empty array for provider with no events', () => {
      const events = service.getProviderEvents(randomUUID());
      expect(events).toEqual([]);
    });

    it('should respect limit parameter', () => {
      service.recordEvent({ provider_id: providerId, event_type: 'online' });
      service.recordEvent({ provider_id: providerId, event_type: 'offline' });
      service.recordEvent({ provider_id: providerId, event_type: 'proof_success' });

      const events = service.getProviderEvents(providerId, undefined, 2);
      expect(events).toHaveLength(2);
    });

    it('should filter by since parameter', () => {
      // Insert an event with a past timestamp
      db.prepare(
        `INSERT INTO reputation_events (id, provider_id, event_type, severity, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(randomUUID(), providerId, 'online', 'positive', '2020-01-01 00:00:00');

      // Insert a recent event
      service.recordEvent({ provider_id: providerId, event_type: 'proof_success' });

      const events = service.getProviderEvents(providerId, '2024-01-01');
      expect(events).toHaveLength(1);
      expect(events[0].event_type).toBe('proof_success');
    });

    it('should order by created_at DESC', () => {
      db.prepare(
        `INSERT INTO reputation_events (id, provider_id, event_type, severity, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(randomUUID(), providerId, 'online', 'neutral', '2024-01-01 00:00:00');
      db.prepare(
        `INSERT INTO reputation_events (id, provider_id, event_type, severity, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(randomUUID(), providerId, 'offline', 'neutral', '2025-06-01 00:00:00');

      const events = service.getProviderEvents(providerId);
      expect(events[0].event_type).toBe('offline'); // newer first
      expect(events[1].event_type).toBe('online');
    });
  });

  describe('recalculateScore', () => {
    it('should return default 0.5 scores when no events exist', () => {
      const score = service.recalculateScore(providerId);

      expect(score.provider_id).toBe(providerId);
      expect(score.uptime).toBe(0.5);
      expect(score.data_integrity).toBe(0.5);
      expect(score.response_time).toBe(0.5);
      expect(score.contract_compliance).toBe(0.5);
      expect(score.community_feedback).toBe(0.5);
      expect(score.total_events).toBe(0);
      // overall = 0.5*0.25 + 0.5*0.25 + 0.5*0.20 + 0.5*0.20 + 0.5*0.10 = 0.5
      expect(score.overall).toBeCloseTo(0.5, 2);
    });

    it('should compute uptime score from online/offline events', () => {
      service.recordEvent({ provider_id: providerId, event_type: 'online' });
      service.recordEvent({ provider_id: providerId, event_type: 'online' });
      service.recordEvent({ provider_id: providerId, event_type: 'offline' });

      const score = service.recalculateScore(providerId);
      // 2 online / 3 total = 0.6667
      expect(score.uptime).toBeCloseTo(0.6667, 2);
    });

    it('should compute data integrity from proof events', () => {
      service.recordEvent({ provider_id: providerId, event_type: 'proof_success' });
      service.recordEvent({ provider_id: providerId, event_type: 'proof_success' });
      service.recordEvent({ provider_id: providerId, event_type: 'proof_success' });
      service.recordEvent({ provider_id: providerId, event_type: 'proof_failure' });

      const score = service.recalculateScore(providerId);
      // 3/4 = 0.75
      expect(score.data_integrity).toBeCloseTo(0.75, 2);
    });

    it('should compute response time score from timed events', () => {
      // Average response time = 100ms → score = 1.0
      service.recordEvent({ provider_id: providerId, event_type: 'proof_success', value: 100 });
      service.recordEvent({ provider_id: providerId, event_type: 'upload_success', value: 100 });

      const score = service.recalculateScore(providerId);
      expect(score.response_time).toBeCloseTo(1.0, 2);
    });

    it('should compute low response time score for slow events', () => {
      // Average response time = 5000ms → score = 0.0
      service.recordEvent({ provider_id: providerId, event_type: 'proof_success', value: 5000 });

      const score = service.recalculateScore(providerId);
      expect(score.response_time).toBeCloseTo(0.0, 1);
    });

    it('should compute contract compliance score', () => {
      service.recordEvent({ provider_id: providerId, event_type: 'contract_completed' });
      service.recordEvent({ provider_id: providerId, event_type: 'contract_completed' });
      service.recordEvent({ provider_id: providerId, event_type: 'contract_violated' });

      const score = service.recalculateScore(providerId);
      // 2/3 = 0.6667
      expect(score.contract_compliance).toBeCloseTo(0.6667, 2);
    });

    it('should compute community feedback score', () => {
      // Ratings 1-5, normalized to 0-1
      service.recordEvent({ provider_id: providerId, event_type: 'community_feedback', value: 5 });
      service.recordEvent({ provider_id: providerId, event_type: 'community_feedback', value: 4 });

      const score = service.recalculateScore(providerId);
      // avg = 4.5, score = 4.5/5.0 = 0.9
      expect(score.community_feedback).toBeCloseTo(0.9, 2);
    });

    it('should update provider rep columns in database', () => {
      service.recordEvent({ provider_id: providerId, event_type: 'online' });
      service.recalculateScore(providerId);

      const row = db.prepare('SELECT rep_overall, rep_uptime FROM providers WHERE id = ?').get(providerId) as {
        rep_overall: string;
        rep_uptime: string;
      };
      expect(parseFloat(row.rep_uptime)).toBeCloseTo(1.0, 2);
      expect(parseFloat(row.rep_overall)).toBeGreaterThan(0);
    });
  });

  describe('getProviderScore', () => {
    it('should return null for non-existent provider', () => {
      const score = service.getProviderScore(randomUUID());
      expect(score).toBeNull();
    });

    it('should return current score from provider columns', () => {
      // First recalculate to populate rep_ columns
      service.recordEvent({ provider_id: providerId, event_type: 'online' });
      service.recalculateScore(providerId);

      const score = service.getProviderScore(providerId);
      expect(score).toBeDefined();
      expect(score!.provider_id).toBe(providerId);
      expect(score!.uptime).toBeCloseTo(1.0, 2);
      expect(score!.total_events).toBe(1);
    });

    it('should include total event count', () => {
      service.recordEvent({ provider_id: providerId, event_type: 'online' });
      service.recordEvent({ provider_id: providerId, event_type: 'proof_success' });
      service.recalculateScore(providerId);

      const score = service.getProviderScore(providerId);
      expect(score!.total_events).toBe(2);
    });
  });
});

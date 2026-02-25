import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { createTestServer } from '../helpers/server.js';
import { randomUUID } from 'node:crypto';

/**
 * Full-flow integration tests that validate the complete pipeline:
 * register -> contract -> deposit -> proof -> reputation -> analytics
 */
describe('Full Flow Integration', () => {
  let server: FastifyInstance;
  let db: Database.Database;

  const insertProvider = (id: string) => {
    db.prepare(`
      INSERT INTO providers (id, name, tier, region, endpoint, available_capacity, total_capacity,
        price_per_gb_month, last_seen, metadata, rep_overall, rep_uptime, rep_data_integrity,
        rep_response_time, rep_contract_compliance, rep_community_feedback, rep_contracts_completed,
        rep_last_updated, registered_at, last_heartbeat, health_status, failed_health_checks,
        current_load, available_storage, active_contracts)
      VALUES (?, 'flow-provider', 'Professional', 'NorthAmerica', 'http://localhost:8080', 10000000000,
        25000000000, '0.005', datetime('now'), '{}', '0.5', '0.5', '0.5', '0.5', '0.5', '0.5',
        0, datetime('now'), datetime('now'), datetime('now'), 'Healthy', 0, 0.1, 10000000000, 0)
    `).run(id);
  };

  beforeEach(async () => {
    const result = await createTestServer();
    server = result.server;
    db = result.db;
  });

  afterEach(async () => {
    await server.close();
    db.close();
  });

  it('happy path: register -> contract -> deposit -> valid proof -> reputation + analytics', async () => {
    const providerId = randomUUID();
    const clientId = randomUUID();
    insertProvider(providerId);

    // Step 1: Create a contract
    const contractResp = await server.inject({
      method: 'POST',
      url: '/api/v1/contracts',
      payload: {
        client_id: clientId,
        provider_id: providerId,
        price_per_gb_month: '0.005',
        duration_months: 12,
        file_id: 'abc123',
        file_size: 1024000,
      },
    });
    expect(contractResp.statusCode).toBe(201);
    const contract = JSON.parse(contractResp.payload);
    expect(contract.status).toBe('pending_deposit');

    // Step 2: Record deposit to activate
    const depositResp = await server.inject({
      method: 'POST',
      url: `/api/v1/contracts/${contract.id}/deposit`,
      payload: { amount: '60000' },
    });
    expect(depositResp.statusCode).toBe(200);

    // Verify contract is now active
    const getResp = await server.inject({
      method: 'GET',
      url: `/api/v1/contracts/${contract.id}`,
    });
    expect(JSON.parse(getResp.payload).status).toBe('active');

    // Step 3: Submit a valid proof
    const proofResp = await server.inject({
      method: 'POST',
      url: `/api/v1/contracts/${contract.id}/proofs`,
      payload: {
        challenge_id: 'challenge-1',
        response_hash: 'abc123def456',
        merkle_proofs: [{ chunk_index: 0, chunk_hash: 'aaa', merkle_path: ['bbb'] }],
      },
    });
    expect(proofResp.statusCode).toBe(200);
    const proofResult = JSON.parse(proofResp.payload);
    expect(proofResult.valid).toBe(true);

    // Step 4: Verify reputation events were created
    const repEventsResp = await server.inject({
      method: 'GET',
      url: `/api/v1/reputation/${providerId}/events`,
    });
    const repEvents = JSON.parse(repEventsResp.payload);
    const proofSuccessEvents = repEvents.events.filter((e: { event_type: string }) => e.event_type === 'proof_success');
    expect(proofSuccessEvents.length).toBe(1);

    // Step 5: Verify reputation score changed
    const repScoreResp = await server.inject({
      method: 'GET',
      url: `/api/v1/reputation/${providerId}`,
    });
    const repScore = JSON.parse(repScoreResp.payload);
    // After a proof_success, data_integrity should be 1.0 (100% success rate)
    expect(repScore.data_integrity).toBe(1.0);

    // Step 6: Verify analytics reflect the activity
    const analyticsResp = await server.inject({
      method: 'GET',
      url: `/api/v1/analytics/provider/${providerId}/earnings`,
    });
    expect(analyticsResp.statusCode).toBe(200);
    const earnings = JSON.parse(analyticsResp.payload);
    expect(earnings.total_contracts).toBe(1);
    expect(earnings.active_contracts).toBe(1);

    // Step 7: Verify marketplace overview shows updated data
    const marketResp = await server.inject({
      method: 'GET',
      url: '/api/v1/analytics/marketplace',
    });
    expect(marketResp.statusCode).toBe(200);
    const market = JSON.parse(marketResp.payload);
    expect(market.active_contracts).toBe(1);
    expect(market.total_contracts).toBe(1);
  });

  it('failure path: multiple invalid proofs degrade reputation', async () => {
    const providerId = randomUUID();
    insertProvider(providerId);

    // Create and activate contract
    const contractResp = await server.inject({
      method: 'POST',
      url: '/api/v1/contracts',
      payload: {
        client_id: randomUUID(),
        provider_id: providerId,
        price_per_gb_month: '0.005',
        duration_months: 12,
      },
    });
    const contract = JSON.parse(contractResp.payload);
    await server.inject({
      method: 'POST',
      url: `/api/v1/contracts/${contract.id}/deposit`,
      payload: { amount: '60000' },
    });

    // Submit 5 invalid proofs (empty challenge_id makes proof invalid
    // but we need at least 1 merkle_proof to pass Zod validation)
    for (let i = 0; i < 5; i++) {
      await server.inject({
        method: 'POST',
        url: `/api/v1/contracts/${contract.id}/proofs`,
        payload: {
          challenge_id: '',
          response_hash: '',
          merkle_proofs: [{ dummy: true }],
        },
      });
    }

    // Contract should be failed after 5 consecutive failures
    const getResp = await server.inject({
      method: 'GET',
      url: `/api/v1/contracts/${contract.id}`,
    });
    expect(JSON.parse(getResp.payload).status).toBe('failed');

    // Reputation should reflect the failures
    const repEventsResp = await server.inject({
      method: 'GET',
      url: `/api/v1/reputation/${providerId}/events`,
    });
    const repEvents = JSON.parse(repEventsResp.payload);
    const failureEvents = repEvents.events.filter((e: { event_type: string }) => e.event_type === 'proof_failure');
    expect(failureEvents.length).toBe(5);

    // Data integrity should be 0 (all failures)
    const repScoreResp = await server.inject({
      method: 'GET',
      url: `/api/v1/reputation/${providerId}`,
    });
    const score = JSON.parse(repScoreResp.payload);
    expect(score.data_integrity).toBe(0);
  });

  it('contract expiry: lifecycle manager transitions expired contracts', async () => {
    const providerId = randomUUID();
    insertProvider(providerId);

    // Create and activate a contract
    const contractResp = await server.inject({
      method: 'POST',
      url: '/api/v1/contracts',
      payload: {
        client_id: randomUUID(),
        provider_id: providerId,
        price_per_gb_month: '0.005',
        duration_months: 1,
      },
    });
    const contract = JSON.parse(contractResp.payload);
    await server.inject({
      method: 'POST',
      url: `/api/v1/contracts/${contract.id}/deposit`,
      payload: { amount: '5000' },
    });

    // Manually backdate the contract to make it expired
    db.prepare(
      `UPDATE storage_contracts SET created_at = datetime('now', '-2 months') WHERE id = ?`
    ).run(contract.id);

    // Import and run lifecycle check directly
    const { ContractLifecycleManager } = await import('../../src/services/contract-lifecycle.js');
    const { ContractService } = await import('../../src/services/contract-service.js');
    const { ReputationService } = await import('../../src/services/reputation-service.js');

    const lifecycle = new ContractLifecycleManager(
      db,
      new ContractService(db),
      new ReputationService(db),
    );

    const count = lifecycle.checkExpiredContracts();
    expect(count).toBe(1);

    // Verify contract is completed
    const getResp = await server.inject({
      method: 'GET',
      url: `/api/v1/contracts/${contract.id}`,
    });
    expect(JSON.parse(getResp.payload).status).toBe('completed');

    // Verify contract_completed reputation event
    const repEventsResp = await server.inject({
      method: 'GET',
      url: `/api/v1/reputation/${providerId}/events`,
    });
    const repEvents = JSON.parse(repEventsResp.payload);
    const completedEvents = repEvents.events.filter(
      (e: { event_type: string }) => e.event_type === 'contract_completed'
    );
    expect(completedEvents.length).toBe(1);
  });
});

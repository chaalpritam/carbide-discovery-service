import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export interface ReputationEventRecord {
  id: string;
  provider_id: string;
  event_type: string;
  severity: string;
  value: number | null;
  details: string;
  contract_id: string | null;
  file_id: string | null;
  client_id: string | null;
  created_at: string;
}

export interface ReputationEventInput {
  provider_id: string;
  event_type: string;
  severity?: string;
  value?: number;
  details?: Record<string, unknown>;
  contract_id?: string;
  file_id?: string;
  client_id?: string;
}

export interface ProviderReputationScore {
  provider_id: string;
  overall: number;
  uptime: number;
  data_integrity: number;
  response_time: number;
  contract_compliance: number;
  community_feedback: number;
  total_events: number;
}

// Reputation dimension weights
const WEIGHTS = {
  uptime: 0.25,
  data_integrity: 0.25,
  response_time: 0.20,
  contract_compliance: 0.20,
  community_feedback: 0.10,
};

export class ReputationService {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  recordEvent(input: ReputationEventInput): ReputationEventRecord {
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO reputation_events (id, provider_id, event_type, severity, value, details, contract_id, file_id, client_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.provider_id,
      input.event_type,
      input.severity ?? 'neutral',
      input.value ?? null,
      JSON.stringify(input.details ?? {}),
      input.contract_id ?? null,
      input.file_id ?? null,
      input.client_id ?? null,
    );
    return this.db.prepare('SELECT * FROM reputation_events WHERE id = ?').get(id) as ReputationEventRecord;
  }

  getProviderEvents(providerId: string, since?: string, limit?: number): ReputationEventRecord[] {
    let query = 'SELECT * FROM reputation_events WHERE provider_id = ?';
    const params: unknown[] = [providerId];

    if (since) {
      query += ' AND created_at >= ?';
      params.push(since);
    }
    query += ' ORDER BY created_at DESC';
    if (limit) {
      query += ' LIMIT ?';
      params.push(limit);
    }
    return this.db.prepare(query).all(...params) as ReputationEventRecord[];
  }

  recalculateScore(providerId: string): ProviderReputationScore {
    const events = this.getProviderEvents(providerId);

    // Calculate dimension scores from events
    const uptime = this.calculateUptimeScore(events);
    const dataIntegrity = this.calculateDataIntegrityScore(events);
    const responseTime = this.calculateResponseTimeScore(events);
    const contractCompliance = this.calculateContractComplianceScore(events);
    const communityFeedback = this.calculateCommunityFeedbackScore(events);

    const overall =
      uptime * WEIGHTS.uptime +
      dataIntegrity * WEIGHTS.data_integrity +
      responseTime * WEIGHTS.response_time +
      contractCompliance * WEIGHTS.contract_compliance +
      communityFeedback * WEIGHTS.community_feedback;

    // Update provider's reputation columns
    this.db.prepare(
      `UPDATE providers SET
        rep_overall = ?, rep_uptime = ?, rep_data_integrity = ?,
        rep_response_time = ?, rep_contract_compliance = ?,
        rep_community_feedback = ?, rep_last_updated = datetime('now')
       WHERE id = ?`
    ).run(
      overall.toFixed(4),
      uptime.toFixed(4),
      dataIntegrity.toFixed(4),
      responseTime.toFixed(4),
      contractCompliance.toFixed(4),
      communityFeedback.toFixed(4),
      providerId,
    );

    return {
      provider_id: providerId,
      overall,
      uptime,
      data_integrity: dataIntegrity,
      response_time: responseTime,
      contract_compliance: contractCompliance,
      community_feedback: communityFeedback,
      total_events: events.length,
    };
  }

  getProviderScore(providerId: string): ProviderReputationScore | null {
    const row = this.db.prepare(
      `SELECT id, rep_overall, rep_uptime, rep_data_integrity, rep_response_time,
              rep_contract_compliance, rep_community_feedback
       FROM providers WHERE id = ?`
    ).get(providerId) as { id: string; rep_overall: string; rep_uptime: string; rep_data_integrity: string; rep_response_time: string; rep_contract_compliance: string; rep_community_feedback: string } | undefined;

    if (!row) return null;

    const events = this.db.prepare(
      'SELECT COUNT(*) as count FROM reputation_events WHERE provider_id = ?'
    ).get(providerId) as { count: number };

    return {
      provider_id: providerId,
      overall: parseFloat(row.rep_overall),
      uptime: parseFloat(row.rep_uptime),
      data_integrity: parseFloat(row.rep_data_integrity),
      response_time: parseFloat(row.rep_response_time),
      contract_compliance: parseFloat(row.rep_contract_compliance),
      community_feedback: parseFloat(row.rep_community_feedback),
      total_events: events.count,
    };
  }

  private calculateUptimeScore(events: ReputationEventRecord[]): number {
    const uptimeEvents = events.filter(e =>
      e.event_type === 'online' || e.event_type === 'offline'
    );
    if (uptimeEvents.length === 0) return 0.5; // Default neutral score
    const onlineCount = uptimeEvents.filter(e => e.event_type === 'online').length;
    return Math.min(1.0, onlineCount / uptimeEvents.length);
  }

  private calculateDataIntegrityScore(events: ReputationEventRecord[]): number {
    const proofEvents = events.filter(e =>
      e.event_type === 'proof_success' || e.event_type === 'proof_failure'
    );
    if (proofEvents.length === 0) return 0.5;
    const successCount = proofEvents.filter(e => e.event_type === 'proof_success').length;
    return Math.min(1.0, successCount / proofEvents.length);
  }

  private calculateResponseTimeScore(events: ReputationEventRecord[]): number {
    const timedEvents = events.filter(e => e.value !== null && (
      e.event_type === 'proof_success' || e.event_type === 'upload_success' || e.event_type === 'download_success'
    ));
    if (timedEvents.length === 0) return 0.5;
    const avgMs = timedEvents.reduce((sum, e) => sum + (e.value ?? 0), 0) / timedEvents.length;
    // Score: <100ms = 1.0, >5000ms = 0.0
    return Math.max(0, Math.min(1.0, 1.0 - (avgMs - 100) / 4900));
  }

  private calculateContractComplianceScore(events: ReputationEventRecord[]): number {
    const contractEvents = events.filter(e =>
      e.event_type === 'contract_completed' || e.event_type === 'contract_violated'
    );
    if (contractEvents.length === 0) return 0.5;
    const completedCount = contractEvents.filter(e => e.event_type === 'contract_completed').length;
    return Math.min(1.0, completedCount / contractEvents.length);
  }

  private calculateCommunityFeedbackScore(events: ReputationEventRecord[]): number {
    const feedbackEvents = events.filter(e => e.event_type === 'community_feedback' && e.value !== null);
    if (feedbackEvents.length === 0) return 0.5;
    const avgRating = feedbackEvents.reduce((sum, e) => sum + (e.value ?? 0), 0) / feedbackEvents.length;
    return Math.min(1.0, avgRating / 5.0); // Ratings are 1-5
  }
}

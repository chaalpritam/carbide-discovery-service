import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export type WebhookEventType =
  | 'contract.created'
  | 'contract.activated'
  | 'contract.completed'
  | 'contract.failed'
  | 'proof.success'
  | 'proof.failure'
  | 'dispute.raised'
  | 'dispute.resolved';

export interface WebhookRecord {
  id: string;
  owner_id: string;
  url: string;
  event_types: string[];
  secret: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WebhookDeliveryRecord {
  id: number;
  webhook_id: string;
  event_type: string;
  payload: string;
  response_status: number | null;
  attempts: number;
  delivered: boolean;
  created_at: string;
}

interface WebhookRow {
  id: string;
  owner_id: string;
  url: string;
  event_types: string;
  secret: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

function rowToRecord(row: WebhookRow): WebhookRecord {
  return {
    id: row.id,
    owner_id: row.owner_id,
    url: row.url,
    event_types: JSON.parse(row.event_types) as string[],
    secret: row.secret,
    active: row.active === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class WebhookService {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  register(input: { owner_id: string; url: string; event_types: string[]; secret?: string }): WebhookRecord {
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO webhooks (id, owner_id, url, event_types, secret) VALUES (?, ?, ?, ?, ?)`
    ).run(id, input.owner_id, input.url, JSON.stringify(input.event_types), input.secret ?? null);

    const row = this.db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id) as WebhookRow;
    return rowToRecord(row);
  }

  unregister(webhookId: string): void {
    this.db.prepare(
      `UPDATE webhooks SET active = 0, updated_at = datetime('now') WHERE id = ?`
    ).run(webhookId);
  }

  listForOwner(ownerId: string): WebhookRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM webhooks WHERE owner_id = ? AND active = 1 ORDER BY created_at DESC'
    ).all(ownerId) as WebhookRow[];
    return rows.map(rowToRecord);
  }

  getDeliveries(webhookId: string): WebhookDeliveryRecord[] {
    return this.db.prepare(
      'SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC'
    ).all(webhookId) as WebhookDeliveryRecord[];
  }

  dispatch(eventType: WebhookEventType, payload: Record<string, unknown>): void {
    // Find all active webhooks that listen for this event type
    const rows = this.db.prepare(
      'SELECT * FROM webhooks WHERE active = 1'
    ).all() as WebhookRow[];

    for (const row of rows) {
      const eventTypes = JSON.parse(row.event_types) as string[];
      if (!eventTypes.includes(eventType)) continue;

      // Record delivery attempt
      this.db.prepare(
        `INSERT INTO webhook_deliveries (webhook_id, event_type, payload, attempts, delivered)
         VALUES (?, ?, ?, 1, 0)`
      ).run(row.id, eventType, JSON.stringify(payload));
    }
  }
}

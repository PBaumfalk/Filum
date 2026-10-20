import type { DB } from '../db/db.js';
import { now } from '../lib/time.js';

export interface Actor {
  userId: number | null;
  tokenId?: number | null;
  label: string;
}

export const SYSTEM: Actor = { userId: null, label: 'System' };

export class Audit {
  private stmt;
  constructor(private db: DB) {
    this.stmt = db.prepare(
      'INSERT INTO audit_log(ts, user_id, token_id, actor, action, entity, entity_id, details) VALUES (?,?,?,?,?,?,?,?)',
    );
  }

  log(actor: Actor, action: string, entity = '', entityId: number | null = null, details?: Record<string, unknown>): void {
    this.stmt.run(now(), actor.userId, actor.tokenId ?? null, actor.label, action, entity, entityId, details ? JSON.stringify(details) : null);
  }

  list(opts: { limit: number; before?: number; entity?: string; entityId?: number }) {
    const where: string[] = [];
    const args: unknown[] = [];
    if (opts.before) {
      where.push('id < ?');
      args.push(opts.before);
    }
    if (opts.entity) {
      where.push('entity = ?');
      args.push(opts.entity);
    }
    if (opts.entityId) {
      where.push('entity_id = ?');
      args.push(opts.entityId);
    }
    const sql = `SELECT id, ts, user_id, actor, action, entity, entity_id, details FROM audit_log ${
      where.length ? `WHERE ${where.join(' AND ')}` : ''
    } ORDER BY id DESC LIMIT ?`;
    return (this.db.prepare(sql).all(...args, opts.limit) as {
      id: number;
      ts: number;
      user_id: number | null;
      actor: string;
      action: string;
      entity: string;
      entity_id: number | null;
      details: string | null;
    }[]).map((r) => ({
      id: r.id,
      at: new Date(r.ts * 1000).toISOString(),
      userId: r.user_id,
      actor: r.actor,
      action: r.action,
      entity: r.entity,
      entityId: r.entity_id,
      details: r.details ? JSON.parse(r.details) : null,
    }));
  }

  prune(olderThanDays: number): void {
    this.db.prepare('DELETE FROM audit_log WHERE ts < ?').run(now() - olderThanDays * 86400);
  }
}

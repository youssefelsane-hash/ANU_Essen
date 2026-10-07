import type { Db } from '../db';
import { db } from '../db';
import { auditLogs } from '../db/schema';

export interface AuditActor {
  type: 'USER' | 'CUSTOMER' | 'SYSTEM';
  userId?: string | null;
  label?: string | null;
}

export interface AuditEntry {
  actor: AuditActor;
  action: string;
  entity: string;
  entityId?: string | null;
  restaurantId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  deviceId?: string | null;
}

const SECRET_KEYS = new Set(['passwordHash', 'password', 'token']);

function scrub(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(
    JSON.stringify(value, (k, v) => (SECRET_KEYS.has(k) ? '[redacted]' : v)),
  );
}

/** Writes an audit record. Pass the transaction handle when the change itself is transactional. */
export async function audit(entry: AuditEntry, d: Db = db()) {
  await d.insert(auditLogs).values({
    actorType: entry.actor.type,
    actorUserId: entry.actor.userId ?? null,
    actorLabel: entry.actor.label ?? null,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    restaurantId: entry.restaurantId ?? null,
    before: scrub(entry.before),
    after: scrub(entry.after),
    ip: entry.ip ?? null,
    userAgent: entry.userAgent?.slice(0, 300) ?? null,
    deviceId: entry.deviceId ?? null,
  });
}

/** Only the fields that changed (for compact before/after diffs). */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      b[key] = before[key];
      a[key] = after[key];
    }
  }
  return { before: b, after: a, changed: Object.keys(a).length > 0 };
}

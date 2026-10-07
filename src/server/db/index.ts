import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';
import { env } from '../env';

export { schema };
// Accepts both the root database and a transaction handle (PgTransaction extends PgDatabase).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<PgQueryResultHKT, typeof schema, any>;

const g = globalThis as unknown as { __campusDb?: Db; __campusSql?: postgres.Sql };

export function db(): Db {
  if (!g.__campusDb) {
    const e = env();
    // prepare:false keeps us compatible with transaction-mode poolers (Supabase/Neon pgbouncer).
    const sql = postgres(e.DATABASE_URL, { max: e.DB_POOL_MAX, prepare: false, idle_timeout: 20, connect_timeout: 10 });
    g.__campusSql = sql;
    g.__campusDb = drizzle(sql, { schema }) as unknown as Db;
  }
  return g.__campusDb;
}

/** Test hook: inject another driver (PGlite). */
export function setDb(instance: Db) {
  g.__campusDb = instance;
}

export async function closeDb() {
  await g.__campusSql?.end({ timeout: 5 });
  g.__campusSql = undefined;
  g.__campusDb = undefined;
}

/** True when the error is a Postgres unique violation (optionally on a given constraint). */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  let e: unknown = err;
  for (let i = 0; i < 4 && e; i++) {
    const anyErr = e as { code?: string; constraint_name?: string; constraint?: string; cause?: unknown };
    if (anyErr.code === '23505') {
      if (!constraint) return true;
      return anyErr.constraint_name === constraint || anyErr.constraint === constraint;
    }
    e = anyErr.cause;
  }
  return false;
}

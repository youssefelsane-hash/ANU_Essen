import './load-env';
import postgres from 'postgres';
import { sql as dsql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import * as schema from '../src/server/db/schema';
import type { Db } from '../src/server/db';
import { describeDatabaseError, describeDatabaseTarget, normalizeDatabaseUrl } from '../src/server/db/url';
import { bootstrapSuperAdmin, seedRbac } from '../src/server/seed';

const LOCK = 1791373107;

/**
 * Runs on every deploy (`vercel-build`):
 * 1. applies SQL migrations atomically, serialized across concurrent builds;
 * 2. syncs roles & permissions with the code (idempotent);
 * 3. creates the first platform owner from BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD
 *    if no platform owner exists yet (never touches an existing account).
 */
async function main() {
  const raw = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
  if (!raw?.trim()) {
    console.error('Database migration failed: DATABASE_URL is not set for this environment.');
    console.error('Vercel → Project → Settings → Environment Variables → add DATABASE_URL (Production), then redeploy.');
    process.exit(1);
  }
  const url = normalizeDatabaseUrl(raw);
  console.log(`→ migrating ${describeDatabaseTarget(url)}`);
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {}, connect_timeout: 15 });
  try {
    const migrations = readMigrationFiles({ migrationsFolder: 'drizzle' });
    let applied = 0;
    await sql.begin(async (tx) => {
      // Transaction-scoped lock also works with transaction-mode connection poolers.
      await tx`select pg_advisory_xact_lock(${LOCK})`;
      await tx`create schema if not exists drizzle`;
      await tx`create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`;
      const [last] = await tx<{ created_at: string }[]>`select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1`;
      for (const migration of migrations) {
        if (last && Number(last.created_at) >= migration.folderMillis) continue;
        for (const statement of migration.sql) await tx.unsafe(statement);
        await tx`insert into drizzle.__drizzle_migrations (hash, created_at) values (${migration.hash}, ${migration.folderMillis})`;
        applied++;
      }
    });
    console.log(`✓ migrations applied (${applied} new)`);

    const app = drizzle(sql, { schema }) as unknown as Db;
    await app.transaction(async (d) => {
      await d.execute(dsql`select pg_advisory_xact_lock(${LOCK})`);
      await seedRbac(d);
      console.log('✓ roles & permissions in sync');
      const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim();
      const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? '';
      if (email && password) {
        const result = await bootstrapSuperAdmin(d, { email, password });
        console.log(result === 'created'
          ? `✓ platform owner created: ${email} — sign in at /login, then you may delete BOOTSTRAP_ADMIN_PASSWORD`
          : '= a platform owner already exists; BOOTSTRAP_ADMIN_* is ignored and can be deleted');
      }
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  // Never print the connection string itself: only a redacted, actionable reason.
  console.error(`Database migration failed: ${describeDatabaseError(err)}`);
  process.exit(1);
});

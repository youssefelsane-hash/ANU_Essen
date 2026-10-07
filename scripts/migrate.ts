import './load-env';
import postgres from 'postgres';
import { readMigrationFiles } from 'drizzle-orm/migrator';

/** Apply migrations atomically, serialized across concurrent Vercel builds. */
async function main() {
  const url = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {}, connect_timeout: 15 });
  try {
    const migrations = readMigrationFiles({ migrationsFolder: 'drizzle' });
    await sql.begin(async (tx) => {
      // Transaction-scoped lock also works with transaction-mode connection poolers.
      await tx`select pg_advisory_xact_lock(1791373107)`;
      await tx`create schema if not exists drizzle`;
      await tx`create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`;
      const [last] = await tx<{ created_at: string }[]>`select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1`;
      for (const migration of migrations) {
        if (last && Number(last.created_at) >= migration.folderMillis) continue;
        for (const statement of migration.sql) await tx.unsafe(statement);
        await tx`insert into drizzle.__drizzle_migrations (hash, created_at) values (${migration.hash}, ${migration.folderMillis})`;
      }
    });
    console.log('✓ migrations applied');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch(() => {
  // A connection error can include credentials. Keep build output safe.
  console.error('Database migration failed. Check the database URL, access and migration files.');
  process.exit(1);
});

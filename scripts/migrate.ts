import './load-env';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

/** Applies SQL migrations from ./drizzle (also runs on Vercel via `vercel-build`). */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: 'drizzle' });
  await sql.end();
  console.log('✓ migrations applied');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

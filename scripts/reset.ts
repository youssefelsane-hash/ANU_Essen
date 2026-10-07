import './load-env';
import postgres from 'postgres';

/** DEV ONLY: drops all tables/types so `db:reset` can rebuild from scratch. */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  if (process.env.NODE_ENV === 'production' || !/localhost|127\.0\.0\.1/.test(url)) {
    throw new Error('Refusing to reset a non-local database');
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql.unsafe('drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade;');
  await sql.end();
  console.log('✓ local database wiped');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

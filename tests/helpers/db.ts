import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '@/server/db/schema';
import { setDb, type Db } from '@/server/db';
import { assignRole, ensureUser, seedDemoRestaurant, seedRbac } from '@/server/seed';
import { loadAuthz, type AuthContext } from '@/server/auth/authz';

export const TEST_PASSWORD = 'test-password-123';

/** In-memory Postgres (PGlite) with the real migrations + seed — no Docker needed for tests. */
export async function setupTestDb() {
  const client = new PGlite();
  const pg = drizzle(client, { schema });
  await migrate(pg, { migrationsFolder: 'drizzle' });
  const d = pg as unknown as Db;
  setDb(d);
  await seedRbac(d);
  const demo = await seedDemoRestaurant(d, { demoPassword: TEST_PASSWORD });
  const admin = await ensureUser(d, { email: 'admin@test.local', name: 'Admin', password: TEST_PASSWORD });
  await assignRole(d, admin.id, 'SUPER_ADMIN', null);
  return { d, client, demo };
}

export async function authFor(d: Db, email: string): Promise<AuthContext> {
  const [u] = await d.select().from(schema.users).where((await import('drizzle-orm')).eq(schema.users.email, email));
  if (!u) throw new Error(`no user ${email}`);
  return loadAuthz(d, { id: u.id, name: u.name, email: u.email });
}

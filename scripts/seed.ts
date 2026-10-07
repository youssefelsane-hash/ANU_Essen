import './load-env';
import { closeDb, db } from '../src/server/db';
import { assignRole, ensureUser, seedDemoRestaurant, seedRbac } from '../src/server/seed';

/**
 * Seeds roles/permissions, the super admin, and the demo restaurant ("الرايظ الدمشقية").
 * Re-runnable. Set SEED_DEMO=false to skip demo data in production.
 */
async function main() {
  const d = db();
  await seedRbac(d);
  console.log('✓ roles & permissions');

  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (email && password) {
    if (password.length < 10) throw new Error('SEED_ADMIN_PASSWORD must be at least 10 characters');
    const admin = await ensureUser(d, { email, name: 'Platform Owner', password });
    await assignRole(d, admin.id, 'SUPER_ADMIN', null);
    console.log(`✓ super admin ${email}`);
  } else {
    console.log('! SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set — no super admin created');
  }

  if (process.env.SEED_DEMO !== 'false') {
    const demo = await seedDemoRestaurant(d, { demoPassword: process.env.SEED_DEMO_PASSWORD || null });
    console.log(demo.created ? `✓ demo restaurant /s/${demo.slug}` : `= demo restaurant already exists (/s/${demo.slug})`);
  }
  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});

import { createDb } from '../connection';
import { tenants } from '../schema';
import { seedModulesFor, seedPlans } from './seed-modules';

/**
 * Adds demo data for the newer modules to a database that already has
 * consultancies in it, without deleting or overwriting anything:
 *
 *  - subscription plans, if missing (no consultancy is moved onto one);
 *  - per consultancy: service packages, invoices and payments, tasks and announcements - each only if that consultancy has
 *    none yet;
 *  - student profiles only on clients whose profile is entirely empty, and
 *    application dates only on live cases that have none.
 *
 *   npm run db:seed:extras
 */
async function main() {
  const handle = await createDb();
  try {
    await seedPlans(handle.db);
    const rows = await handle.db.select({ id: tenants.id, name: tenants.name }).from(tenants);
    for (const t of rows) {
      const r = await seedModulesFor(handle.db, t.id);
      console.log(`[extras] ${t.name}:`, r);
    }
    console.log('[extras] done');
  } finally {
    await handle.close();
  }
}

main().catch((err) => {
  console.error('[extras] failed:', err);
  process.exit(1);
});

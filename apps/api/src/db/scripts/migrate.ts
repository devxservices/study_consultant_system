import path from 'node:path';
import { createDb, resolveDbTarget } from '../connection';

/**
 * Applies the generated SQL in ./drizzle to whichever database is configured.
 * Identical migrations run against embedded PGlite and managed Postgres.
 */
async function main() {
  const migrationsFolder = path.resolve(__dirname, '../../../drizzle');
  const { driver, target } = resolveDbTarget();
  console.log(`[migrate] driver=${driver} folder=${migrationsFolder}`);
  if (driver === 'pglite') console.log(`[migrate] data dir: ${target}`);

  const handle = await createDb();
  try {
    if (driver === 'pglite') {
      const { migrate } = await import('drizzle-orm/pglite/migrator');
      await migrate(handle.db as never, { migrationsFolder });
    } else {
      const { migrate } = await import('drizzle-orm/node-postgres/migrator');
      await migrate(handle.db as never, { migrationsFolder });
    }
    console.log('[migrate] done');
  } finally {
    await handle.close();
  }
}

main().catch((err) => {
  console.error('[migrate] failed:', err);
  process.exit(1);
});

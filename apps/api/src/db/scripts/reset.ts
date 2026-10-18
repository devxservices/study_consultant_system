import fs from 'node:fs';
import { resolveDbTarget } from '../connection';
import { pgliteLockHolder } from '../pglite-lock';

/**
 * Destroys local data and starts over. Refuses to touch a real Postgres -
 * dropping a managed database is never something a dev script should do.
 */
async function main() {
  const { driver, target } = resolveDbTarget();
  if (driver !== 'pglite') {
    console.error('[reset] DATABASE_URL is set. Refusing to reset a real Postgres database.');
    console.error('[reset] Drop and recreate it yourself, then run: npm run db:push');
    process.exit(1);
  }

  // Deleting the data directory out from under a running server is the worst
  // thing that can happen to it, so this checks the lock rather than opening
  // the database - there is nothing here that needs it open.
  const holder = pgliteLockHolder(target);
  if (holder) {
    console.error('[reset] The database is open in another process. Refusing to delete it.');
    console.error(`[reset]   held by PID ${holder.pid} (started ${holder.startedAt})`);
    console.error(`[reset]   command    ${holder.argv}`);
    console.error('[reset] Stop the API (npm run dev) and try again.');
    process.exit(1);
  }

  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
    console.log(`[reset] removed ${target}`);
  } else {
    console.log('[reset] nothing to remove');
  }
  // The lock belongs to the directory that just went away.
  fs.rmSync(`${target.replace(/[\\/]+$/, '')}.lock`, { force: true });
  console.log('[reset] now run: npm run db:push && npm run db:seed');
}

main();

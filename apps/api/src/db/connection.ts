import { drizzle as drizzleNodePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import * as schema from './schema';
import { acquirePgliteLock } from './pglite-lock';

/**
 * The app talks to one database type. Both drivers expose the same Drizzle
 * query API, so the rest of the codebase never learns which one is live.
 */
export type Db = NodePgDatabase<typeof schema>;

export type DbDriver = 'postgres' | 'pglite';

export interface DbHandle {
  db: Db;
  driver: DbDriver;
  /** Where the data actually lives, for logging on boot. */
  target: string;
  close: () => Promise<void>;
}

/** Local-first default: an embedded Postgres file under the repo, no install needed. */
export const DEFAULT_PGLITE_DIR = path.resolve(process.cwd(), '../../.data/pg');

export function resolveDbTarget(): { driver: DbDriver; target: string } {
  const url = process.env.DATABASE_URL?.trim();
  if (url) return { driver: 'postgres', target: url };
  return { driver: 'pglite', target: process.env.PGLITE_DIR?.trim() || DEFAULT_PGLITE_DIR };
}

/** `-c TimeZone=<TZ>` for a well-formed IANA name (e.g. Asia/Karachi), else nothing. */
function sessionTimeZone(): string | undefined {
  const tz = process.env.TZ?.trim();
  return tz && /^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/.test(tz) ? `-c TimeZone=${tz}` : undefined;
}

/**
 * Creates the database handle.
 *
 * Set DATABASE_URL to point at a managed Postgres (Supabase, Neon, RDS) and
 * nothing else in the app changes - the migrations and schema are identical.
 */
export async function createDb(): Promise<DbHandle> {
  const { driver, target } = resolveDbTarget();

  if (driver === 'postgres') {
    const pool = new Pool({
      connectionString: target,
      max: Number(process.env.DB_POOL_MAX ?? 10),
      // Under a saturated database a request waits this long for a connection
      // and then fails, instead of queueing without limit and holding its
      // socket and memory while it waits.
      connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS ?? 10_000),
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
      // The database's "today" and its date grouping (monthly reports) follow
      // the same calendar as the app (TZ), not the database server's UTC.
      options: sessionTimeZone(),
    });
    const db = drizzleNodePg(pool, { schema });
    return {
      db,
      driver,
      target: redact(target),
      close: async () => {
        await pool.end();
      },
    };
  }

  // PGlite creates its own data dir but not the parents of it.
  fs.mkdirSync(path.dirname(target), { recursive: true });

  // Taken before the directory is opened, so a second process is turned away
  // rather than allowed to corrupt it. See pglite-lock.ts for why.
  const release = acquirePgliteLock(target);

  let pglite: PGlite;
  try {
    pglite = new PGlite(target);
    await pglite.waitReady;
  } catch (err) {
    release();
    throw describeCorruption(err, target);
  }

  const db = drizzlePglite(pglite, { schema }) as unknown as Db;
  return {
    db,
    driver,
    target,
    close: async () => {
      try {
        await pglite.close();
      } finally {
        release();
      }
    },
  };
}

/**
 * PGlite reports a damaged data directory as `RuntimeError: Aborted()` from
 * inside its WASM build - a message that says nothing about what is wrong or
 * what to do. Anyone who hits it is looking at a dead server and a stack trace
 * full of `wasm-function[13300]`, so it is worth translating.
 *
 * The lock makes this rare, but a hard power loss mid-write can still do it.
 */
function describeCorruption(err: unknown, target: string): Error {
  const message = err instanceof Error ? err.message : String(err);
  if (!/abort/i.test(message)) return err instanceof Error ? err : new Error(message);

  return new Error(
    [
      '',
      'The embedded development database could not be opened and is most',
      'likely corrupted.',
      '',
      `  data directory: ${target}`,
      `  underlying error: ${message}`,
      '',
      'This is local development data, so the fix is to rebuild it:',
      '',
      '  npm run db:reset && npm run db:push && npm run db:seed',
      '',
      'Set DATABASE_URL to a real Postgres to avoid the single-file limitation',
      'entirely.',
      '',
    ].join('\n'),
  );
}

/** Never print credentials in a boot log. */
function redact(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return 'postgres (unparsable url)';
  }
}

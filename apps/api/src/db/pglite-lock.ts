import fs from 'node:fs';
import path from 'node:path';

/**
 * A single-writer lock for the embedded development database.
 *
 * PGlite stores a whole Postgres in one directory and assumes exactly one
 * process is writing to it. Two writers do not fail loudly - they corrupt the
 * files, and the damage only surfaces on the *next* boot as an opaque
 * `RuntimeError: Aborted()` from inside the WASM build, long after the thing
 * that caused it. Every restart then fails the same way and the only cure is
 * deleting the data.
 *
 * That is far too easy to trigger by accident: `npm run build` while the API
 * watcher is running restarts Nest mid-write, and a stray `npm run db:seed`
 * against a live server does the same. Documenting "don't do that" did not
 * prevent it, so the lock does.
 *
 * The rule: the first process to open the directory owns it. A second one
 * refuses to start and says who holds it, instead of silently destroying the
 * database. A lock left behind by a crashed process is detected and taken over,
 * so a hard kill never needs manual cleanup.
 *
 * This is a development guard only. A real Postgres handles concurrency itself,
 * so nothing here runs when `DATABASE_URL` is set.
 */

interface LockFile {
  pid: number;
  startedAt: string;
  argv: string;
}

export class DatabaseLockedError extends Error {
  constructor(
    readonly holder: LockFile,
    readonly lockPath: string,
  ) {
    super(
      [
        '',
        'The development database is already open in another process.',
        '',
        `  held by PID ${holder.pid}  (started ${holder.startedAt})`,
        `  command    ${holder.argv}`,
        '',
        'Two processes writing to the embedded Postgres corrupts it, so this',
        'one is stopping instead. Stop the other process and try again:',
        '',
        '  - Running the API already? Stop it before `db:push`, `db:seed` or `db:reset`.',
        '  - Building? `npm run build` restarts the API watcher - stop `npm run dev` first.',
        '',
        `If you are certain nothing is running, delete ${lockPath}.`,
        '',
      ].join('\n'),
    );
    this.name = 'DatabaseLockedError';
  }
}

const lockPathFor = (dataDir: string) => `${dataDir.replace(/[\\/]+$/, '')}.lock`;

/**
 * Is that process still alive?
 *
 * Signal 0 performs the permission and existence checks without delivering
 * anything. `EPERM` means it exists but belongs to someone else, which still
 * counts as alive - the conservative answer is the safe one here.
 */
function isRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readLock(lockPath: string): LockFile | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as Partial<LockFile>;
    if (typeof parsed.pid !== 'number') return null;
    return {
      pid: parsed.pid,
      startedAt: parsed.startedAt ?? 'unknown',
      argv: parsed.argv ?? 'unknown',
    };
  } catch {
    // Unreadable or half-written: treat as no lock rather than as a wall. A
    // corrupt lock file must never be the thing that stops the app booting.
    return null;
  }
}

/**
 * Take the lock, or throw `DatabaseLockedError` naming who holds it.
 *
 * Returns the release function. `wx` makes the create-if-absent atomic, so two
 * processes racing at the same instant cannot both believe they won.
 */
export function acquirePgliteLock(dataDir: string): () => void {
  const lockPath = lockPathFor(dataDir);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  const mine: LockFile = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    argv: process.argv.slice(1).join(' ') || 'node',
  };

  const write = () => fs.writeFileSync(lockPath, JSON.stringify(mine, null, 2), { flag: 'wx' });

  try {
    write();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;

    const holder = readLock(lockPath);
    if (holder && isRunning(holder.pid)) throw new DatabaseLockedError(holder, lockPath);

    // Stale: the owner died without cleaning up (a kill -9, a crash, a reboot).
    // Take it over. The race here is two processes both finding the same stale
    // lock, so the retry is still exclusive rather than a plain overwrite.
    fs.rmSync(lockPath, { force: true });
    try {
      write();
    } catch (retryErr) {
      if ((retryErr as NodeJS.ErrnoException).code !== 'EEXIST') throw retryErr;
      const winner = readLock(lockPath);
      throw new DatabaseLockedError(winner ?? mine, lockPath);
    }
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      // Only ever remove our own lock; a slow shutdown must not delete the
      // lock of whoever legitimately started after us.
      if (readLock(lockPath)?.pid === process.pid) fs.rmSync(lockPath, { force: true });
    } catch {
      // A lock we failed to clean up is self-healing: the next process sees a
      // dead PID and takes it over.
    }
  };

  // Covers the paths that never reach an orderly shutdown: Ctrl+C, a watcher
  // killing the previous run, an uncaught throw.
  process.once('exit', release);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.once(signal, () => {
      release();
      process.exit(signal === 'SIGINT' ? 130 : 143);
    });
  }

  return release;
}

/**
 * Who holds the lock, if anyone alive does. For scripts that want to refuse
 * politely without opening the database at all - `db:reset` deletes the
 * directory outright, and doing that under a running server is the single
 * worst thing that can happen to it.
 */
export function pgliteLockHolder(dataDir: string): LockFile | null {
  const holder = readLock(lockPathFor(dataDir));
  return holder && isRunning(holder.pid) ? holder : null;
}

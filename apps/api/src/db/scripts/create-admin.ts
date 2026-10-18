import { randomBytes } from 'node:crypto';
import { hash } from 'bcryptjs';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { createDb } from '../connection';
import { users } from '../schema';
import { adminOrigin } from '../../tenancy/tenant-links';

/**
 * Creates a platform admin - the one account that cannot be made from inside
 * the product, because making accounts is what it is for.
 *
 *   npm run admin:create -- --email owner@example.com --name "Jane Owner"
 *
 * The password comes from --password or ADMIN_PASSWORD; with neither, a random
 * one is generated and printed once. Safe to re-run: an existing admin with
 * that email is left exactly as it is unless --reset-password is given.
 * Never touches any consultancy's data.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg('email')?.trim().toLowerCase();
  const name = arg('name')?.trim() || 'Platform admin';
  const reset = process.argv.includes('--reset-password');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('[admin] usage: npm run admin:create -- --email you@example.com [--name "Your Name"] [--password ...]');
    process.exit(1);
  }

  const given = arg('password') ?? process.env.ADMIN_PASSWORD;
  if (given !== undefined && given.length < 8) {
    console.error('[admin] the password must be at least 8 characters');
    process.exit(1);
  }
  const password = given ?? randomBytes(12).toString('base64url');

  const handle = await createDb();
  try {
    const [existing] = await handle.db
      .select({ id: users.id })
      .from(users)
      .where(and(isNull(users.tenantId), eq(sql`lower(${users.email})`, email)))
      .limit(1);

    if (existing && !reset) {
      console.log(`[admin] ${email} is already a platform admin - nothing changed.`);
      console.log('[admin] pass --reset-password to set a new password.');
      return;
    }

    const passwordHash = await hash(password, 10);
    if (existing) {
      await handle.db
        .update(users)
        .set({ passwordHash, isActive: true, updatedAt: new Date() })
        .where(eq(users.id, existing.id));
      console.log(`[admin] password reset for ${email}`);
    } else {
      await handle.db.insert(users).values({
        tenantId: null,
        email,
        passwordHash,
        fullName: name,
        role: 'super_admin',
      });
      console.log(`[admin] created platform admin ${email}`);
    }
    if (given === undefined) console.log(`[admin] password: ${password}   (shown once - store it now)`);
    console.log(`[admin] sign in at ${adminOrigin()}`);
  } finally {
    await handle.close();
  }
}

main().catch((err) => {
  console.error('[admin] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});

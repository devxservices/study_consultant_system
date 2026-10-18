import { Inject, Injectable } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { users } from '../db/schema';
import type { AuthProvider, CredentialResult } from './auth-provider';

const BCRYPT_ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, BCRYPT_ROUNDS);
}

/**
 * Email + password against our own users table. Deliberately minimal: it
 * exists so the product runs end-to-end today, and is replaced wholesale by a
 * hosted provider before real client data goes near it.
 */
@Injectable()
export class LocalAuthProvider implements AuthProvider {
  readonly name = 'local';

  constructor(@Inject(DB) private readonly db: Db) {}

  async authenticate(
    email: string,
    password: string,
    tenantId: string | null,
  ): Promise<CredentialResult | null> {
    const [user] = await this.db
      .select({
        id: users.id,
        passwordHash: users.passwordHash,
        isActive: users.isActive,
      })
      .from(users)
      .where(
        and(
          eq(sql`lower(${users.email})`, email.trim().toLowerCase()),
          tenantId ? eq(users.tenantId, tenantId) : isNull(users.tenantId),
        ),
      )
      .limit(1);

    // Compare against a dummy hash when the user is missing so that a wrong
    // email and a wrong password take the same time to answer.
    const storedHash = user?.passwordHash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
    const ok = await compare(password, storedHash);

    if (!user || !ok || !user.isActive) return null;
    return { userId: user.id };
  }
}

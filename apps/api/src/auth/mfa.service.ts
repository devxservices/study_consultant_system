import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, count, eq, inArray, isNull } from 'drizzle-orm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import {
  mfaRequiredFor,
  type AuthUser,
  type MfaPolicy,
  type MfaSetup,
  type MfaStatus,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { mfaRecoveryCodes, tenants, users } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { generateSecret, otpauthUrl, verifyTotp } from './totp';
import { open, seal } from './secret-box';

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECOVERY_COUNT = 10;
const CHALLENGE_TTL = '5m';
const MAX_CHALLENGE_ATTEMPTS = 5;

interface ChallengePayload {
  sub: string;
  purpose: 'mfa';
  jti: string;
}

function hashCode(code: string): string {
  return createHash('sha256').update(code.toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');
}

function newRecoveryCode(): string {
  const bytes = randomBytes(10);
  let s = '';
  for (const b of bytes) s += RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length];
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

/**
 * Two-step verification with an authenticator app.
 *
 *  - Enrolment is two steps: a secret is generated and held as "pending"
 *    until the person proves they scanned it by entering a code from it.
 *  - The secret is stored encrypted; codes are never stored. Each accepted
 *    code's 30-second window is remembered, so no code works twice.
 *  - Ten recovery codes are shown once and stored as hashes; each works once.
 *  - At sign-in, a correct password with two-step switched on yields a
 *    short-lived challenge, not a session. Five wrong codes burn it.
 */
@Injectable()
export class MfaService {
  /** Wrong-code counts per challenge, so a stolen password cannot be followed by a million guesses. */
  private readonly attempts = new Map<string, number>();

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async policyFor(tenantId: string | null): Promise<MfaPolicy | null> {
    if (!tenantId) return null;
    const [row] = await this.db
      .select({ policy: tenants.mfaPolicy })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    return (row?.policy as MfaPolicy) ?? 'optional';
  }

  async status(actor: AuthUser): Promise<MfaStatus> {
    const [row] = await this.db
      .select({ enabledAt: users.mfaEnabledAt })
      .from(users)
      .where(eq(users.id, actor.id))
      .limit(1);
    const [left] = await this.db
      .select({ n: count() })
      .from(mfaRecoveryCodes)
      .where(and(eq(mfaRecoveryCodes.userId, actor.id), isNull(mfaRecoveryCodes.usedAt)));
    const policy = await this.policyFor(actor.tenantId);
    return {
      enabled: Boolean(row?.enabledAt),
      enabledAt: row?.enabledAt ? new Date(row.enabledAt).toISOString() : null,
      recoveryCodesLeft: row?.enabledAt ? Number(left?.n ?? 0) : 0,
      required: policy ? mfaRequiredFor(policy, actor.role) : false,
      policy,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Enrolment                                                         */
  /* ---------------------------------------------------------------- */

  async startSetup(actor: AuthUser, issuer: string): Promise<MfaSetup> {
    if (actor.mfaEnabled) throw new BadRequestException('Two-step verification is already on.');
    const secret = generateSecret();
    await this.db
      .update(users)
      .set({ mfaPendingSecret: seal(secret), updatedAt: new Date() })
      .where(eq(users.id, actor.id));
    const url = otpauthUrl(issuer, actor.email, secret);
    return {
      secret,
      otpauthUrl: url,
      qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 220, errorCorrectionLevel: 'M' }),
    };
  }

  async enable(actor: AuthUser, code: string): Promise<{ recoveryCodes: string[] }> {
    const [row] = await this.db
      .select({ pending: users.mfaPendingSecret, enabledAt: users.mfaEnabledAt })
      .from(users)
      .where(eq(users.id, actor.id))
      .limit(1);
    if (row?.enabledAt) throw new BadRequestException('Two-step verification is already on.');
    if (!row?.pending) throw new BadRequestException('Start the set-up again - the QR code has expired.');

    const secret = open(row.pending);
    const step = verifyTotp(secret, code, null);
    if (step === null) {
      throw new BadRequestException({
        message: 'That code did not match. Check your phone’s clock is right and try the newest code.',
        fieldErrors: { code: 'That code did not match.' },
      });
    }

    await this.db
      .update(users)
      .set({
        mfaSecret: row.pending,
        mfaPendingSecret: null,
        mfaEnabledAt: new Date(),
        mfaLastStep: step,
        updatedAt: new Date(),
      })
      .where(eq(users.id, actor.id));
    const recoveryCodes = await this.replaceRecoveryCodes(actor.id);
    await this.audit.record(actor, { action: 'mfa.enabled', entityType: 'user', entityId: actor.id });
    return { recoveryCodes };
  }

  async disable(actor: AuthUser, code: string): Promise<void> {
    const policy = await this.policyFor(actor.tenantId);
    if (policy && mfaRequiredFor(policy, actor.role)) {
      throw new ForbiddenException('Your consultancy requires two-step verification, so it cannot be switched off.');
    }
    await this.assertCode(actor.id, code);
    await this.clear(actor.id);
    await this.audit.record(actor, { action: 'mfa.disabled', entityType: 'user', entityId: actor.id });
  }

  async regenerate(actor: AuthUser, code: string): Promise<{ recoveryCodes: string[] }> {
    await this.assertCode(actor.id, code);
    const recoveryCodes = await this.replaceRecoveryCodes(actor.id);
    await this.audit.record(actor, {
      action: 'mfa.recovery_codes_regenerated',
      entityType: 'user',
      entityId: actor.id,
    });
    return { recoveryCodes };
  }

  /* ---------------------------------------------------------------- */
  /* Sign-in                                                           */
  /* ---------------------------------------------------------------- */

  async challengeFor(userId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, purpose: 'mfa', jti: randomUUID() } satisfies ChallengePayload,
      { expiresIn: CHALLENGE_TTL as unknown as number },
    );
  }

  /**
   * The second step. Returns the user id the challenge was for, once a code
   * from their app - or one unused recovery code - checks out.
   */
  async completeChallenge(
    challenge: string,
    input: { code?: string; recoveryCode?: string },
    onFailure: (userId: string) => Promise<void>,
  ): Promise<{ userId: string; usedRecoveryCode: boolean }> {
    let payload: ChallengePayload;
    try {
      payload = await this.jwt.verifyAsync<ChallengePayload>(challenge);
    } catch {
      throw new UnauthorizedException('That took too long. Please sign in again.');
    }
    if (payload.purpose !== 'mfa' || !payload.jti) throw new UnauthorizedException('Please sign in again.');

    const tries = this.attempts.get(payload.jti) ?? 0;
    if (tries >= MAX_CHALLENGE_ATTEMPTS) {
      throw new UnauthorizedException('Too many wrong codes. Please sign in again.');
    }

    const ok = input.recoveryCode
      ? await this.consumeRecoveryCode(payload.sub, input.recoveryCode)
      : await this.checkCode(payload.sub, input.code ?? '');

    if (!ok) {
      this.attempts.set(payload.jti, tries + 1);
      this.sweepAttempts();
      await onFailure(payload.sub);
      throw new UnauthorizedException({
        message: input.recoveryCode ? 'That recovery code is not valid or has been used.' : 'That code did not match. Try the newest one from your app.',
        fieldErrors: { code: 'That code did not match.' },
      });
    }
    this.attempts.delete(payload.jti);
    return { userId: payload.sub, usedRecoveryCode: Boolean(input.recoveryCode) };
  }

  /* ---------------------------------------------------------------- */
  /* Resets by someone else                                            */
  /* ---------------------------------------------------------------- */

  /**
   * For someone who has lost their phone and their recovery codes. A manager
   * resets a member of their own consultancy (staff or client); a platform
   * admin resets a consultancy's manager. The person sets it up again at their
   * next sign-in if their consultancy requires it.
   */
  async resetFor(actor: AuthUser, userId: string, tenantId: string, roles: string[]): Promise<void> {
    const [target] = await this.db
      .select({ id: users.id, name: users.fullName })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId), inArray(users.role, roles as never[])))
      .limit(1);
    if (!target) throw new NotFoundException('Member not found.');
    await this.clear(userId);
    await this.audit.record(actor, {
      action: 'mfa.reset',
      entityType: 'user',
      entityId: userId,
      tenantId,
      metadata: { memberName: target.name },
    });
  }

  /* ---------------------------------------------------------------- */

  private async clear(userId: string): Promise<void> {
    await this.db
      .update(users)
      .set({ mfaSecret: null, mfaPendingSecret: null, mfaEnabledAt: null, mfaLastStep: null, updatedAt: new Date() })
      .where(eq(users.id, userId));
    await this.db.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId));
  }

  private async assertCode(userId: string, code: string): Promise<void> {
    if (!(await this.checkCode(userId, code))) {
      throw new BadRequestException({
        message: 'That code did not match.',
        fieldErrors: { code: 'That code did not match.' },
      });
    }
  }

  /** Accepts a current code once, and remembers its window so it cannot be replayed. */
  private async checkCode(userId: string, code: string): Promise<boolean> {
    const [row] = await this.db
      .select({ secret: users.mfaSecret, last: users.mfaLastStep })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row?.secret) return false;
    const step = verifyTotp(open(row.secret), code, row.last ?? null);
    if (step === null) return false;
    // Conditional on the window not having moved, so two simultaneous
    // submissions of the same code cannot both succeed.
    const claimed = await this.db
      .update(users)
      .set({ mfaLastStep: step })
      .where(and(eq(users.id, userId), row.last === null ? isNull(users.mfaLastStep) : eq(users.mfaLastStep, row.last)))
      .returning({ id: users.id });
    return claimed.length === 1;
  }

  private async consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
    const used = await this.db
      .update(mfaRecoveryCodes)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(mfaRecoveryCodes.userId, userId),
          eq(mfaRecoveryCodes.codeHash, hashCode(code)),
          isNull(mfaRecoveryCodes.usedAt),
        ),
      )
      .returning({ id: mfaRecoveryCodes.id });
    return used.length === 1;
  }

  private async replaceRecoveryCodes(userId: string): Promise<string[]> {
    const codes = Array.from({ length: RECOVERY_COUNT }, newRecoveryCode);
    await this.db.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId));
    await this.db.insert(mfaRecoveryCodes).values(codes.map((c) => ({ userId, codeHash: hashCode(c) })));
    return codes;
  }

  private sweepAttempts(): void {
    if (this.attempts.size > 10_000) this.attempts.clear();
  }
}

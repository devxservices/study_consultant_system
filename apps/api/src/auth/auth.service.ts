import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq, sql } from 'drizzle-orm';
import { compare } from 'bcryptjs';
import {
  mfaRequiredFor,
  type AuthUser,
  type MfaPolicy,
  type Role,
  type TenantStatus,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { clients, consultants, staffRoles, tenants, users } from '../db/schema';
import type { ResolvedHost } from '../tenancy/tenant-resolver.service';
import { AuditService } from '../audit/audit.service';
import { PermissionsService, type EffectPairs } from '../team/permissions.service';
import { AUTH_PROVIDER, type AuthProvider } from './auth-provider';
import { hashPassword } from './local-auth.provider';
import { MfaService } from './mfa.service';

interface TokenPayload {
  sub: string;
  role: Role;
  /** Present only on two-step challenge tokens, which are never sessions. */
  purpose?: string;
  /** Issue time in whole seconds, added by the signer. */
  iat?: number;
  /** Issue time in milliseconds, so a session started just after a password change is told apart from one just before it. */
  at?: number;
}

/** What someone locked out of a closed consultancy is told. The reason stays internal. */
const UNAVAILABLE_MESSAGE =
  'This consultancy’s portal is currently unavailable. Please contact the consultancy directly.';

const WRONG_CREDENTIALS = 'That email and password do not match.';

export type SignInResult =
  | { kind: 'session'; token: string; user: AuthUser }
  | { kind: 'challenge'; challenge: string };

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AUTH_PROVIDER) private readonly provider: AuthProvider,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly permissions: PermissionsService,
    private readonly mfa: MfaService,
  ) {}

  /**
   * Sign in on a particular site. The site decides whose accounts the
   * credentials are checked against: a consultancy's address only matches that
   * consultancy's users, and the admin address only matches platform admins.
   *
   * With two-step verification on, a correct password earns a short-lived
   * challenge, not a session - the code from the app is the second half.
   * Every failure is recorded against the consultancy it was attempted on.
   */
  async signIn(email: string, password: string, site: ResolvedHost): Promise<SignInResult> {
    if (site.kind === 'unknown') {
      throw new NotFoundException('This address is not connected to a consultancy.');
    }
    if (site.kind === 'tenant' && site.tenant.status !== 'active') {
      throw new ForbiddenException(UNAVAILABLE_MESSAGE);
    }

    const tenantId = site.kind === 'tenant' ? site.tenant.id : null;
    const result = await this.provider.authenticate(email, password, tenantId);
    const user = result ? await this.loadUser(result.userId) : null;
    // One message for every failure mode - never reveal whether the email exists.
    if (!user || user.tenantId !== tenantId) {
      await this.audit.record(null, {
        action: 'user.sign_in_failed',
        entityType: 'user',
        tenantId,
        metadata: { email: email.trim().toLowerCase(), reason: 'wrong email or password' },
      });
      throw new UnauthorizedException(WRONG_CREDENTIALS);
    }

    if (user.mfaEnabled) {
      return { kind: 'challenge', challenge: await this.mfa.challengeFor(user.id) };
    }
    return { kind: 'session', ...(await this.startSession(user)) };
  }

  /** The second step of a two-step sign-in. */
  async completeMfa(
    challenge: string,
    input: { code?: string; recoveryCode?: string },
  ): Promise<{ token: string; user: AuthUser }> {
    const { userId, usedRecoveryCode } = await this.mfa.completeChallenge(challenge, input, async (id) => {
      const who = await this.loadUser(id).catch(() => null);
      await this.audit.record(who, { action: 'mfa.challenge_failed', entityType: 'user', entityId: id });
    });
    const user = await this.loadUser(userId);
    if (!user) throw new UnauthorizedException(WRONG_CREDENTIALS);
    if (usedRecoveryCode) {
      await this.audit.record(user, { action: 'mfa.recovery_code_used', entityType: 'user', entityId: user.id });
    }
    return this.startSession(user);
  }

  private async startSession(user: AuthUser): Promise<{ token: string; user: AuthUser }> {
    await this.db.update(users).set({ lastSignInAt: new Date() }).where(eq(users.id, user.id));
    await this.audit.record(user, { action: 'user.signed_in', entityType: 'user', entityId: user.id });
    const token = await this.jwt.signAsync({ sub: user.id, role: user.role, at: Date.now() } satisfies TokenPayload);
    return { token, user };
  }

  /** Recorded when the token is still good; signing out never fails either way. */
  async recordSignOut(token: string | null): Promise<void> {
    if (!token) return;
    try {
      const user = await this.verify(token);
      await this.audit.record(user, { action: 'user.signed_out', entityType: 'user', entityId: user.id });
    } catch {
      /* an expired or foreign session signs out silently */
    }
  }

  /** Anyone, for their own account, proving they know the current password. */
  async changePassword(user: AuthUser, current: string, next: string): Promise<void> {
    const [row] = await this.db
      .select({ hash: users.passwordHash })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    if (!row?.hash || !(await compare(current, row.hash))) {
      throw new BadRequestException({
        message: 'Your current password is not right.',
        fieldErrors: { currentPassword: 'That is not your current password.' },
      });
    }
    await this.db
      .update(users)
      .set({ passwordHash: await hashPassword(next), sessionsValidAfter: sessionsCutoff(), updatedAt: new Date() })
      .where(eq(users.id, user.id));
    await this.audit.record(user, {
      action: 'user.password_changed',
      entityType: 'user',
      entityId: user.id,
    });
  }

  async verify(token: string): Promise<AuthUser> {
    let payload: TokenPayload;
    try {
      payload = await this.jwt.verifyAsync<TokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Your session has expired. Please sign in again.');
    }
    // A two-step challenge is signed with the same key but is not a session.
    if (payload.purpose) throw new UnauthorizedException('Please sign in again.');

    // Re-read the user on every request rather than trusting the token body:
    // a deactivated account, a changed role, a permission taken away or a
    // suspended consultancy takes effect immediately.
    const { user, sessionsValidAfter } = await this.resolveUser(payload.sub);
    if (!user) throw new UnauthorizedException('Your session is no longer valid.');
    // A password change, a reset or "sign out everywhere" ends every session
    // signed before it.
    const issuedAt = payload.at ?? (payload.iat ?? 0) * 1000;
    if (sessionsValidAfter && issuedAt < sessionsValidAfter.getTime()) {
      throw new UnauthorizedException('You have been signed out. Please sign in again.');
    }
    return user;
  }

  /** Ends every session this person has, on every device, from this second on. */
  async endSessions(userId: string): Promise<void> {
    await this.db.update(users).set({ sessionsValidAfter: sessionsCutoff() }).where(eq(users.id, userId));
  }

  /** A fresh session for someone whose others were just ended - so they stay signed in here. */
  async reissue(user: AuthUser): Promise<string> {
    return this.jwt.signAsync({ sub: user.id, role: user.role, at: Date.now() } satisfies TokenPayload);
  }

  /**
   * Resolves the identity every guard and service works with: the tenant, the
   * consultant/client row ids that data scoping is built on, the member's
   * effective permissions, and where they stand on two-step verification.
   *
   * Returns null for an inactive user, and refuses outright for a user whose
   * consultancy is closed.
   */
  async loadUser(userId: string): Promise<AuthUser | null> {
    return (await this.resolveUser(userId)).user;
  }

  private async resolveUser(userId: string): Promise<{ user: AuthUser | null; sessionsValidAfter: Date | null }> {
    const [row] = await this.db
      .select({
        id: users.id,
        tenantId: users.tenantId,
        tenantStatus: tenants.status,
        mfaPolicy: tenants.mfaPolicy,
        email: users.email,
        fullName: users.fullName,
        role: users.role,
        isActive: users.isActive,
        avatarColor: users.avatarColor,
        mfaEnabledAt: users.mfaEnabledAt,
        sessionsValidAfter: users.sessionsValidAfter,
        consultantId: consultants.id,
        clientId: clients.id,
        partnerId: users.partnerId,
        // The member's role arrives in this same query: one join, no extra round trip.
        roleTitle: staffRoles.name,
        roleTakesClients: staffRoles.takesClients,
        roleEffects: staffRoles.effects,
        // A consultant's permission layers, in this same round trip. CASE
        // short-circuits, so nobody else pays for the subqueries.
        consultancyEffects: sql<EffectPairs>`case when ${users.role} = 'consultant' then (
          select json_agg(json_build_array(rp.permission, rp.effect))
          from role_permissions rp
          where rp.tenant_id = ${users.tenantId} and rp.role = 'consultant'
        ) end`,
        memberEffects: sql<EffectPairs>`case when ${users.role} = 'consultant' then (
          select json_agg(json_build_array(up.permission, up.effect))
          from user_permissions up
          where up.user_id = ${users.id} and up.tenant_id = ${users.tenantId}
        ) end`,
      })
      .from(users)
      .leftJoin(tenants, eq(tenants.id, users.tenantId))
      .leftJoin(consultants, eq(consultants.userId, users.id))
      .leftJoin(clients, eq(clients.userId, users.id))
      .leftJoin(staffRoles, eq(staffRoles.id, users.staffRoleId))
      .where(eq(users.id, userId))
      .limit(1);

    const none = { user: null, sessionsValidAfter: null };
    if (!row || !row.isActive) return none;

    // The invariant the whole tenancy model rests on: platform admins belong to
    // no consultancy, and everybody else belongs to exactly one. A row that
    // breaks it is refused rather than guessed at.
    const role = row.role as Role;
    if ((role === 'super_admin') !== (row.tenantId === null)) return none;

    if (row.tenantId && (row.tenantStatus as TenantStatus | null) !== 'active') {
      throw new ForbiddenException(UNAVAILABLE_MESSAGE);
    }

    const mfaEnabled = Boolean(row.mfaEnabledAt);
    const policy = (row.mfaPolicy as MfaPolicy | null) ?? 'optional';

    const user: AuthUser = {
      id: row.id,
      tenantId: row.tenantId,
      email: row.email,
      fullName: row.fullName,
      role,
      consultantId: row.consultantId,
      clientId: row.clientId,
      partnerId: role === 'partner' ? row.partnerId : null,
      roleTitle: role === 'consultant' ? (row.roleTitle ?? null) : null,
      // No role means the consultancy's defaults: a caseload, as before roles existed.
      takesClients: role === 'consultant' ? (row.roleTakesClients ?? true) : false,
      avatarColor: row.avatarColor,
      permissions: this.permissions.fromEffects(
        row.tenantId,
        role,
        row.consultancyEffects,
        row.memberEffects,
        row.roleEffects,
      ),
      mfaEnabled,
      mfaSetupRequired: row.tenantId !== null && mfaRequiredFor(policy, role) && !mfaEnabled,
    };
    return { user, sessionsValidAfter: row.sessionsValidAfter ? new Date(row.sessionsValidAfter) : null };
  }
}

/** The moment from which sessions count: everything signed before it is refused. */
export function sessionsCutoff(): Date {
  return new Date();
}

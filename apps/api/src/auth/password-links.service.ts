import { BadRequestException, GoneException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import type { AuthUser, PasswordLinkInfo, PasswordLinkResult } from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { passwordTokens, tenants, users } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { MailService, textToHtml } from '../mail/mail.service';
import { adminOrigin, tenantIdentity } from '../tenancy/tenant-links';
import type { ResolvedHost } from '../tenancy/tenant-resolver.service';
import { hashPassword } from './local-auth.provider';
import { sessionsCutoff } from './auth.service';

type Purpose = 'reset' | 'invite';

/** A reset is for someone at their screen right now; an invitation waits in an inbox. */
const LIFETIME_MS: Record<Purpose, number> = {
  reset: 60 * 60 * 1000,
  invite: 7 * 24 * 60 * 60 * 1000,
};

/** Reset emails one account can trigger in an hour, so the form cannot be used to flood an inbox. */
const RESETS_PER_HOUR = 3;

const LINK_PATH = '/reset-password';

interface Person {
  id: string;
  tenantId: string | null;
  email: string;
  fullName: string;
  role: string;
}

/**
 * Links that let someone choose their own password: "forgot my password" on
 * the sign-in page, and an invitation staff send a new client or colleague
 * instead of reading a password out to them.
 *
 * A link is single-use, short-lived, works only on its own consultancy's
 * site, and only its hash is stored. Choosing a password through one ends
 * every session the person had. It never signs anyone in by itself: they
 * sign in afterwards, with two-step verification if they use it.
 */
@Injectable()
export class PasswordLinksService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  /**
   * "Forgot my password". Always succeeds from the caller's point of view -
   * whether an account exists for that email is nobody's business - and
   * sends at most a few emails an hour per account.
   */
  async requestReset(site: ResolvedHost, email: string): Promise<void> {
    if (site.kind === 'unknown') throw new NotFoundException('This address is not connected to a consultancy.');
    if (site.kind === 'tenant' && site.tenant.status !== 'active') return;
    const tenantId = site.kind === 'tenant' ? site.tenant.id : null;

    const [person] = await this.db
      .select({ id: users.id, tenantId: users.tenantId, email: users.email, fullName: users.fullName, role: users.role })
      .from(users)
      .where(
        and(
          sql`lower(${users.email}) = ${email.trim().toLowerCase()}`,
          tenantId ? eq(users.tenantId, tenantId) : isNull(users.tenantId),
          eq(users.isActive, true),
        ),
      )
      .limit(1);
    if (!person) return;

    const [recent] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(passwordTokens)
      .where(
        and(
          eq(passwordTokens.userId, person.id),
          eq(passwordTokens.purpose, 'reset'),
          gt(passwordTokens.createdAt, new Date(Date.now() - 60 * 60 * 1000)),
        ),
      );
    if ((recent?.n ?? 0) >= RESETS_PER_HOUR) return;

    const { link, expiresAt } = await this.issue(person, 'reset', null);
    await this.email(person, 'reset', link, expiresAt);
    await this.audit.record(null, {
      action: 'user.password_reset_requested',
      entityType: 'user',
      entityId: person.id,
      tenantId: person.tenantId,
      metadata: { email: person.email },
    });
  }

  /**
   * A link staff make for someone - a client's portal invitation, a new
   * colleague's first password, or a reset for someone locked out. It is
   * emailed, and also returned so staff can send it by WhatsApp or SMS.
   * Callers check the person is theirs to invite; this only issues.
   */
  async sendLink(actor: AuthUser, userId: string, purpose: Purpose, memberName?: string): Promise<PasswordLinkResult> {
    const [person] = await this.db
      .select({ id: users.id, tenantId: users.tenantId, email: users.email, fullName: users.fullName, role: users.role })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.isActive, true)))
      .limit(1);
    if (!person) throw new NotFoundException('That login is switched off. Switch it on first.');
    // Staff reach only their own consultancy; the platform admin's routes reach managers anywhere.
    if (actor.role !== 'super_admin' && person.tenantId !== actor.tenantId) {
      throw new NotFoundException('That person is not in your consultancy.');
    }

    const { link, expiresAt } = await this.issue(person, purpose, actor.id);
    const emailed = await this.email(person, purpose, link, expiresAt);
    await this.audit.record(actor, {
      action: 'user.password_link_sent',
      entityType: 'user',
      entityId: person.id,
      tenantId: person.tenantId,
      metadata: { purpose, memberName: memberName ?? person.fullName, emailed },
    });
    return { link, emailed, expiresAt: expiresAt.toISOString() };
  }

  /** What a link is for, so the page can greet the person. Refuses spent, expired and foreign links. */
  async inspect(site: ResolvedHost, token: string): Promise<PasswordLinkInfo> {
    const { person, row } = await this.find(site, token);
    return {
      purpose: row.purpose as Purpose,
      firstName: person.fullName.split(/\s+/)[0] ?? person.fullName,
      email: person.email,
    };
  }

  /** Sets the password, spends every open link the person has, and ends their sessions. */
  async complete(site: ResolvedHost, token: string, password: string): Promise<{ email: string }> {
    const { person, row } = await this.find(site, token);
    const passwordHash = await hashPassword(password);

    const spent = await this.db.transaction(async (tx) => {
      // Spending the link and setting the password happen together, and only
      // once: a second submission of the same link finds it already used.
      const [claimed] = await tx
        .update(passwordTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(passwordTokens.id, row.id), isNull(passwordTokens.usedAt)))
        .returning({ id: passwordTokens.id });
      if (!claimed) return false;
      await tx
        .update(passwordTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(passwordTokens.userId, person.id), isNull(passwordTokens.usedAt)));
      await tx
        .update(users)
        .set({ passwordHash, sessionsValidAfter: sessionsCutoff(), updatedAt: new Date() })
        .where(eq(users.id, person.id));
      return true;
    });
    if (!spent) throw new GoneException('This link has already been used. Ask for a new one if you need it.');

    await this.audit.record(null, {
      action: 'user.password_reset',
      entityType: 'user',
      entityId: person.id,
      tenantId: person.tenantId,
      metadata: { email: person.email, via: row.purpose },
    });
    return { email: person.email };
  }

  /* ---------------------------------------------------------------- */

  private async issue(person: Person, purpose: Purpose, createdBy: string | null) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + LIFETIME_MS[purpose]);
    // A newer link replaces the older ones, so only the latest email works.
    await this.db
      .update(passwordTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordTokens.userId, person.id), isNull(passwordTokens.usedAt)));
    await this.db.insert(passwordTokens).values({
      tenantId: person.tenantId,
      userId: person.id,
      purpose,
      tokenHash: hashToken(token),
      expiresAt,
      createdBy,
    });
    const origin = person.tenantId ? (await tenantIdentity(this.db, person.tenantId)).origin : adminOrigin();
    return { link: `${origin}${LINK_PATH}?token=${token}`, expiresAt };
  }

  private async find(site: ResolvedHost, token: string) {
    if (site.kind === 'unknown') throw new NotFoundException('This address is not connected to a consultancy.');
    const [hit] = await this.db
      .select({
        row: passwordTokens,
        person: { id: users.id, tenantId: users.tenantId, email: users.email, fullName: users.fullName, role: users.role, isActive: users.isActive },
        tenantStatus: tenants.status,
      })
      .from(passwordTokens)
      .innerJoin(users, eq(users.id, passwordTokens.userId))
      .leftJoin(tenants, eq(tenants.id, passwordTokens.tenantId))
      .where(eq(passwordTokens.tokenHash, hashToken(token)))
      .limit(1);

    // A link only works on its own consultancy's addresses (or the admin site).
    const siteTenant = site.kind === 'tenant' ? site.tenant.id : null;
    if (!hit || hit.row.tenantId !== siteTenant || !hit.person.isActive) {
      throw new NotFoundException('This link is not valid. Ask for a new one.');
    }
    if (hit.tenantStatus && hit.tenantStatus !== 'active') {
      throw new NotFoundException('This consultancy’s portal is currently unavailable.');
    }
    if (hit.row.usedAt) throw new GoneException('This link has already been used, or a newer one was sent. Use the latest email, or ask for a new link.');
    if (hit.row.expiresAt.getTime() < Date.now()) {
      throw new GoneException(
        hit.row.purpose === 'invite'
          ? 'This invitation has expired. Ask the consultancy to send a new one.'
          : 'This link has expired. Ask for a new one - it only lasts an hour.',
      );
    }
    return { row: hit.row, person: hit.person };
  }

  private async email(person: Person, purpose: Purpose, link: string, expiresAt: Date): Promise<boolean> {
    const site = person.tenantId ? await tenantIdentity(this.db, person.tenantId) : null;
    const name = site?.name ?? 'Platform administration';
    const first = person.fullName.split(/\s+/)[0] ?? person.fullName;
    const lasts = purpose === 'invite' ? `until ${expiresAt.toUTCString().slice(0, 16)}` : 'for one hour';
    const text =
      purpose === 'invite'
        ? `Hello ${first},\n\n${name} has set up your account. Choose your password here:\n\n${link}\n\nThe link works once, ${lasts}. Afterwards, sign in with ${person.email} and the password you chose.${site?.contactEmail ? `\n\nQuestions? Reply to this email or write to ${site.contactEmail}.` : ''}\n\n${name}`
        : `Hello ${first},\n\nSomeone asked to reset the password for ${person.email} at ${name}. Choose a new one here:\n\n${link}\n\nThe link works once, ${lasts}. If you did not ask for this, ignore this email - your password stays as it is.\n\n${name}`;
    return this.mail.send({
      to: person.email,
      subject: purpose === 'invite' ? `Your ${name} account - choose your password` : `Reset your ${name} password`,
      text,
      html: textToHtml(text),
      fromName: name,
      replyTo: site?.contactEmail ?? undefined,
    });
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

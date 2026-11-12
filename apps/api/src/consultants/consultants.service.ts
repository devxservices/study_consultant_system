import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { hasPermission, type AuthUser, type CreateConsultantInput, type PasswordLinkResult, type UpdateStaffInput } from '@crm/shared';
import { AuditService } from '../audit/audit.service';
import { EntitlementsService } from '../tenancy/entitlements.service';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { consultants, staffRoles, users } from '../db/schema';
import { hashPassword } from '../auth/local-auth.provider';
import { sessionsCutoff } from '../auth/auth.service';
import { PasswordLinksService } from '../auth/password-links.service';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { StatsCacheService } from '../stats/stats-cache.service';

export interface ConsultantSummary {
  id: string;
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  avatarColor: string;
  countries: string[];
  maxActiveClients: number;
  /** Non-archived clients assigned to them. */
  activeClients: number;
  /** Documents waiting on this consultant to review - the real workload signal. */
  pendingReviews: number;
  /** Cases that have sat in the same stage past its threshold. */
  stuckCases: number;
  /** False once a manager has switched their login off. */
  active: boolean;
  lastSignInAt: string | null;
  /** Their role (Accountant, Trainer...), if any. */
  roleTitle: string | null;
  /** False for a role with no caseload; they are never offered for assignment. */
  takesClients: boolean;
}

/** A document waiting to be reviewed, as `d`. */
const PENDING_DOC = `d.status in ('pending', 'under_review') and d.deleted_at is null and d.trashed_at is null and d.superseded_by is null`;

interface Workload {
  activeClients: number;
  pendingReviews: number;
  stuckCases: number;
}

/**
 * One consultant's workload, live - what their own dashboard header shows.
 * Each count walks only their own records through an index:
 * - active clients: their non-archived clients;
 * - pending reviews: documents waiting on review on their cases, or on their
 *   clients - a union of the two index paths, each document once;
 * - stuck cases: their live cases past the stage's limit (`stuck_at`, the
 *   same test as the "Not moving" lists, so a count and the list beside it
 *   never disagree).
 */
function workloadOf(consultantId: string) {
  return {
    activeClients: sql<number>`(
      select count(*)::int from clients cl
      where cl.assigned_consultant_id = ${consultantId} and cl.archived = false
    )`,
    pendingReviews: sql<number>`(
      select count(*)::int from (
        select d.id from documents d join cases c on c.id = d.case_id
        where c.consultant_id = ${consultantId} and ${sql.raw(PENDING_DOC)}
        union
        select d.id from documents d join clients cl on cl.id = d.client_id
        where cl.assigned_consultant_id = ${consultantId} and ${sql.raw(PENDING_DOC)}
      ) waiting
    )`,
    stuckCases: sql<number>`(
      select count(*)::int from cases c
      where c.consultant_id = ${consultantId}
        and c.status = 'active' and c.current_stage <> 'closed' and c.stuck_at < now()
    )`,
  };
}

@Injectable()
export class ConsultantsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
    private readonly links: PasswordLinksService,
    private readonly stats: StatsCacheService,
  ) {}

  /**
   * The roster of the actor's own consultancy. Managers use it for workload
   * and reassignment; consultants get it to populate their own name in forms.
   * Clients have no business here.
   */
  async list(actor: AuthUser, includeInactive = false, everyone = false): Promise<ConsultantSummary[]> {
    if (actor.role === 'client') {
      throw new ForbiddenException('You do not have access to the consultant list.');
    }

    const [rows, counts] = await Promise.all([this.db
      .select(this.rosterSelection())
      .from(consultants)
      .innerJoin(users, eq(users.id, consultants.userId))
      .leftJoin(staffRoles, eq(staffRoles.id, users.staffRoleId))
      .where(
        and(
          eq(consultants.tenantId, tenantOf(actor)),
          // The team view lists everyone; every other list is who can take a
          // student - active, and in a role with a caseload.
          (includeInactive && hasPermission(actor, 'staff.manage')) || everyone
            ? undefined
            : and(eq(users.isActive, true), sql`coalesce(${staffRoles.takesClients}, true)`),
        ),
      )
      .orderBy(asc(sql`lower(${users.fullName})`)), this.rosterCounts(tenantOf(actor))]);

    const none: Workload = { activeClients: 0, pendingReviews: 0, stuckCases: 0 };
    return rows.map((r) => toSummary(r, counts[r.id] ?? none));
  }

  /**
   * The signed-in consultant's own workload numbers, for their dashboard
   * header - and every page of their desk, which shows the review badge.
   * Counted live over their own records only, never the whole team.
   */
  async me(actor: AuthUser): Promise<ConsultantSummary | null> {
    if (actor.role !== 'consultant' || !actor.consultantId) return null;
    const [row] = await this.db
      .select({ ...this.rosterSelection(), ...workloadOf(actor.consultantId) })
      .from(consultants)
      .innerJoin(users, eq(users.id, consultants.userId))
      .leftJoin(staffRoles, eq(staffRoles.id, users.staffRoleId))
      .where(and(eq(consultants.id, actor.consultantId), eq(consultants.tenantId, tenantOf(actor))))
      .limit(1);
    if (!row) return null;
    return toSummary(row, {
      activeClients: row.activeClients ?? 0,
      pendingReviews: row.pendingReviews ?? 0,
      stuckCases: row.stuckCases ?? 0,
    });
  }

  private rosterSelection() {
    return {
      id: consultants.id,
      userId: consultants.userId,
      name: users.fullName,
      email: users.email,
      phone: users.phone,
      avatarColor: users.avatarColor,
      active: users.isActive,
      lastSignInAt: users.lastSignInAt,
      countries: consultants.countries,
      maxActiveClients: consultants.maxActiveClients,
      roleTitle: staffRoles.name,
      takesClients: sql<boolean>`coalesce(${staffRoles.takesClients}, true)`,
    };
  }

  /**
   * Every consultant's workload in the consultancy, by consultant id: three
   * grouped passes instead of three counts per consultant, kept in the stats
   * cache (the team page and every consultant picker read it). The rules are
   * those of `workloadOf`; a document waiting on both a case's consultant and
   * the client's counts once for each of them, as it does there.
   */
  private rosterCounts(tenantId: string): Promise<Record<string, Workload>> {
    return this.stats.get(tenantId, 'roster-counts', async () => {
      const [active, pending, stuck] = await Promise.all([
        this.db.execute(sql`
          select assigned_consultant_id as id, count(*)::int as n from clients
          where tenant_id = ${tenantId} and archived = false and assigned_consultant_id is not null
          group by assigned_consultant_id`),
        this.db.execute(sql`
          select id, count(distinct doc)::int as n from (
            select c.consultant_id as id, d.id as doc from documents d join cases c on c.id = d.case_id
            where d.tenant_id = ${tenantId} and c.consultant_id is not null and ${sql.raw(PENDING_DOC)}
            union all
            select cl.assigned_consultant_id as id, d.id as doc from documents d join clients cl on cl.id = d.client_id
            where d.tenant_id = ${tenantId} and cl.assigned_consultant_id is not null and ${sql.raw(PENDING_DOC)}
          ) waiting group by id`),
        this.db.execute(sql`
          select consultant_id as id, count(*)::int as n from cases
          where tenant_id = ${tenantId} and consultant_id is not null
            and status = 'active' and current_stage <> 'closed' and stuck_at < now()
          group by consultant_id`),
      ]);
      const out: Record<string, Workload> = {};
      const at = (id: string) => (out[id] ??= { activeClients: 0, pendingReviews: 0, stuckCases: 0 });
      for (const r of rowsOf(active)) at(r.id).activeClients = Number(r.n);
      for (const r of rowsOf(pending)) at(r.id).pendingReviews = Number(r.n);
      for (const r of rowsOf(stuck)) at(r.id).stuckCases = Number(r.n);
      return out;
    });
  }

  /**
   * Creates a consultant: one login (`users`) plus their staff profile
   * (`consultants`), in a single transaction so a failure never leaves an
   * orphan login behind. Manager-only, enforced by the controller's @Roles,
   * and always inside the manager's own consultancy.
   */
  async create(actor: AuthUser, input: CreateConsultantInput): Promise<ConsultantSummary & { invite: PasswordLinkResult | null }> {
    const tenantId = tenantOf(actor);
    await this.entitlements.assertCanAddStaff(tenantId);
    const email = input.email.trim();

    const [existing] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(sql`lower(${users.email})`, email.toLowerCase())))
      .limit(1);
    if (existing) {
      throw new ConflictException('A user with that email already exists.');
    }

    // A role is a set of permissions, and only managers hand out permissions.
    if (input.roleId) {
      if (actor.role !== 'manager') {
        throw new ForbiddenException('Only a manager can give someone a role.');
      }
      const [role] = await this.db
        .select({ id: staffRoles.id })
        .from(staffRoles)
        .where(and(eq(staffRoles.id, input.roleId), eq(staffRoles.tenantId, tenantId)))
        .limit(1);
      if (!role) {
        throw new BadRequestException({ message: 'That role does not exist.', fieldErrors: { roleId: 'Pick a role.' } });
      }
    }

    // No password given: they choose their own from an emailed link.
    const passwordHash = input.password ? await hashPassword(input.password) : null;

    const consultantId = await this.db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          tenantId,
          email,
          passwordHash,
          fullName: input.fullName.trim(),
          role: 'consultant',
          phone: input.phone?.trim() ?? null,
          staffRoleId: input.roleId ?? null,
        })
        .returning({ id: users.id });
      if (!user) throw new Error('User insert returned no row');

      const [profile] = await tx
        .insert(consultants)
        .values({
          tenantId,
          userId: user.id,
          countries: input.countries ?? [],
          maxActiveClients: input.maxActiveClients ?? 60,
        })
        .returning({ id: consultants.id });
      if (!profile) throw new Error('Consultant insert returned no row');
      return profile.id;
    });

    const created = (await this.list(actor, false, true)).find((c) => c.id === consultantId);
    if (!created) throw new Error('Consultant was created but could not be read back.');
    await this.audit.record(actor, {
      action: 'staff.created',
      entityType: 'user',
      entityId: created.userId,
      metadata: { memberName: created.name, email: created.email, role: 'consultant' },
    });
    const invite = input.password ? null : await this.links.sendLink(actor, created.userId, 'invite', created.name);
    return { ...created, invite };
  }

  /**
   * Capacity, countries, or switching a login off. Deactivating keeps every
   * client, case and audit entry exactly as it was - reassign their clients
   * separately - and reactivating counts against the plan's staff limit again.
   */
  async update(actor: AuthUser, consultantId: string, input: UpdateStaffInput) {
    const tenantId = tenantOf(actor);
    const row = await this.findInTenant(tenantId, consultantId);
    this.assertMayManage(actor, row);

    if (input.active === true && !row.active) await this.entitlements.assertCanAddStaff(tenantId);

    await this.db.transaction(async (tx) => {
      const profile: Partial<typeof consultants.$inferInsert> = { updatedAt: new Date() };
      if (input.maxActiveClients !== undefined) profile.maxActiveClients = input.maxActiveClients;
      if (input.countries !== undefined) profile.countries = input.countries;
      await tx.update(consultants).set(profile).where(eq(consultants.id, consultantId));
      if (input.active !== undefined && input.active !== row.active) {
        await tx
          .update(users)
          .set({ isActive: input.active, updatedAt: new Date() })
          .where(eq(users.id, row.userId));
      }
    });

    // Switching a login off or on is its own event - the one an owner looks for.
    if (input.active !== undefined && input.active !== row.active) {
      await this.audit.record(actor, {
        action: input.active ? 'staff.reactivated' : 'staff.deactivated',
        entityType: 'user',
        entityId: row.userId,
        metadata: { consultantId, memberName: row.name },
      });
    }
    const other = Object.keys(input).filter((k) => k !== 'active');
    if (other.length > 0) {
      await this.audit.record(actor, {
        action: 'staff.updated',
        entityType: 'user',
        entityId: row.userId,
        metadata: { consultantId, memberName: row.name, changed: other },
      });
    }
    return (await this.list(actor, true, true)).find((c) => c.id === consultantId)!;
  }

  async resetPassword(actor: AuthUser, consultantId: string, password: string): Promise<void> {
    const row = await this.findInTenant(tenantOf(actor), consultantId);
    this.assertMayManage(actor, row);
    await this.db
      .update(users)
      .set({ passwordHash: await hashPassword(password), sessionsValidAfter: sessionsCutoff(), updatedAt: new Date() })
      .where(eq(users.id, row.userId));
    await this.audit.record(actor, {
      action: 'staff.password_reset',
      entityType: 'user',
      entityId: row.userId,
      metadata: { memberName: row.name },
    });
  }

  /**
   * Emails a colleague a link to choose their own password - an invitation
   * if they have never signed in, a reset otherwise - and returns it, so it
   * can also be sent another way.
   */
  async sendPasswordLink(actor: AuthUser, consultantId: string): Promise<PasswordLinkResult> {
    const row = await this.findInTenant(tenantOf(actor), consultantId);
    this.assertMayManage(actor, row);
    if (!row.active) throw new BadRequestException('Their login is switched off. Switch it on first.');
    return this.links.sendLink(actor, row.userId, row.lastSignInAt ? 'reset' : 'invite', row.name);
  }

  /**
   * A consultant trusted with managing staff manages consultants - never a
   * manager (whose password they could otherwise reset and sign in as), and
   * never their own login.
   */
  private assertMayManage(actor: AuthUser, target: { userId: string; role: string }): void {
    if (actor.role === 'manager') return;
    if (target.role === 'manager') {
      throw new ForbiddenException('Only a manager can change another manager’s login.');
    }
    if (target.userId === actor.id) {
      throw new ForbiddenException('Use your own account settings to change your password.');
    }
  }

  private async findInTenant(tenantId: string, consultantId: string) {
    const [row] = await this.db
      .select({ userId: consultants.userId, active: users.isActive, role: users.role, name: users.fullName, lastSignInAt: users.lastSignInAt })
      .from(consultants)
      .innerJoin(users, eq(users.id, consultants.userId))
      .where(and(eq(consultants.id, consultantId), eq(consultants.tenantId, tenantId)))
      .limit(1);
    if (!row) throw new NotFoundException('Consultant not found.');
    return row;
  }
}

/** A roster row with its workload, as the API returns it. */
function toSummary(
  r: {
    id: string;
    userId: string;
    name: string;
    email: string;
    phone: string | null;
    avatarColor: string;
    active: boolean;
    lastSignInAt: Date | string | null;
    countries: unknown;
    maxActiveClients: number;
    roleTitle: string | null;
    takesClients: boolean;
  },
  work: Workload,
): ConsultantSummary {
  return {
    id: r.id,
    userId: r.userId,
    name: r.name,
    email: r.email,
    phone: r.phone,
    avatarColor: r.avatarColor,
    active: r.active,
    lastSignInAt: r.lastSignInAt ? new Date(r.lastSignInAt).toISOString() : null,
    countries: Array.isArray(r.countries) ? (r.countries as string[]) : [],
    maxActiveClients: r.maxActiveClients,
    roleTitle: r.roleTitle,
    takesClients: r.takesClients,
    ...work,
  };
}

/** Both drivers answer `execute` with `rows`. */
function rowsOf(result: unknown): { id: string; n: number | string }[] {
  return ((result as { rows?: { id: string; n: number | string }[] }).rows ?? []);
}

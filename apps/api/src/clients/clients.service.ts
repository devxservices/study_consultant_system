import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import type {
  AuthUser,
  ClientProfile,
  ClientProfileInput,
  ClientProgramme,
  CreateClientInput,
  EnglishTest,
  LeadSource,
  ListClientsQuery,
  Paginated,
  PasswordLinkResult,
  Qualification,
  Stage,
  StudyLevel,
  UpdateClientInput,
} from '@crm/shared';
import { ConflictException } from '@nestjs/common';
import { hashPassword } from '../auth/local-auth.provider';
import { sessionsCutoff } from '../auth/auth.service';
import { PasswordLinksService } from '../auth/password-links.service';
import { EntitlementsService } from '../tenancy/entitlements.service';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { cases, clients, consultants, staffRoles, users } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { CasesService } from '../cases/cases.service';
import { NotificationsService } from '../notifications/notifications.service';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { permissionDenied, seesAll, staffCan } from '../auth/permissions';

export interface ClientCaseSummary {
  id: string;
  reference: string;
  targetCountry: string;
  targetUniversity: string | null;
  targetProgram: string | null;
  intake: string | null;
  currentStage: Stage;
  /** The stage in the application's own workflow: its key, name and time limit. */
  currentStageKey: string | null;
  stageName: string | null;
  stageSlaDays: number | null;
  status: string;
  stageEnteredAt: string;
  lastActivityAt: string;
}

export interface ClientListItem {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  city: string | null;
  archived: boolean;
  programme: ClientProgramme;
  hasLogin: boolean;
  createdAt: string;
  consultant: { id: string; name: string } | null;
  /** The case the consultant is most likely to mean when they say "this client". */
  primaryCase: ClientCaseSummary | null;
  caseCount: number;
  /** Documents sitting in this consultant's review queue for this client. */
  pendingReviews: number;
  /** Days since anything at all happened on any of their cases. */
  daysSinceActivity: number | null;
}

/* Scalar subqueries - one round trip instead of N+1 per row. */
const pendingReviewsSql = sql<number>`(
  select count(*)::int from documents d
  where d.client_id = ${clients.id}
    and d.status in ('pending', 'under_review') and d.deleted_at is null and d.trashed_at is null and d.superseded_by is null
)`;

const caseCountSql = sql<number>`(
  select count(*)::int from cases c where c.client_id = ${clients.id}
)`;

const lastActivitySql = sql<string | null>`(
  select max(c.last_activity_at) from cases c where c.client_id = ${clients.id}
)`;

/** The active case touched most recently; falls back to any case. */
const primaryCaseIdSql = sql<string | null>`(
  select c.id from cases c
  where c.client_id = ${clients.id}
  order by (c.status = 'active') desc, c.last_activity_at desc
  limit 1
)`;

/** Enum position, so "sort by stage" follows the pipeline, not the alphabet. */
const stageOrdinalSql = sql<number>`coalesce((
  select array_position(enum_range(null::stage), c.current_stage)
  from cases c
  where c.client_id = ${clients.id}
  order by (c.status = 'active') desc, c.last_activity_at desc
  limit 1
), 0)`;

@Injectable()
export class ClientsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly casesService: CasesService,
    private readonly notifications: NotificationsService,
    private readonly entitlements: EntitlementsService,
    private readonly links: PasswordLinksService,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Access scoping                                                    */
  /* ---------------------------------------------------------------- */

  /**
   * The single place that decides which client rows an actor may touch.
   * Enforced in SQL, so a guessed id simply matches nothing.
   *
   * The tenant condition comes first and applies to every role: a manager sees
   * every client in their own consultancy and nothing in anyone else's.
   */
  private scope(actor: AuthUser): SQL | undefined {
    return and(eq(clients.tenantId, tenantOf(actor)), this.roleScope(actor));
  }

  private roleScope(actor: AuthUser): SQL | undefined {
    switch (actor.role) {
      case 'manager':
        return undefined;
      case 'consultant':
        // Widened only by an explicit "see every client" permission.
        if (seesAll(actor)) return undefined;
        // A consultant with no profile row must never fall through to "all".
        return eq(clients.assignedConsultantId, actor.consultantId ?? NIL_UUID);
      case 'client':
        return eq(clients.id, actor.clientId ?? NIL_UUID);
      default:
        return sql`false`;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Read                                                              */
  /* ---------------------------------------------------------------- */

  async list(actor: AuthUser, query: ListClientsQuery): Promise<Paginated<ClientListItem>> {
    const conditions: (SQL | undefined)[] = [this.scope(actor)];

    if (!query.includeArchived) conditions.push(eq(clients.archived, false));

    if (query.q) {
      const term = `%${query.q}%`;
      conditions.push(
        or(
          ilike(clients.fullName, term),
          ilike(clients.email, term),
          ilike(clients.phone, term),
        ),
      );
    }

    // Whoever sees everyone may narrow to one consultant; others are already narrowed.
    if (query.consultantId && seesAll(actor)) {
      conditions.push(eq(clients.assignedConsultantId, query.consultantId));
    }

    // Date range on when the client was added. `createdTo` is treated as the
    // end of that day so a single-day pick includes everything on it.
    if (query.createdFrom) conditions.push(gte(clients.createdAt, query.createdFrom));
    if (query.createdTo) {
      const end = new Date(query.createdTo);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(clients.createdAt, end));
    }

    if (query.programme) conditions.push(eq(clients.programme, query.programme));

    if (query.stage) {
      conditions.push(
        sql`exists (
          select 1 from cases c
          where c.client_id = ${clients.id} and c.current_stage = ${query.stage}
        )`,
      );
    }

    const where = and(...conditions.filter(Boolean));

    const countQuery = this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(clients)
      .where(where);

    const [[totalRow], rows] = await Promise.all([countQuery, this.db
      .select({
        id: clients.id,
        fullName: clients.fullName,
        email: clients.email,
        phone: clients.phone,
        city: clients.city,
        archived: clients.archived,
        userId: clients.userId,
        programme: clients.programme,
        portalActive: portalActiveSql,
        createdAt: clients.createdAt,
        consultantId: consultants.id,
        consultantName: users.fullName,
        pendingReviews: pendingReviewsSql,
        caseCount: caseCountSql,
        lastActivityAt: lastActivitySql,
        primaryCaseId: primaryCaseIdSql,
      })
      .from(clients)
      .leftJoin(consultants, eq(consultants.id, clients.assignedConsultantId))
      .leftJoin(users, eq(users.id, consultants.userId))
      .where(where)
      .orderBy(...this.orderBy(query.sort))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize)]);
    const total = totalRow?.n ?? 0;

    const primaryCases = await this.loadCases(
      rows.map((r) => r.primaryCaseId).filter((v): v is string => Boolean(v)),
    );

    const items: ClientListItem[] = rows.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      email: r.email,
      phone: r.phone,
      city: r.city,
      archived: r.archived,
      programme: r.programme as ClientProgramme,
      hasLogin: Boolean(r.userId) && Boolean(r.portalActive),
      createdAt: toIso(r.createdAt),
      consultant: r.consultantId ? { id: r.consultantId, name: r.consultantName ?? '' } : null,
      primaryCase: r.primaryCaseId ? (primaryCases.get(r.primaryCaseId) ?? null) : null,
      caseCount: r.caseCount ?? 0,
      pendingReviews: r.pendingReviews ?? 0,
      daysSinceActivity: daysSince(r.lastActivityAt),
    }));

    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async findOne(actor: AuthUser, clientId: string) {
    const [row] = await this.db
      .select({
        client: clients,
        consultantId: consultants.id,
        consultantName: users.fullName,
        consultantEmail: users.email,
        portalActive: portalActiveSql,
        portalMfa: portalMfaSql,
      })
      .from(clients)
      .leftJoin(consultants, eq(consultants.id, clients.assignedConsultantId))
      .leftJoin(users, eq(users.id, consultants.userId))
      .where(and(eq(clients.id, clientId), this.scope(actor)))
      .limit(1);

    if (!row) throw new NotFoundException('Client not found.');

    const caseRows = await this.db
      .select()
      .from(cases)
      .where(eq(cases.clientId, clientId))
      .orderBy(desc(cases.lastActivityAt));

    const c = row.client;
    return {
      id: c.id,
      fullName: c.fullName,
      email: c.email,
      phone: c.phone,
      city: c.city,
      // Internal notes are staff-only; the client reading their own record never gets them.
      notes: actor.role === 'client' ? null : c.notes,
      archived: c.archived,
      userId: c.userId,
      programme: c.programme as ClientProgramme,
      hasLogin: Boolean(c.userId) && Boolean(row.portalActive),
      loginHasTwoStep: Boolean(c.userId) && Boolean(row.portalMfa),
      createdAt: toIso(c.createdAt),
      updatedAt: toIso(c.updatedAt),
      profile: profileOf(c),
      consultant: row.consultantId
        ? { id: row.consultantId, name: row.consultantName ?? '', email: row.consultantEmail ?? '' }
        : null,
      cases: caseRows.map(mapCase),
    };
  }

  /* ---------------------------------------------------------------- */
  /* Write                                                             */
  /* ---------------------------------------------------------------- */

  async create(actor: AuthUser, input: CreateClientInput) {
    if (actor.role === 'client') throw new ForbiddenException('Clients cannot add clients.');

    // A consultant creates clients for themselves; handing a new client to
    // someone else takes the reassign permission (managers always have it).
    const canAssign = staffCan(actor, 'client.assign');
    const assignedConsultantId = canAssign
      ? (input.assignedConsultantId ?? (actor.role === 'consultant' ? actor.consultantId : null))
      : actor.consultantId;

    if (canAssign && input.assignedConsultantId) {
      await this.assertConsultantExists(actor, input.assignedConsultantId);
    }

    // Unique within this consultancy only: the same student may well be on
    // another consultancy's books, and that is none of this one's business.
    const tenantId = tenantOf(actor);
    await this.entitlements.assertCanAddClient(tenantId);
    const existing = await this.db
      .select({ id: clients.id })
      .from(clients)
      .where(
        and(
          eq(clients.tenantId, tenantId),
          eq(sql`lower(${clients.email})`, input.email.toLowerCase()),
        ),
      )
      .limit(1);
    if (existing.length) {
      throw new BadRequestException({
        message: 'A client with this email already exists.',
        fieldErrors: { email: 'This email is already on another client record.' },
      });
    }

    const [created] = await this.db
      .insert(clients)
      .values({
        tenantId,
        fullName: input.fullName,
        email: input.email,
        phone: input.phone,
        city: input.city ?? null,
        assignedConsultantId,
        notes: input.notes ?? null,
        // Opening an application makes them a study-abroad client whatever was picked.
        programme: input.firstApplication ? 'study_abroad' : (input.programme ?? 'study_abroad'),
        createdBy: actor.id,
        ...profilePatch(input),
      })
      .returning();

    if (!created) throw new Error('Client insert returned no row');

    await this.audit.record(actor, {
      action: 'client.created',
      entityType: 'client',
      entityId: created.id,
      clientId: created.id,
      metadata: { fullName: created.fullName, assignedConsultantId },
    });

    if (input.firstApplication) {
      await this.casesService.createForClient(actor, {
        clientId: created.id,
        consultantId: assignedConsultantId,
        targetCountry: input.firstApplication.targetCountry,
        targetUniversity: input.firstApplication.targetUniversity ?? null,
        targetProgram: input.firstApplication.targetProgram ?? null,
        intake: input.firstApplication.intake ?? null,
      });
    }

    return this.findOne(actor, created.id);
  }

  async update(actor: AuthUser, clientId: string, input: UpdateClientInput) {
    if (actor.role === 'client') throw new ForbiddenException('You cannot edit your own record.');

    const [current] = await this.db
      .select()
      .from(clients)
      .where(and(eq(clients.id, clientId), this.scope(actor)))
      .limit(1);
    if (!current) throw new NotFoundException('Client not found.');

    // Reassignment is a manager-only override; a consultant cannot move a
    // client to (or away from) themselves.
    if (
      input.assignedConsultantId !== undefined &&
      input.assignedConsultantId !== current.assignedConsultantId
    ) {
      if (!staffCan(actor, 'client.assign')) throw permissionDenied('client.assign');
      if (input.assignedConsultantId) {
        await this.assertConsultantExists(actor, input.assignedConsultantId);
      }
    }

    // Bringing a client back from the archive counts against the plan again.
    if (input.archived === false && current.archived) {
      await this.entitlements.assertCanAddClient(current.tenantId);
    }

    const patch: Partial<typeof clients.$inferInsert> = {
      updatedAt: new Date(),
      ...profilePatch(input),
    };
    if (input.fullName !== undefined) patch.fullName = input.fullName;
    if (input.email !== undefined) patch.email = input.email;
    if (input.phone !== undefined) patch.phone = input.phone;
    if (input.city !== undefined) patch.city = input.city;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.archived !== undefined) patch.archived = input.archived;
    if (input.programme !== undefined) patch.programme = input.programme;
    if (input.assignedConsultantId !== undefined && staffCan(actor, 'client.assign')) {
      patch.assignedConsultantId = input.assignedConsultantId;
    }

    await this.db
      .update(clients)
      .set(patch)
      .where(and(eq(clients.id, clientId), eq(clients.tenantId, current.tenantId)));

    const reassigned =
      input.assignedConsultantId !== undefined &&
      input.assignedConsultantId !== current.assignedConsultantId;

    if (reassigned) {
      // Keep open cases with the client's new consultant.
      await this.db
        .update(cases)
        .set({ consultantId: input.assignedConsultantId ?? null, updatedAt: new Date() })
        .where(and(eq(cases.clientId, clientId), eq(cases.tenantId, current.tenantId)));
    }

    // The consultant picking up the client needs to know; nobody else does.
    if (reassigned && input.assignedConsultantId) {
      const [row] = await this.db
        .select({ userId: consultants.userId })
        .from(consultants)
        .where(eq(consultants.id, input.assignedConsultantId))
        .limit(1);

      await this.notifications.push(
        row?.userId
          ? {
              userId: row.userId,
              type: 'client_assigned',
              title: `${current.fullName} has been assigned to you`,
              body: 'Their case and documents are now on your desk.',
              link: `/desk/clients/${clientId}`,
            }
          : null,
      );
    }

    await this.audit.record(actor, {
      action: reassigned ? 'client.reassigned' : 'client.updated',
      entityType: 'client',
      entityId: clientId,
      clientId,
      metadata: {
        changed: Object.keys(patch).filter((k) => k !== 'updatedAt'),
        ...(reassigned
          ? { from: current.assignedConsultantId, to: input.assignedConsultantId }
          : {}),
      },
    });

    return this.findOne(actor, clientId);
  }

  async archive(actor: AuthUser, clientId: string) {
    return this.update(actor, clientId, { archived: true });
  }

  /* ---------------------------------------------------------------- */
  /* Portal access                                                     */
  /* ---------------------------------------------------------------- */

  /**
   * Gives a client their portal login, or sets a new password on an existing
   * one. The login uses the email on their client record, inside this
   * consultancy only - the same person on another consultancy's books is a
   * different account there.
   */
  async grantPortalAccess(actor: AuthUser, clientId: string, password: string) {
    const { hadLogin } = await this.ensureLogin(actor, clientId, await hashPassword(password));
    await this.audit.record(actor, {
      action: 'client.portal_access_granted',
      entityType: 'client',
      entityId: clientId,
      clientId,
      metadata: { passwordReset: hadLogin },
    });
    return this.findOne(actor, clientId);
  }

  /**
   * Gives the client their login without anyone on staff knowing the
   * password: they get an email with a link to choose one, and staff get the
   * same link to send by WhatsApp or SMS if the email does not arrive.
   */
  async invitePortal(actor: AuthUser, clientId: string): Promise<PasswordLinkResult> {
    const { userId, hadLogin } = await this.ensureLogin(actor, clientId, null);
    if (!hadLogin) {
      await this.audit.record(actor, {
        action: 'client.portal_access_granted',
        entityType: 'client',
        entityId: clientId,
        clientId,
        metadata: { invited: true },
      });
    }
    const [client] = await this.db.select({ fullName: clients.fullName, lastSignInAt: users.lastSignInAt }).from(clients).innerJoin(users, eq(users.id, clients.userId)).where(eq(clients.id, clientId)).limit(1);
    return this.links.sendLink(actor, userId, client?.lastSignInAt ? 'reset' : 'invite', client?.fullName);
  }

  /**
   * The client's login, made if they have none and switched on if it was off.
   * With a hash, the password is set (and their other sessions end); without
   * one, an existing password is left alone and a new login has none until
   * they choose it from a link.
   */
  private async ensureLogin(
    actor: AuthUser,
    clientId: string,
    passwordHash: string | null,
  ): Promise<{ userId: string; hadLogin: boolean }> {
    if (actor.role === 'client') throw new ForbiddenException('Only staff can do this.');
    const [current] = await this.db
      .select()
      .from(clients)
      .where(and(eq(clients.id, clientId), this.scope(actor)))
      .limit(1);
    if (!current) throw new NotFoundException('Client not found.');

    if (current.userId) {
      await this.db
        .update(users)
        .set({
          ...(passwordHash ? { passwordHash, sessionsValidAfter: sessionsCutoff() } : {}),
          isActive: true,
          email: current.email,
          updatedAt: new Date(),
        })
        .where(and(eq(users.id, current.userId), eq(users.tenantId, current.tenantId)));
      return { userId: current.userId, hadLogin: true };
    } else {
      // Someone on staff may already sign in with this email here.
      const [clash] = await this.db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.tenantId, current.tenantId),
            eq(sql`lower(${users.email})`, current.email.toLowerCase()),
          ),
        )
        .limit(1);
      if (clash) {
        throw new ConflictException(
          'Another account in this consultancy already uses that email. Change the client’s email first.',
        );
      }

      const userId = await this.db.transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({
            tenantId: current.tenantId,
            email: current.email,
            passwordHash,
            fullName: current.fullName,
            role: 'client',
            phone: current.phone,
          })
          .returning({ id: users.id });
        await tx
          .update(clients)
          .set({ userId: user!.id, updatedAt: new Date() })
          .where(eq(clients.id, clientId));
        return user!.id;
      });
      return { userId, hadLogin: false };
    }
  }

  /** Switches the client's login off. The account and everything they uploaded stay. */
  async revokePortalAccess(actor: AuthUser, clientId: string) {
    if (actor.role === 'client') throw new ForbiddenException('Only staff can do this.');
    const [current] = await this.db
      .select({ userId: clients.userId, tenantId: clients.tenantId })
      .from(clients)
      .where(and(eq(clients.id, clientId), this.scope(actor)))
      .limit(1);
    if (!current) throw new NotFoundException('Client not found.');
    if (current.userId) {
      await this.db
        .update(users)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(users.id, current.userId), eq(users.tenantId, current.tenantId)));
      await this.audit.record(actor, {
        action: 'client.portal_access_revoked',
        entityType: 'client',
        entityId: clientId,
        clientId,
      });
    }
    return this.findOne(actor, clientId);
  }

  /* ---------------------------------------------------------------- */
  /* Helpers                                                           */
  /* ---------------------------------------------------------------- */

  private orderBy(sort: ListClientsQuery['sort']) {
    switch (sort) {
      case 'name':
        return [asc(sql`lower(${clients.fullName})`)];
      case 'stage':
        return [desc(stageOrdinalSql), desc(clients.createdAt)];
      case 'stalest':
        // Nulls last: a client with no case yet is not "stale", just new.
        // Written out rather than asc(): asc() appends its keyword after
        // "nulls last", which is not valid SQL.
        return [sql`${lastActivitySql} asc nulls last`];
      case 'recent':
      default:
        return [desc(clients.createdAt)];
    }
  }

  private async loadCases(ids: string[]): Promise<Map<string, ClientCaseSummary>> {
    if (!ids.length) return new Map();
    const rows = await this.db
      .select()
      .from(cases)
      .where(inArray(cases.id, ids));
    return new Map(rows.map((r) => [r.id, mapCase(r)]));
  }

  /**
   * The consultant must exist *in this consultancy*. Without the tenant
   * condition, a manager could hand a client to another consultancy's
   * consultant just by knowing their id.
   */
  private async assertConsultantExists(actor: AuthUser, consultantId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: consultants.id, takesClients: staffRoles.takesClients })
      .from(consultants)
      .innerJoin(users, eq(users.id, consultants.userId))
      .leftJoin(staffRoles, eq(staffRoles.id, users.staffRoleId))
      .where(and(eq(consultants.id, consultantId), eq(consultants.tenantId, tenantOf(actor))))
      .limit(1);
    if (!row) {
      throw new BadRequestException({
        message: 'That consultant no longer exists.',
        fieldErrors: { assignedConsultantId: 'Pick a consultant from the list.' },
      });
    }
    // An accountant or a trainer has no caseload to give a student to.
    if (row.takesClients === false) {
      throw new BadRequestException({
        message: 'That person’s role does not take clients.',
        fieldErrors: { assignedConsultantId: 'Pick someone who works with students.' },
      });
    }
  }
}

/** Matches nothing - used so a null scope id can never widen a query. */
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/** Whether the client's own login has two-step verification on - for staff resetting it. */
const portalMfaSql = sql<boolean>`exists (
  select 1 from users mu where mu.id = ${clients.userId} and mu.mfa_enabled_at is not null
)`;

/** A client "has portal access" only while their login is switched on. */
const portalActiveSql = sql<boolean>`exists (
  select 1 from users pu where pu.id = ${clients.userId} and pu.is_active
)`;

const PROFILE_KEYS = [
  'dateOfBirth',
  'nationality',
  'passportNumber',
  'passportExpiry',
  'highestQualification',
  'lastInstitution',
  'lastGrade',
  'graduationYear',
  'englishTest',
  'englishScore',
  'englishTestDate',
  'intendedLevel',
  'intendedField',
  'preferredCountries',
  'budget',
  'leadSource',
  'emergencyContactName',
  'emergencyContactPhone',
] as const satisfies readonly (keyof ClientProfileInput)[];

/** Only the profile fields the caller actually sent; undefined means "leave it". */
function profilePatch(input: ClientProfileInput): Partial<typeof clients.$inferInsert> {
  const patch: Record<string, unknown> = {};
  for (const key of PROFILE_KEYS) {
    const value = input[key];
    if (value === undefined) continue;
    patch[key] = key === 'preferredCountries' ? (value ?? []) : value;
  }
  return patch as Partial<typeof clients.$inferInsert>;
}

function profileOf(c: typeof clients.$inferSelect): ClientProfile {
  return {
    dateOfBirth: c.dateOfBirth,
    nationality: c.nationality,
    passportNumber: c.passportNumber,
    passportExpiry: c.passportExpiry,
    highestQualification: c.highestQualification as Qualification | null,
    lastInstitution: c.lastInstitution,
    lastGrade: c.lastGrade,
    graduationYear: c.graduationYear,
    englishTest: c.englishTest as EnglishTest | null,
    englishScore: c.englishScore,
    englishTestDate: c.englishTestDate,
    intendedLevel: c.intendedLevel as StudyLevel | null,
    intendedField: c.intendedField,
    preferredCountries: Array.isArray(c.preferredCountries) ? c.preferredCountries : [],
    budget: c.budget,
    leadSource: c.leadSource as LeadSource | null,
    emergencyContactName: c.emergencyContactName,
    emergencyContactPhone: c.emergencyContactPhone,
  };
}

function mapCase(r: typeof cases.$inferSelect): ClientCaseSummary {
  return {
    id: r.id,
    reference: r.reference,
    targetCountry: r.targetCountry,
    targetUniversity: r.targetUniversity,
    targetProgram: r.targetProgram,
    intake: r.intake,
    currentStage: r.currentStage as Stage,
    currentStageKey: r.currentStageKey,
    stageName: r.currentStageName,
    stageSlaDays: r.stageSlaDays,
    status: r.status,
    stageEnteredAt: toIso(r.stageEnteredAt),
    lastActivityAt: toIso(r.lastActivityAt),
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function daysSince(value: string | Date | null): number | null {
  if (!value) return null;
  const then = value instanceof Date ? value : new Date(value);
  return Math.floor((Date.now() - then.getTime()) / 86_400_000);
}

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type {
  AuthUser,
  CreateTaskInput,
  ListTasksQuery,
  Paginated,
  TaskCounts,
  TaskPriority,
  TaskStatus,
  TaskView,
  UpdateTaskInput,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { cases, clients, tasks, tenants, users } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { seesAll } from '../auth/permissions';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/** Local-day boundaries on the server's clock - the office's day. */
function dayBounds(): { start: Date; end: Date } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

/**
 * Follow-ups and tasks.
 *
 * A consultant sees what is assigned to them plus anything on their own
 * clients (a colleague may leave them a note); a manager sees the whole
 * consultancy's list. Clients never see tasks - they are the office's
 * internal to-do list.
 */
@Injectable()
export class TasksService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Expects `clients` left-joined on tasks.client_id. */
  private scope(actor: AuthUser): SQL | undefined {
    const tenant = eq(tasks.tenantId, tenantOf(actor));
    switch (actor.role) {
      case 'manager':
        return tenant;
      case 'consultant':
        return and(
          tenant,
          or(
            eq(tasks.assigneeId, actor.id),
            eq(clients.assignedConsultantId, actor.consultantId ?? NIL_UUID),
          ),
        );
      default:
        return sql`false`;
    }
  }

  private assertStaff(actor: AuthUser): void {
    if (actor.role !== 'manager' && actor.role !== 'consultant') {
      throw new ForbiddenException('Tasks are for staff.');
    }
  }

  async list(actor: AuthUser, query: ListTasksQuery): Promise<Paginated<TaskView>> {
    this.assertStaff(actor);
    const now = new Date();
    const { start, end } = dayBounds();
    const conditions: (SQL | undefined)[] = [this.scope(actor)];

    if (query.assignee === 'me') conditions.push(eq(tasks.assigneeId, actor.id));
    else if (query.assignee && actor.role === 'manager' && /^[0-9a-f-]{36}$/i.test(query.assignee)) {
      conditions.push(eq(tasks.assigneeId, query.assignee));
    }
    if (query.clientId) conditions.push(eq(tasks.clientId, query.clientId));
    if (query.caseId) conditions.push(eq(tasks.caseId, query.caseId));
    if (query.escalated) conditions.push(eq(tasks.escalated, true));

    switch (query.view) {
      case 'open':
        conditions.push(eq(tasks.status, 'open'));
        break;
      case 'overdue':
        conditions.push(eq(tasks.status, 'open'), lt(tasks.dueAt, now));
        break;
      case 'today':
        conditions.push(eq(tasks.status, 'open'), gte(tasks.dueAt, start), lt(tasks.dueAt, end));
        break;
      case 'upcoming':
        conditions.push(eq(tasks.status, 'open'), or(gte(tasks.dueAt, end), isNull(tasks.dueAt)));
        break;
      case 'done':
        conditions.push(eq(tasks.status, 'done'));
        break;
    }
    const where = and(...conditions);

    const countQuery = this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(tasks)
      .leftJoin(clients, eq(clients.id, tasks.clientId))
      .where(where);

    const priorityRank = sql`case ${tasks.priority} when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`;
    const order =
      query.view === 'done'
        ? [desc(tasks.completedAt)]
        : [sql`${tasks.dueAt} asc nulls last`, asc(priorityRank), desc(tasks.createdAt)];

    const [[total], rows] = await Promise.all([
      countQuery,
      this.baseQuery()
        .where(where)
        .orderBy(...order)
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
    ]);

    const n = total?.n ?? 0;
    return {
      items: rows.map(toView),
      page: query.page,
      pageSize: query.pageSize,
      total: n,
      totalPages: Math.max(1, Math.ceil(n / query.pageSize)),
    };
  }

  /** The badge numbers: the actor's own for a consultant, everyone's for a manager. */
  async counts(actor: AuthUser, mine: boolean): Promise<TaskCounts> {
    this.assertStaff(actor);
    const now = new Date();
    const { start, end } = dayBounds();
    const [row] = await this.db
      .select({
        open: sql<number>`count(*) filter (where ${tasks.status} = 'open')::int`,
        overdue: sql<number>`count(*) filter (where ${tasks.status} = 'open' and ${tasks.dueAt} < ${now.toISOString()})::int`,
        today: sql<number>`count(*) filter (where ${tasks.status} = 'open' and ${tasks.dueAt} >= ${start.toISOString()} and ${tasks.dueAt} < ${end.toISOString()})::int`,
        escalated: sql<number>`count(*) filter (where ${tasks.status} = 'open' and ${tasks.escalated})::int`,
      })
      .from(tasks)
      .leftJoin(clients, eq(clients.id, tasks.clientId))
      .where(and(this.scope(actor), mine ? eq(tasks.assigneeId, actor.id) : undefined));
    return {
      open: row?.open ?? 0,
      overdue: row?.overdue ?? 0,
      today: row?.today ?? 0,
      escalated: row?.escalated ?? 0,
    };
  }

  /** Staff who can be given a task, for the picker. */
  async assignees(actor: AuthUser) {
    this.assertStaff(actor);
    return this.db
      .select({ id: users.id, name: users.fullName, role: users.role })
      .from(users)
      .where(
        and(
          eq(users.tenantId, tenantOf(actor)),
          inArray(users.role, ['manager', 'consultant']),
          eq(users.isActive, true),
        ),
      )
      .orderBy(asc(users.fullName));
  }

  async get(actor: AuthUser, id: string): Promise<TaskView> {
    this.assertStaff(actor);
    const [row] = await this.baseQuery()
      .where(and(eq(tasks.id, id), this.scope(actor)))
      .limit(1);
    if (!row) throw new NotFoundException('Task not found.');
    return toView(row);
  }

  async create(actor: AuthUser, input: CreateTaskInput): Promise<TaskView> {
    this.assertStaff(actor);
    const tenantId = tenantOf(actor);
    const link = await this.resolveLink(actor, input.clientId, input.caseId);
    const assigneeId = input.assigneeId ?? actor.id;
    await this.assertAssignable(tenantId, assigneeId);

    const [row] = await this.db
      .insert(tasks)
      .values({
        tenantId,
        title: input.title,
        notes: input.notes ?? null,
        clientId: link.clientId,
        caseId: link.caseId,
        assigneeId,
        createdBy: actor.id,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        priority: input.priority,
      })
      .returning({ id: tasks.id });

    await this.audit.record(actor, {
      action: 'task.created',
      entityType: 'task',
      entityId: row!.id,
      clientId: link.clientId,
      caseId: link.caseId,
      metadata: { title: input.title, assigneeId, dueAt: input.dueAt ?? null },
    });

    if (assigneeId !== actor.id) await this.notifyAssigned(actor, assigneeId, input.title);
    return this.get(actor, row!.id);
  }

  async update(actor: AuthUser, id: string, input: UpdateTaskInput): Promise<TaskView> {
    const current = await this.get(actor, id);
    const tenantId = tenantOf(actor);

    const patch: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date() };
    if (input.title !== undefined) patch.title = input.title;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.escalated !== undefined) patch.escalated = input.escalated;
    if (input.dueAt !== undefined) {
      patch.dueAt = input.dueAt ? new Date(input.dueAt) : null;
      // A new due date is a new chance to be late; the overdue alert re-arms.
      patch.overdueNotifiedAt = null;
    }
    if (input.assigneeId !== undefined && input.assigneeId !== current.assigneeId) {
      await this.assertAssignable(tenantId, input.assigneeId);
      patch.assigneeId = input.assigneeId;
    }
    if (input.status !== undefined && input.status !== current.status) {
      patch.status = input.status;
      patch.completedAt = input.status === 'done' ? new Date() : null;
      patch.completedBy = input.status === 'done' ? actor.id : null;
    }

    await this.db.update(tasks).set(patch).where(and(eq(tasks.id, id), eq(tasks.tenantId, tenantId)));

    const completed = input.status === 'done' && current.status !== 'done';
    await this.audit.record(actor, {
      action: completed ? 'task.completed' : 'task.updated',
      entityType: 'task',
      entityId: id,
      clientId: current.clientId,
      caseId: current.caseId,
      metadata: { title: current.title, changed: Object.keys(patch).filter((k) => k !== 'updatedAt') },
    });

    if (patch.assigneeId && patch.assigneeId !== actor.id) {
      await this.notifyAssigned(actor, patch.assigneeId, current.title);
    }
    if (input.escalated && !current.escalated) await this.notifyEscalated(actor, current);

    return this.get(actor, id);
  }

  /** The person who wrote it, or a manager. Finished tasks are kept as history instead. */
  async remove(actor: AuthUser, id: string): Promise<void> {
    const current = await this.get(actor, id);
    const [row] = await this.db
      .select({ createdBy: tasks.createdBy })
      .from(tasks)
      .where(eq(tasks.id, id));
    if (actor.role !== 'manager' && row?.createdBy !== actor.id) {
      throw new ForbiddenException('Only whoever created this task, or a manager, can delete it.');
    }
    await this.db.delete(tasks).where(and(eq(tasks.id, id), eq(tasks.tenantId, tenantOf(actor))));
    await this.audit.record(actor, {
      action: 'task.updated',
      entityType: 'task',
      entityId: id,
      clientId: current.clientId,
      caseId: current.caseId,
      metadata: { title: current.title, deleted: true },
    });
  }

  /**
   * One alert per due date: every open task past its due time whose assignee
   * has not been told yet. Claimed with a conditional UPDATE, so two instances
   * running this at once cannot both send it.
   */
  async overdueSweep(): Promise<number> {
    const due = await this.db
      .select({ id: tasks.id })
      .from(tasks)
      .innerJoin(tenants, eq(tenants.id, tasks.tenantId))
      .where(
        and(
          eq(tenants.status, 'active'),
          eq(tasks.status, 'open'),
          isNotNull(tasks.dueAt),
          lt(tasks.dueAt, new Date()),
          isNull(tasks.overdueNotifiedAt),
        ),
      )
      .limit(500);
    if (due.length === 0) return 0;

    const claimed = await this.db
      .update(tasks)
      .set({ overdueNotifiedAt: new Date() })
      .where(and(inArray(tasks.id, due.map((d) => d.id)), isNull(tasks.overdueNotifiedAt)))
      .returning({ id: tasks.id, assigneeId: tasks.assigneeId, title: tasks.title, caseId: tasks.caseId });

    for (const t of claimed) {
      const [who] = await this.db.select({ role: users.role }).from(users).where(eq(users.id, t.assigneeId));
      await this.notifications.push({
        userId: t.assigneeId,
        type: 'task_overdue',
        title: `Overdue: ${t.title}`,
        body: 'This follow-up has passed its due time.',
        link: who?.role === 'manager' ? '/overview/tasks' : '/desk/tasks',
        caseId: t.caseId,
      });
    }
    return claimed.length;
  }

  /* ---------------------------------------------------------------- */

  private baseQuery() {
    const assignee = alias(users, 'assignee');
    const creator = alias(users, 'creator');
    return this.db
      .select({
        t: tasks,
        assigneeName: assignee.fullName,
        createdByName: creator.fullName,
        clientName: clients.fullName,
        caseReference: cases.reference,
      })
      .from(tasks)
      .innerJoin(assignee, eq(assignee.id, tasks.assigneeId))
      .leftJoin(creator, eq(creator.id, tasks.createdBy))
      .leftJoin(clients, eq(clients.id, tasks.clientId))
      .leftJoin(cases, eq(cases.id, tasks.caseId))
      .$dynamic();
  }

  /**
   * A task may point at a client or one of their cases - only ones the actor
   * can already see. Given a case, the client is taken from it.
   */
  private async resolveLink(
    actor: AuthUser,
    clientId?: string,
    caseId?: string,
  ): Promise<{ clientId: string | null; caseId: string | null }> {
    const tenantId = tenantOf(actor);
    const mineOnly =
      actor.role === 'consultant' && !seesAll(actor)
        ? eq(clients.assignedConsultantId, actor.consultantId ?? NIL_UUID)
        : undefined;

    if (caseId) {
      const [row] = await this.db
        .select({ caseId: cases.id, clientId: cases.clientId })
        .from(cases)
        .innerJoin(clients, eq(clients.id, cases.clientId))
        .where(and(eq(cases.id, caseId), eq(cases.tenantId, tenantId), mineOnly))
        .limit(1);
      if (!row) throw new NotFoundException('Case not found.');
      if (clientId && clientId !== row.clientId) {
        throw new BadRequestException('That case belongs to a different client.');
      }
      return row;
    }
    if (clientId) {
      const [row] = await this.db
        .select({ clientId: clients.id })
        .from(clients)
        .where(and(eq(clients.id, clientId), eq(clients.tenantId, tenantId), mineOnly))
        .limit(1);
      if (!row) throw new NotFoundException('Client not found.');
      return { clientId: row.clientId, caseId: null };
    }
    return { clientId: null, caseId: null };
  }

  private async assertAssignable(tenantId: string, userId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, userId),
          eq(users.tenantId, tenantId),
          inArray(users.role, ['manager', 'consultant']),
          eq(users.isActive, true),
        ),
      )
      .limit(1);
    if (!row) {
      throw new BadRequestException({
        message: 'Tasks can only be given to active staff in your consultancy.',
        fieldErrors: { assigneeId: 'Pick someone from the list.' },
      });
    }
  }

  private async notifyAssigned(actor: AuthUser, userId: string, title: string) {
    const [who] = await this.db.select({ role: users.role }).from(users).where(eq(users.id, userId));
    await this.notifications.push({
      userId,
      type: 'task_assigned',
      title: `${actor.fullName} gave you a task`,
      body: title,
      link: who?.role === 'manager' ? '/overview/tasks' : '/desk/tasks',
    });
  }

  /** Escalating puts it in front of every manager. */
  private async notifyEscalated(actor: AuthUser, task: TaskView) {
    const managers = await this.db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.tenantId, tenantOf(actor)),
          eq(users.role, 'manager'),
          eq(users.isActive, true),
        ),
      );
    for (const m of managers) {
      if (m.id === actor.id) continue;
      await this.notifications.push({
        userId: m.id,
        type: 'task_assigned',
        title: `Escalated by ${actor.fullName}: ${task.title}`,
        body: task.clientName ? `For ${task.clientName}.` : null,
        link: '/overview/tasks?view=open&escalated=true',
        caseId: task.caseId,
      });
    }
  }
}

interface Row {
  t: typeof tasks.$inferSelect;
  assigneeName: string;
  createdByName: string | null;
  clientName: string | null;
  caseReference: string | null;
}

function toView(r: Row): TaskView {
  const t = r.t;
  const dueAt = t.dueAt ? new Date(t.dueAt) : null;
  return {
    id: t.id,
    title: t.title,
    notes: t.notes,
    priority: t.priority as TaskPriority,
    status: t.status as TaskStatus,
    dueAt: dueAt ? dueAt.toISOString() : null,
    overdue: t.status === 'open' && dueAt !== null && dueAt.getTime() < Date.now(),
    escalated: t.escalated,
    assigneeId: t.assigneeId,
    assigneeName: r.assigneeName,
    createdByName: r.createdByName,
    clientId: t.clientId,
    clientName: r.clientName,
    caseId: t.caseId,
    caseReference: r.caseReference,
    completedAt: t.completedAt ? new Date(t.completedAt).toISOString() : null,
    createdAt: new Date(t.createdAt).toISOString(),
  };
}

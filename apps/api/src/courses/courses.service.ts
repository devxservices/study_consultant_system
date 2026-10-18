import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  attendancePercent,
  batchSchema,
  courseSchema,
  courseSettingsSchema,
  sessionDates,
  sessionUpdateSchema,
  type AuthUser,
  type BatchInput,
  type BatchStatus,
  type BatchSummaryView,
  type BatchView,
  type CourseInput,
  type CourseLevel,
  type CourseMode,
  type CourseReportRow,
  type CourseSettingsInput,
  type CourseSettingsView,
  type CourseView,
  type Currency,
  type SessionView,
  type TestType,
} from '@crm/shared';
import { z } from 'zod';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import {
  assessmentScores,
  assessments,
  attendance,
  batchTrainers,
  batches,
  classSessions,
  courseSettings,
  courses,
  enrollments,
  invoiceItems,
  invoices,
  servicePackages,
  testResults,
  users,
} from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { staffCan } from '../auth/permissions';
import { iso, isUniqueViolation, today } from '../common/db-helpers';
import { qualified } from '../documents/drive-sql';

type BatchRow = typeof batches.$inferSelect;

/**
 * The course catalogue and its batches. Everyone on staff with "See courses"
 * reads them; "Manage courses" builds them and assigns trainers; a trainer
 * ("Teach batches") works only the batches they are assigned to.
 */
@Injectable()
export class CoursesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  assertView(actor: AuthUser): void {
    if (!staffCan(actor, 'course.view') && !staffCan(actor, 'course.teach')) throw new ForbiddenException('You do not have permission to see courses.');
  }

  assertManage(actor: AuthUser): void {
    if (!staffCan(actor, 'course.manage')) throw new ForbiddenException('You do not have permission to manage courses.');
  }

  /** Managers of courses work every batch; a trainer only the ones they teach. */
  async assertTeaches(actor: AuthUser, batchId: string): Promise<BatchRow> {
    const b = await this.findBatch(tenantOf(actor), batchId);
    if (staffCan(actor, 'course.manage')) return b;
    if (!staffCan(actor, 'course.teach')) throw new ForbiddenException('You do not teach this batch.');
    const [t] = await this.db.select({ id: batchTrainers.id }).from(batchTrainers).where(and(eq(batchTrainers.batchId, batchId), eq(batchTrainers.userId, actor.id))).limit(1);
    if (!t) throw new ForbiddenException('You do not teach this batch.');
    return b;
  }

  /* ---------------------------------------------------------------- */
  /* The catalogue                                                     */
  /* ---------------------------------------------------------------- */

  async list(actor: AuthUser, includeInactive = false): Promise<CourseView[]> {
    this.assertView(actor);
    const tenantId = tenantOf(actor);
    const rows = await this.db
      .select({ c: courses, packageName: servicePackages.name })
      .from(courses)
      .leftJoin(servicePackages, eq(servicePackages.id, courses.packageId))
      .where(and(eq(courses.tenantId, tenantId), includeInactive ? undefined : eq(courses.active, true)))
      .orderBy(asc(courses.name));
    if (!rows.length) return [];
    const ids = rows.map((r) => r.c.id);
    const [batchCounts, students] = await Promise.all([
      this.db
        .select({
          id: batches.courseId,
          total: sql<number>`count(*)::int`,
          running: sql<number>`count(*) filter (where ${batches.status} = 'running')::int`,
          upcoming: sql<number>`count(*) filter (where ${batches.status} in ('planned', 'enrolling'))::int`,
        })
        .from(batches)
        .where(inArray(batches.courseId, ids))
        .groupBy(batches.courseId),
      this.db
        .select({ id: batches.courseId, n: sql<number>`count(distinct ${enrollments.clientId})::int` })
        .from(enrollments)
        .innerJoin(batches, eq(batches.id, enrollments.batchId))
        .where(and(inArray(batches.courseId, ids), inArray(enrollments.status, ['enrolled', 'frozen', 'completed'])))
        .groupBy(batches.courseId),
    ]);
    return rows.map(({ c, packageName }) => {
      const b = batchCounts.find((x) => x.id === c.id);
      return {
        id: c.id,
        name: c.name,
        code: c.code,
        testType: c.testType as TestType,
        level: c.level as CourseLevel,
        mode: c.mode as CourseMode,
        description: c.description,
        durationWeeks: c.durationWeeks,
        hoursPerWeek: c.hoursPerWeek / 100,
        fee: c.fee,
        currency: c.currency as Currency,
        packageId: c.packageId,
        packageName,
        capacity: c.capacity,
        active: c.active,
        batches: { total: b?.total ?? 0, running: b?.running ?? 0, upcoming: b?.upcoming ?? 0 },
        students: students.find((x) => x.id === c.id)?.n ?? 0,
        createdAt: iso(c.createdAt),
      };
    });
  }

  async get(actor: AuthUser, id: string): Promise<CourseView> {
    const all = await this.list(actor, true);
    const c = all.find((x) => x.id === id);
    if (!c) throw new NotFoundException('Course not found.');
    return c;
  }

  async save(actor: AuthUser, raw: CourseInput, id?: string): Promise<CourseView> {
    this.assertManage(actor);
    const input = courseSchema.parse(raw);
    const tenantId = tenantOf(actor);
    if (input.packageId) {
      const [p] = await this.db.select({ category: servicePackages.category }).from(servicePackages).where(and(eq(servicePackages.id, input.packageId), eq(servicePackages.tenantId, tenantId))).limit(1);
      if (!p) throw new BadRequestException({ message: 'Choose one of your fee packages.', fieldErrors: { packageId: 'Not found' } });
      if (p.category !== 'course') throw new BadRequestException({ message: 'Course fees are billed by a package of the "course" kind, so they are booked as course income.', fieldErrors: { packageId: 'Not a course package' } });
    }
    const values = { ...input, packageId: input.packageId ?? null, hoursPerWeek: Math.round(input.hoursPerWeek * 100), fee: Math.round(input.fee * 100) };
    let saved;
    try {
      if (id) {
        await this.findCourse(tenantId, id);
        [saved] = await this.db.update(courses).set({ ...values, updatedAt: new Date() }).where(eq(courses.id, id)).returning();
      } else {
        [saved] = await this.db.insert(courses).values({ tenantId, ...values, createdBy: actor.id }).returning();
      }
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException({ message: 'Another course has that code.', fieldErrors: { code: 'Already used' } });
      throw err;
    }
    await this.audit.record(actor, { action: 'course.saved', entityType: 'course', entityId: saved!.id, metadata: { name: input.name, code: input.code, created: !id } });
    return this.get(actor, saved!.id);
  }

  async findCourse(tenantId: string, id: string) {
    const [c] = await this.db.select().from(courses).where(and(eq(courses.id, id), eq(courses.tenantId, tenantId))).limit(1);
    if (!c) throw new NotFoundException('Course not found.');
    return c;
  }

  /* ---------------------------------------------------------------- */
  /* Batches                                                           */
  /* ---------------------------------------------------------------- */

  async batches(actor: AuthUser, q: { courseId?: string; status?: string; mine?: boolean }): Promise<BatchSummaryView[]> {
    this.assertView(actor);
    const tenantId = tenantOf(actor);
    const teachOnly = !staffCan(actor, 'course.view');
    const mineIds =
      q.mine || teachOnly ? (await this.db.select({ id: batchTrainers.batchId }).from(batchTrainers).where(eq(batchTrainers.userId, actor.id))).map((r) => r.id) : null;
    if (mineIds && !mineIds.length) return [];
    const rows = await this.db
      .select({ id: batches.id })
      .from(batches)
      .where(
        and(
          eq(batches.tenantId, tenantId),
          q.courseId ? eq(batches.courseId, q.courseId) : undefined,
          q.status && q.status !== 'all' ? (q.status === 'current' ? inArray(batches.status, ['planned', 'enrolling', 'running']) : eq(batches.status, q.status)) : undefined,
          mineIds ? inArray(batches.id, mineIds) : undefined,
        ),
      )
      .orderBy(desc(batches.startDate))
      .limit(300);
    return this.summaries(rows.map((r) => r.id));
  }

  async summaries(ids: string[]): Promise<BatchSummaryView[]> {
    if (!ids.length) return [];
    const [rows, trainers, seats, sessionCounts] = await Promise.all([
      this.db.select({ b: batches, c: courses }).from(batches).innerJoin(courses, eq(courses.id, batches.courseId)).where(inArray(batches.id, ids)),
      this.db.select({ batchId: batchTrainers.batchId, userId: users.id, name: users.fullName }).from(batchTrainers).innerJoin(users, eq(users.id, batchTrainers.userId)).where(inArray(batchTrainers.batchId, ids)),
      this.db
        .select({
          id: enrollments.batchId,
          enrolled: sql<number>`count(*) filter (where ${enrollments.status} in ('enrolled', 'frozen'))::int`,
          waitlisted: sql<number>`count(*) filter (where ${enrollments.status} = 'waitlisted')::int`,
        })
        .from(enrollments)
        .where(inArray(enrollments.batchId, ids))
        .groupBy(enrollments.batchId),
      this.db
        .select({
          id: classSessions.batchId,
          total: sql<number>`count(*) filter (where not ${classSessions.cancelled})::int`,
          held: sql<number>`count(*) filter (where not ${classSessions.cancelled} and ${classSessions.date} <= ${today()})::int`,
        })
        .from(classSessions)
        .where(inArray(classSessions.batchId, ids))
        .groupBy(classSessions.batchId),
    ]);
    const byId = new Map(rows.map((r) => [r.b.id, r]));
    return ids
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .map(({ b, c }) => {
        const s = seats.find((x) => x.id === b.id);
        const n = sessionCounts.find((x) => x.id === b.id);
        return {
          id: b.id,
          code: b.code,
          courseId: c.id,
          courseName: c.name,
          testType: c.testType as TestType,
          startDate: b.startDate,
          endDate: b.endDate,
          days: b.days,
          startTime: b.startTime,
          endTime: b.endTime,
          location: b.location,
          onlineLink: b.onlineLink,
          capacity: b.capacity,
          enrolled: s?.enrolled ?? 0,
          waitlisted: s?.waitlisted ?? 0,
          fee: b.fee ?? c.fee,
          currency: c.currency as Currency,
          status: b.status as BatchStatus,
          trainers: trainers.filter((t) => t.batchId === b.id).map((t) => ({ userId: t.userId, name: t.name })),
          sessionsHeld: n?.held ?? 0,
          sessionsTotal: n?.total ?? 0,
        };
      });
  }

  async batch(actor: AuthUser, id: string, roster: (batchId: string) => Promise<BatchView['roster']>): Promise<BatchView> {
    this.assertView(actor);
    const b = await this.findBatch(tenantOf(actor), id);
    if (!staffCan(actor, 'course.view')) await this.assertTeaches(actor, id);
    const [[summary], sessions, people] = await Promise.all([this.summaries([id]), this.sessions(id), roster(id)]);
    return { ...summary!, notes: b.notes, sessions, roster: people };
  }

  async sessions(batchId: string): Promise<SessionView[]> {
    const rows = await this.db
      .select({
        s: classSessions,
        marked: sql<number>`(select count(*)::int from attendance a where a.session_id = ${qualified('class_sessions', 'id')})`,
        present: sql<number>`(select count(*)::int from attendance a where a.session_id = ${qualified('class_sessions', 'id')} and a.status in ('present', 'late'))`,
      })
      .from(classSessions)
      .where(eq(classSessions.batchId, batchId))
      .orderBy(asc(classSessions.date), asc(classSessions.startTime));
    return rows.map(({ s, marked, present }) => ({ id: s.id, date: s.date, startTime: s.startTime, endTime: s.endTime, topic: s.topic, cancelled: s.cancelled, marked, present }));
  }

  async saveBatch(actor: AuthUser, raw: BatchInput, id?: string): Promise<BatchSummaryView> {
    this.assertManage(actor);
    const input = batchSchema.parse(raw);
    const tenantId = tenantOf(actor);
    const course = await this.findCourse(tenantId, input.courseId);
    if (input.trainerIds.length) {
      const ok = await this.db
        .select({ id: users.id })
        .from(users)
        .where(and(inArray(users.id, input.trainerIds), eq(users.tenantId, tenantId), inArray(users.role, ['manager', 'consultant']), eq(users.isActive, true)));
      if (ok.length !== new Set(input.trainerIds).size) throw new BadRequestException({ message: 'Trainers are people on your staff.', fieldErrors: { trainerIds: 'Not all on your staff' } });
    }
    const values = {
      courseId: input.courseId,
      code: input.code,
      startDate: input.startDate,
      endDate: input.endDate,
      days: [...new Set(input.days)].sort(),
      startTime: input.startTime,
      endTime: input.endTime,
      location: input.location,
      onlineLink: input.onlineLink,
      capacity: input.capacity,
      fee: input.fee === null || input.fee === undefined ? null : Math.round(input.fee * 100),
      status: input.status,
      notes: input.notes,
    };
    let saved: BatchRow;
    try {
      saved = await this.db.transaction(async (tx) => {
        let row: BatchRow;
        if (id) {
          const [before] = await tx.select().from(batches).where(and(eq(batches.id, id), eq(batches.tenantId, tenantId))).limit(1);
          if (!before) throw new NotFoundException('Batch not found.');
          [row] = (await tx.update(batches).set({ ...values, updatedAt: new Date() }).where(eq(batches.id, id)).returning()) as [BatchRow];
          // A changed timetable: future sessions follow it; anything already held stays as it was.
          const timetable = before.startDate !== row.startDate || before.endDate !== row.endDate || JSON.stringify(before.days) !== JSON.stringify(row.days) || before.startTime !== row.startTime || before.endTime !== row.endTime;
          if (timetable) {
            const keep = await tx
              .select({ id: classSessions.id, date: classSessions.date })
              .from(classSessions)
              .where(and(eq(classSessions.batchId, id), sql`(${classSessions.date} < ${today()} or exists (select 1 from attendance a where a.session_id = ${qualified('class_sessions', 'id')}))`));
            await tx.delete(classSessions).where(and(eq(classSessions.batchId, id), keep.length ? sql`${classSessions.id} not in (${sql.join(keep.map((k) => sql`${k.id}`), sql`, `)})` : undefined));
            const kept = new Set(keep.map((k) => k.date));
            const dates = sessionDates(row.startDate, row.endDate, row.days).filter((d) => d >= today() && !kept.has(d));
            if (dates.length) await tx.insert(classSessions).values(dates.map((date) => ({ tenantId, batchId: id, date, startTime: row.startTime, endTime: row.endTime })));
          }
        } else {
          [row] = (await tx.insert(batches).values({ tenantId, ...values, createdBy: actor.id }).returning()) as [BatchRow];
          const dates = sessionDates(row.startDate, row.endDate, row.days);
          if (dates.length) await tx.insert(classSessions).values(dates.map((date) => ({ tenantId, batchId: row.id, date, startTime: row.startTime, endTime: row.endTime })));
        }
        await tx.delete(batchTrainers).where(eq(batchTrainers.batchId, row.id));
        if (input.trainerIds.length) await tx.insert(batchTrainers).values([...new Set(input.trainerIds)].map((userId) => ({ tenantId, batchId: row.id, userId })));
        return row;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException({ message: 'Another batch has that code.', fieldErrors: { code: 'Already used' } });
      throw err;
    }
    await this.audit.record(actor, { action: 'batch.saved', entityType: 'course', entityId: course.id, metadata: { batch: saved.code, course: course.name, created: !id, capacity: saved.capacity, status: saved.status } });
    return (await this.summaries([saved.id]))[0]!;
  }

  async updateSession(actor: AuthUser, sessionId: string, raw: z.input<typeof sessionUpdateSchema>): Promise<SessionView[]> {
    const input = sessionUpdateSchema.parse(raw);
    const [s] = await this.db.select().from(classSessions).where(and(eq(classSessions.id, sessionId), eq(classSessions.tenantId, tenantOf(actor)))).limit(1);
    if (!s) throw new NotFoundException('Session not found.');
    await this.assertTeaches(actor, s.batchId);
    const patch: Partial<typeof classSessions.$inferInsert> = {};
    if (input.topic !== undefined) patch.topic = input.topic;
    if (input.cancelled !== undefined) patch.cancelled = input.cancelled;
    if (input.date) patch.date = input.date;
    if (input.startTime) patch.startTime = input.startTime;
    if (input.endTime) patch.endTime = input.endTime;
    if (Object.keys(patch).length) await this.db.update(classSessions).set(patch).where(eq(classSessions.id, sessionId));
    return this.sessions(s.batchId);
  }

  /** A session added outside the timetable (a make-up class). */
  async addSession(actor: AuthUser, batchId: string, raw: { date: string; startTime: string; endTime: string; topic?: string | null }): Promise<SessionView[]> {
    const b = await this.assertTeaches(actor, batchId);
    const input = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), startTime: z.string().regex(/^\d{2}:\d{2}$/), endTime: z.string().regex(/^\d{2}:\d{2}$/), topic: z.string().trim().max(200).nullable().optional() }).parse(raw);
    await this.db.insert(classSessions).values({ tenantId: b.tenantId, batchId, date: input.date, startTime: input.startTime, endTime: input.endTime, topic: input.topic ?? 'Make-up class' });
    return this.sessions(batchId);
  }

  async findBatch(tenantId: string, id: string): Promise<BatchRow> {
    const [b] = await this.db.select().from(batches).where(and(eq(batches.id, id), eq(batches.tenantId, tenantId))).limit(1);
    if (!b) throw new NotFoundException('Batch not found.');
    return b;
  }

  /** Staff who can be a batch's trainer: everyone with "Teach batches", and managers. */
  async trainerOptions(actor: AuthUser): Promise<{ id: string; name: string }[]> {
    this.assertView(actor);
    const r = await this.db.execute<{ id: string; name: string }>(sql`
      select u.id, u.full_name as name from users u
      left join staff_roles sr on sr.id = u.staff_role_id
      where u.tenant_id = ${tenantOf(actor)} and u.is_active and (
        u.role = 'manager' or (u.role = 'consultant' and coalesce(
          (select up.effect = 'allow' from user_permissions up where up.user_id = u.id and up.permission = 'course.teach'),
          (case when sr.effects ? 'course.teach' then sr.effects ->> 'course.teach' = 'allow' end),
          (select rp.effect = 'allow' from role_permissions rp where rp.tenant_id = u.tenant_id and rp.role = 'consultant' and rp.permission = 'course.teach'),
          false)))
      order by u.full_name`);
    return ((r as unknown as { rows?: { id: string; name: string }[] }).rows ?? (r as unknown as { id: string; name: string }[])).map((x) => ({ id: x.id, name: x.name }));
  }

  /* ---------------------------------------------------------------- */
  /* Settings                                                          */
  /* ---------------------------------------------------------------- */

  async settings(tenantId: string): Promise<CourseSettingsView> {
    let [row] = await this.db.select().from(courseSettings).where(eq(courseSettings.tenantId, tenantId)).limit(1);
    if (!row) {
      await this.db.insert(courseSettings).values({ tenantId }).onConflictDoNothing();
      [row] = await this.db.select().from(courseSettings).where(eq(courseSettings.tenantId, tenantId)).limit(1);
    }
    return { absenceAlertAfter: row!.absenceAlertAfter, certificateMinAttendance: row!.certificateMinAttendance };
  }

  async saveSettings(actor: AuthUser, raw: CourseSettingsInput): Promise<CourseSettingsView> {
    this.assertManage(actor);
    const input = courseSettingsSchema.parse(raw);
    const tenantId = tenantOf(actor);
    await this.settings(tenantId);
    await this.db.update(courseSettings).set({ ...input, updatedBy: actor.id, updatedAt: new Date() }).where(eq(courseSettings.tenantId, tenantId));
    await this.audit.record(actor, { action: 'course.saved', entityType: 'settings', entityId: tenantId, metadata: { settings: input } });
    return this.settings(tenantId);
  }

  /* ---------------------------------------------------------------- */
  /* Reports                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Per course: batches, enrolments and how they ended, attendance, how much
   * mock scores improved from first to latest, how many with an official
   * result reached their target, and what was billed as course income.
   */
  async report(actor: AuthUser): Promise<CourseReportRow[]> {
    this.assertView(actor);
    const tenantId = tenantOf(actor);
    const list = await this.db.select().from(courses).where(eq(courses.tenantId, tenantId)).orderBy(asc(courses.name));
    if (!list.length) return [];
    const ids = list.map((c) => c.id);
    const [counts, att, mocks, results, revenue] = await Promise.all([
      this.db
        .select({
          id: batches.courseId,
          batches: sql<number>`count(distinct ${batches.id})::int`,
          enrolled: sql<number>`count(${enrollments.id}) filter (where ${enrollments.status} in ('enrolled', 'frozen', 'completed'))::int`,
          completed: sql<number>`count(${enrollments.id}) filter (where ${enrollments.status} = 'completed')::int`,
          dropped: sql<number>`count(${enrollments.id}) filter (where ${enrollments.status} = 'dropped')::int`,
        })
        .from(batches)
        .leftJoin(enrollments, eq(enrollments.batchId, batches.id))
        .where(inArray(batches.courseId, ids))
        .groupBy(batches.courseId),
      this.db
        .select({
          id: batches.courseId,
          present: sql<number>`count(*) filter (where ${attendance.status} = 'present')::int`,
          late: sql<number>`count(*) filter (where ${attendance.status} = 'late')::int`,
          absent: sql<number>`count(*) filter (where ${attendance.status} = 'absent')::int`,
        })
        .from(attendance)
        .innerJoin(enrollments, eq(enrollments.id, attendance.enrollmentId))
        .innerJoin(batches, eq(batches.id, enrollments.batchId))
        .where(inArray(batches.courseId, ids))
        .groupBy(batches.courseId),
      this.db
        .select({ courseId: batches.courseId, enrollmentId: assessmentScores.enrollmentId, overall: assessmentScores.overall, heldOn: assessments.heldOn })
        .from(assessmentScores)
        .innerJoin(assessments, eq(assessments.id, assessmentScores.assessmentId))
        .innerJoin(batches, eq(batches.id, assessments.batchId))
        .where(and(inArray(batches.courseId, ids), sql`${assessmentScores.overall} is not null`))
        .orderBy(asc(assessments.heldOn)),
      this.db
        .select({ courseId: batches.courseId, target: enrollments.targetScore, overall: testResults.overall, testType: testResults.testType, courseTest: courses.testType })
        .from(enrollments)
        .innerJoin(batches, eq(batches.id, enrollments.batchId))
        .innerJoin(courses, eq(courses.id, batches.courseId))
        .innerJoin(testResults, and(eq(testResults.clientId, enrollments.clientId), eq(testResults.status, 'result'), sql`${testResults.testDate} >= ${batches.startDate}`))
        .where(and(inArray(batches.courseId, ids), ne(enrollments.status, 'transferred'))),
      this.db
        .select({ id: batches.courseId, currency: invoices.currency, n: sql<string>`sum(${invoiceItems.lineTotal})` })
        .from(enrollments)
        .innerJoin(batches, eq(batches.id, enrollments.batchId))
        .innerJoin(invoices, eq(invoices.id, enrollments.invoiceId))
        .innerJoin(invoiceItems, and(eq(invoiceItems.invoiceId, invoices.id), eq(invoiceItems.category, 'course')))
        .where(and(inArray(batches.courseId, ids), ne(invoices.status, 'void')))
        .groupBy(batches.courseId, invoices.currency),
    ]);
    return list.map((c) => {
      const n = counts.find((x) => x.id === c.id);
      const a = att.find((x) => x.id === c.id);
      const perStudent = new Map<string, number[]>();
      for (const m of mocks.filter((x) => x.courseId === c.id)) perStudent.set(m.enrollmentId, [...(perStudent.get(m.enrollmentId) ?? []), Number(m.overall)]);
      const gains = [...perStudent.values()].filter((v) => v.length >= 2).map((v) => v[v.length - 1]! - v[0]!);
      const mine = results.filter((r) => r.courseId === c.id && r.testType === r.courseTest);
      return {
        courseId: c.id,
        courseName: c.name,
        batches: n?.batches ?? 0,
        enrolled: n?.enrolled ?? 0,
        completed: n?.completed ?? 0,
        dropped: n?.dropped ?? 0,
        attendancePercent: a ? attendancePercent(a) : null,
        averageImprovement: gains.length ? Math.round((gains.reduce((x, y) => x + y, 0) / gains.length) * 100) / 100 : null,
        reachedTarget: mine.filter((r) => r.target !== null && r.overall !== null && Number(r.overall) >= Number(r.target)).length,
        withResult: mine.length,
        revenue: revenue.filter((r) => r.id === c.id).map((r) => ({ currency: r.currency as Currency, amount: Number(r.n) })),
      };
    });
  }
}

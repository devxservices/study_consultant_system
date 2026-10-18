import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  localIsoDate,
  SEATED,
  attendancePercent,
  enrolSchema,
  freezeSchema,
  transferSchema,
  type AuthUser,
  type EnrolInput,
  type EnrollmentFee,
  type EnrollmentStatus,
  type EnrollmentView,
  type Currency,
  type HandOverInput,
  type ListStudentsQuery,
  type StudentListView,
  type TestType,
  handOverSchema,
  listStudentsQuerySchema,
} from '@crm/shared';
import { creditedSql, overdueSql, paidSql } from '../billing/billing.service';
import { z } from 'zod';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { assessmentScores, assessments, attendance, batches, classSessions, clients, consultants, courses, enrollments, invoices, servicePackages, users } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RemindersService } from '../reminders/reminders.service';
import { BillingService } from '../billing/billing.service';
import { ClientsService } from '../clients/clients.service';
import { PdfService } from '../finance/pdf.service';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { staffCan } from '../auth/permissions';
import { addDays, iso, isoOrNull, today, withDocumentNumber } from '../common/db-helpers';
import { CoursesService } from './courses.service';
import { qualified } from '../documents/drive-sql';

type Row = typeof enrollments.$inferSelect;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Where an enrolment's fees stand, from its invoice and what is settled on it. */
export function feeOf(
  inv: { status: string | null; currency: string | null; total: number | null; dueDate: string | null; paid: number | string | null; credited: number | string | null; overdue: boolean | null } | null,
): EnrollmentFee {
  if (!inv || inv.status === null) return { status: 'not_billed', currency: null, total: 0, paid: 0, balance: 0, dueDate: null };
  const total = Number(inv.total ?? 0);
  const settled = Number(inv.paid ?? 0) + Number(inv.credited ?? 0);
  const balance = Math.max(0, total - settled);
  const base = { currency: inv.currency as Currency, total, paid: Number(inv.paid ?? 0), balance, dueDate: inv.dueDate };
  if (inv.status === 'void') return { ...base, status: 'void', balance: 0 };
  if (inv.status === 'pending_approval') return { ...base, status: 'pending' };
  if (balance <= 0) return { ...base, status: 'paid' };
  if (inv.overdue) return { ...base, status: 'overdue' };
  return { ...base, status: settled > 0 ? 'part_paid' : 'unpaid' };
}

/**
 * Students in batches. A seat goes to whoever is enrolled while there is one,
 * and to the first on the waiting list when one frees up (a drop, a move to
 * another batch, more seats). A paused student keeps their seat. Fees are
 * billed through finance, on one invoice for a bundle.
 */
@Injectable()
export class EnrollmentsService implements OnModuleInit {
  private readonly logger = new Logger(EnrollmentsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly reminders: RemindersService,
    private readonly billing: BillingService,
    private readonly clientsService: ClientsService,
    private readonly pdf: PdfService,
    private readonly courses: CoursesService,
  ) {}

  onModuleInit(): void {
    this.reminders.register('course-sweep', () => this.sweep());
  }

  private assertEnrol(actor: AuthUser): void {
    if (!staffCan(actor, 'course.enroll') && !staffCan(actor, 'course.manage')) throw new ForbiddenException('You do not have permission to enrol students.');
  }

  /** Staff working with the student (or who manage courses) may change their enrolment. */
  private async assertStudent(actor: AuthUser, clientId: string): Promise<void> {
    if (staffCan(actor, 'course.manage')) {
      const [c] = await this.db.select({ id: clients.id }).from(clients).where(and(eq(clients.id, clientId), eq(clients.tenantId, tenantOf(actor)))).limit(1);
      if (!c) throw new NotFoundException('Student not found.');
      return;
    }
    await this.clientsService.findOne(actor, clientId);
  }

  /* ---------------------------------------------------------------- */
  /* Enrolling                                                         */
  /* ---------------------------------------------------------------- */

  async enrol(actor: AuthUser, raw: EnrolInput): Promise<EnrollmentView[]> {
    this.assertEnrol(actor);
    const input = enrolSchema.parse(raw);
    const tenantId = tenantOf(actor);
    await this.assertStudent(actor, input.clientId);
    const ids = [...new Set(input.batchIds)];
    const rows = await this.db.select({ b: batches, c: courses }).from(batches).innerJoin(courses, eq(courses.id, batches.courseId)).where(and(inArray(batches.id, ids), eq(batches.tenantId, tenantId)));
    if (rows.length !== ids.length) throw new NotFoundException('Batch not found.');
    for (const { b } of rows) {
      if (b.status === 'completed' || b.status === 'cancelled') throw new BadRequestException(`${b.code} is ${b.status}.`);
    }
    const already = await this.db
      .select({ code: batches.code })
      .from(enrollments)
      .innerJoin(batches, eq(batches.id, enrollments.batchId))
      .where(and(inArray(enrollments.batchId, ids), eq(enrollments.clientId, input.clientId), inArray(enrollments.status, ['waitlisted', 'enrolled', 'frozen', 'completed'])));
    if (already.length) throw new ConflictException(`Already in ${already.map((a) => a.code).join(', ')}.`);

    // The fees, on one invoice: each course's own, or a bundle's single price.
    let invoiceId: string | null = null;
    if (input.invoice) {
      if (!staffCan(actor, 'billing.invoice')) throw new ForbiddenException('Billing the fees needs “Create invoices”. Enrol without the invoice, or ask someone who can.');
      const currencies = new Set(rows.map((r) => r.c.currency));
      let items: { description: string; quantity: number; unitAmount: number; category: 'course'; packageId?: string | null; discount?: number }[];
      let currency = rows[0]!.c.currency;
      if (input.packageId) {
        const [p] = await this.db.select().from(servicePackages).where(and(eq(servicePackages.id, input.packageId), eq(servicePackages.tenantId, tenantId))).limit(1);
        if (!p) throw new BadRequestException('That fee package does not exist.');
        if (p.category !== 'course') throw new BadRequestException('Course fees are billed by a package of the "course" kind.');
        currency = p.currency;
        items = [{ description: `${p.name}: ${rows.map((r) => `${r.c.name} (${r.b.code})`).join(', ')}`, quantity: 1, unitAmount: p.amount, category: 'course', packageId: p.id }];
      } else {
        if (currencies.size > 1) throw new BadRequestException('These courses are priced in different currencies. Bill them separately, or by a package.');
        items = rows.map(({ b, c }) => ({ description: `${c.name} (${b.code}, ${b.startDate} to ${b.endDate})`, quantity: 1, unitAmount: b.fee ?? c.fee, category: 'course', packageId: c.packageId }));
        if (items.some((i) => i.unitAmount <= 0)) throw new BadRequestException('A course here has no fee. Set its fee, bill by a package, or enrol without the invoice.');
      }
      const discount = Math.round(input.discount * 100);
      if (discount > 0) {
        if (!input.discountReason) throw new BadRequestException({ message: 'Say why the discount was given.', fieldErrors: { discountReason: 'Why?' } });
        if (discount > items[0]!.unitAmount) throw new BadRequestException({ message: 'The discount is more than the fee.', fieldErrors: { discount: 'Too much' } });
        items[0]!.discount = discount;
      }
      const firstStart = rows.map((r) => r.b.startDate).sort()[0]!;
      const inv = await this.billing.create(actor, {
        clientId: input.clientId,
        currency: currency as never,
        dueDate: firstStart > today() ? firstStart : addDays(today(), 7),
        items,
        discountReason: input.discountReason,
        notes: 'Course fees.',
      });
      invoiceId = inv.id;
    }

    const made: string[] = [];
    for (const { b, c } of rows) {
      const row = await this.place(tenantId, b.id, {
        clientId: input.clientId,
        targetScore: input.targetScore ?? null,
        invoiceId,
        transferredFromId: null,
        createdBy: actor.id,
      });
      made.push(row.id);
      await this.audit.record(actor, {
        action: 'enrollment.created',
        entityType: 'course',
        entityId: c.id,
        clientId: input.clientId,
        metadata: { number: row.number, batch: b.code, course: c.name, status: row.status, invoiceId },
      });
      await this.tellStudent(
        input.clientId,
        row.status === 'enrolled' ? `You are enrolled in ${c.name}` : `You are on the waiting list for ${c.name}`,
        row.status === 'enrolled' ? `${b.code}: starts ${b.startDate}, ${b.startTime}-${b.endTime}.` : `${b.code} is full. You will be told as soon as a seat is yours.`,
      );
    }
    return this.views(made);
  }

  /** A seat if there is one, else the waiting list - decided under a lock on the batch. */
  private async place(tenantId: string, batchId: string, v: { clientId: string; targetScore: number | null; invoiceId: string | null; transferredFromId: string | null; createdBy: string }, txIn?: Tx): Promise<Row> {
    const run = async (tx: Tx) => {
      await tx.execute(sql`select id from batches where id = ${batchId} for update`);
      const [b] = await tx.select({ capacity: batches.capacity }).from(batches).where(eq(batches.id, batchId));
      const [seated] = await tx.select({ n: sql<number>`count(*)::int` }).from(enrollments).where(and(eq(enrollments.batchId, batchId), inArray(enrollments.status, [...SEATED])));
      const status: EnrollmentStatus = (seated?.n ?? 0) < b!.capacity ? 'enrolled' : 'waitlisted';
      const number = await this.nextNumber(tx, tenantId);
      const [row] = await tx
        .insert(enrollments)
        .values({
          tenantId,
          number,
          batchId,
          clientId: v.clientId,
          status,
          waitlistedAt: status === 'waitlisted' ? new Date() : null,
          targetScore: v.targetScore === null ? null : String(v.targetScore),
          invoiceId: v.invoiceId,
          transferredFromId: v.transferredFromId,
          createdBy: v.createdBy,
        })
        .returning();
      return row!;
    };
    return txIn ? run(txIn) : this.db.transaction(run);
  }

  private async nextNumber(tx: Tx, tenantId: string): Promise<string> {
    const stem = `ENR-${new Date().getFullYear()}-`;
    const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(enrollments).where(and(eq(enrollments.tenantId, tenantId), sql`${enrollments.number} like ${stem + '%'}`));
    return `${stem}${String((r?.n ?? 0) + 1).padStart(4, '0')}`;
  }

  /** Seats freed: the first on the waiting list takes each. */
  private async promote(tenantId: string, batchId: string, actor: AuthUser | null): Promise<void> {
    const promoted = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select id from batches where id = ${batchId} for update`);
      const [b] = await tx.select({ capacity: batches.capacity, code: batches.code }).from(batches).where(eq(batches.id, batchId));
      const [seated] = await tx.select({ n: sql<number>`count(*)::int` }).from(enrollments).where(and(eq(enrollments.batchId, batchId), inArray(enrollments.status, [...SEATED])));
      const free = b!.capacity - (seated?.n ?? 0);
      if (free <= 0) return [];
      const next = await tx
        .select({ id: enrollments.id, clientId: enrollments.clientId })
        .from(enrollments)
        .where(and(eq(enrollments.batchId, batchId), eq(enrollments.status, 'waitlisted')))
        .orderBy(asc(enrollments.waitlistedAt), asc(enrollments.createdAt))
        .limit(free);
      if (next.length) await tx.update(enrollments).set({ status: 'enrolled', enrolledAt: new Date(), updatedAt: new Date() }).where(inArray(enrollments.id, next.map((n) => n.id)));
      return next.map((n) => ({ ...n, code: b!.code }));
    });
    for (const p of promoted) {
      await this.audit.record(actor, { tenantId, action: 'enrollment.updated', entityType: 'course', entityId: batchId, clientId: p.clientId, metadata: { enrollment: p.id, from: 'waitlisted', to: 'enrolled', batch: p.code } });
      await this.tellStudent(p.clientId, `A seat in ${p.code} is yours`, 'You were first on the waiting list.');
      await this.tellConsultant(p.clientId, `A seat came up in ${p.code}`, 'Your student moved off the waiting list.');
    }
  }

  /* ---------------------------------------------------------------- */
  /* Changing an enrolment                                             */
  /* ---------------------------------------------------------------- */

  async transfer(actor: AuthUser, id: string, raw: z.input<typeof transferSchema>): Promise<EnrollmentView> {
    this.assertEnrol(actor);
    const input = transferSchema.parse(raw);
    const tenantId = tenantOf(actor);
    const e = await this.find(tenantId, id);
    await this.assertStudent(actor, e.clientId);
    if (!['waitlisted', 'enrolled', 'frozen'].includes(e.status)) throw new BadRequestException(`It is ${e.status}.`);
    if (input.batchId === e.batchId) throw new BadRequestException('That is the batch they are in.');
    const to = await this.courses.findBatch(tenantId, input.batchId);
    if (to.status === 'completed' || to.status === 'cancelled') throw new BadRequestException(`${to.code} is ${to.status}.`);
    const [clash] = await this.db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(and(eq(enrollments.batchId, input.batchId), eq(enrollments.clientId, e.clientId), inArray(enrollments.status, ['waitlisted', 'enrolled', 'frozen', 'completed'])))
      .limit(1);
    if (clash) throw new ConflictException(`Already in ${to.code}.`);
    const created = await this.db.transaction(async (tx) => {
      await tx.update(enrollments).set({ status: 'transferred', updatedAt: new Date() }).where(eq(enrollments.id, id));
      return this.place(tenantId, input.batchId, { clientId: e.clientId, targetScore: e.targetScore === null ? null : Number(e.targetScore), invoiceId: e.invoiceId, transferredFromId: id, createdBy: actor.id }, tx);
    });
    const from = await this.courses.findBatch(tenantId, e.batchId);
    await this.audit.record(actor, { action: 'enrollment.updated', entityType: 'course', entityId: to.courseId, clientId: e.clientId, metadata: { from: from.code, to: to.code, status: created.status, reason: input.reason } });
    if ((SEATED as string[]).includes(e.status)) await this.promote(tenantId, e.batchId, actor);
    await this.tellStudent(e.clientId, `You have moved to ${to.code}`, created.status === 'enrolled' ? `It starts ${to.startDate}, ${to.startTime}-${to.endTime}.` : `${to.code} is full: you are on its waiting list.`);
    return (await this.views([created.id]))[0]!;
  }

  async freeze(actor: AuthUser, id: string, raw: z.input<typeof freezeSchema>): Promise<EnrollmentView> {
    this.assertEnrol(actor);
    const input = freezeSchema.parse(raw);
    const e = await this.find(tenantOf(actor), id);
    await this.assertStudent(actor, e.clientId);
    if (e.status !== 'enrolled') throw new BadRequestException('Only an enrolled student can be paused.');
    await this.db.update(enrollments).set({ status: 'frozen', frozenFrom: input.from, frozenUntil: input.until, freezeReason: input.reason, updatedAt: new Date() }).where(eq(enrollments.id, id));
    await this.audit.record(actor, { action: 'enrollment.updated', entityType: 'course', entityId: e.batchId, clientId: e.clientId, metadata: { enrollment: e.number, to: 'frozen', from: input.from, until: input.until, reason: input.reason } });
    return (await this.views([id]))[0]!;
  }

  async resume(actor: AuthUser, id: string): Promise<EnrollmentView> {
    this.assertEnrol(actor);
    const e = await this.find(tenantOf(actor), id);
    await this.assertStudent(actor, e.clientId);
    if (e.status !== 'frozen') throw new BadRequestException('It is not paused.');
    await this.db.update(enrollments).set({ status: 'enrolled', updatedAt: new Date() }).where(eq(enrollments.id, id));
    await this.audit.record(actor, { action: 'enrollment.updated', entityType: 'course', entityId: e.batchId, clientId: e.clientId, metadata: { enrollment: e.number, to: 'enrolled', resumed: true } });
    return (await this.views([id]))[0]!;
  }

  async drop(actor: AuthUser, id: string, reason: string): Promise<EnrollmentView> {
    this.assertEnrol(actor);
    const tenantId = tenantOf(actor);
    const e = await this.find(tenantId, id);
    await this.assertStudent(actor, e.clientId);
    if (!['waitlisted', 'enrolled', 'frozen'].includes(e.status)) throw new BadRequestException(`It is ${e.status}.`);
    await this.db.update(enrollments).set({ status: 'dropped', droppedAt: new Date(), dropReason: reason, updatedAt: new Date() }).where(eq(enrollments.id, id));
    await this.audit.record(actor, { action: 'enrollment.updated', entityType: 'course', entityId: e.batchId, clientId: e.clientId, metadata: { enrollment: e.number, to: 'dropped', reason, invoiceId: e.invoiceId } });
    if ((SEATED as string[]).includes(e.status)) await this.promote(tenantId, e.batchId, actor);
    return (await this.views([id]))[0]!;
  }

  /** Finished: with a certificate when attendance reached the consultancy's minimum. */
  async complete(actor: AuthUser, id: string): Promise<EnrollmentView> {
    this.courses.assertManage(actor);
    const tenantId = tenantOf(actor);
    const e = await this.find(tenantId, id);
    if (e.status !== 'enrolled' && e.status !== 'frozen') throw new BadRequestException(`It is ${e.status}.`);
    const [view] = await this.views([id]);
    const settings = await this.courses.settings(tenantId);
    const earns = view!.attendance.percent !== null && view!.attendance.percent >= settings.certificateMinAttendance;
    const certificateNumber = earns ? await this.nextCertificate(tenantId) : null;
    await this.db.update(enrollments).set({ status: 'completed', completedAt: new Date(), certificateNumber, updatedAt: new Date() }).where(eq(enrollments.id, id));
    await this.audit.record(actor, { action: certificateNumber ? 'certificate.issued' : 'enrollment.updated', entityType: 'course', entityId: e.batchId, clientId: e.clientId, metadata: { enrollment: e.number, to: 'completed', certificate: certificateNumber, attendance: view!.attendance.percent } });
    if (certificateNumber) await this.tellStudent(e.clientId, `You completed ${view!.courseName}`, `Your certificate ${certificateNumber} is in your courses.`);
    return (await this.views([id]))[0]!;
  }

  /** The batch is over: it is marked completed and everyone still in it completes. */
  async completeBatch(actor: AuthUser, batchId: string): Promise<{ completed: number; certificates: number }> {
    this.courses.assertManage(actor);
    const tenantId = tenantOf(actor);
    const b = await this.courses.findBatch(tenantId, batchId);
    if (b.status === 'completed') return { completed: 0, certificates: 0 };
    const live = await this.db.select({ id: enrollments.id }).from(enrollments).where(and(eq(enrollments.batchId, batchId), inArray(enrollments.status, ['enrolled', 'frozen'])));
    let certificates = 0;
    for (const l of live) {
      const v = await this.complete(actor, l.id);
      if (v.certificateNumber) certificates++;
    }
    // Nobody waits for a batch that has finished.
    const waiting = await this.db.update(enrollments).set({ status: 'dropped', droppedAt: new Date(), dropReason: 'The batch finished before a seat came up.', updatedAt: new Date() }).where(and(eq(enrollments.batchId, batchId), eq(enrollments.status, 'waitlisted'))).returning({ clientId: enrollments.clientId });
    for (const w of waiting) await this.tellConsultant(w.clientId, `${b.code} finished before a seat came up`, 'Your student was on its waiting list - offer them another batch.');
    await this.db.update(batches).set({ status: 'completed', updatedAt: new Date() }).where(eq(batches.id, batchId));
    await this.audit.record(actor, { action: 'batch.saved', entityType: 'course', entityId: b.courseId, metadata: { batch: b.code, to: 'completed', completed: live.length, certificates } });
    return { completed: live.length, certificates };
  }

  private async nextCertificate(tenantId: string): Promise<string> {
    const stem = `CERT-${new Date().getFullYear()}-`;
    const [r] = await this.db.select({ n: sql<number>`count(*)::int` }).from(enrollments).where(and(eq(enrollments.tenantId, tenantId), sql`${enrollments.certificateNumber} like ${stem + '%'}`));
    return `${stem}${String((r?.n ?? 0) + 1).padStart(4, '0')}`;
  }

  async certificate(actor: AuthUser, id: string): Promise<{ pdf: Buffer; name: string }> {
    const tenantId = tenantOf(actor);
    const e = await this.find(tenantId, id);
    if (actor.role === 'client') {
      if (actor.clientId !== e.clientId) throw new NotFoundException('Not found.');
    } else this.courses.assertView(actor);
    if (!e.certificateNumber) throw new NotFoundException('No certificate was issued for this enrolment.');
    const [v] = await this.views([id]);
    const b = await this.courses.findBatch(tenantId, e.batchId);
    const pdf = await this.pdf.courseCertificate(tenantId, {
      number: e.certificateNumber,
      studentName: v!.clientName,
      courseName: v!.courseName,
      batchCode: b.code,
      from: b.startDate,
      to: b.endDate,
      attendancePercent: v!.attendance.percent,
      completedOn: localIsoDate(e.completedAt ?? new Date()),
    });
    return { pdf, name: `${e.certificateNumber}.pdf` };
  }

  /* ---------------------------------------------------------------- */
  /* Reading                                                           */
  /* ---------------------------------------------------------------- */

  async get(actor: AuthUser, id: string): Promise<EnrollmentView> {
    const e = await this.find(tenantOf(actor), id);
    if (actor.role === 'client') {
      if (actor.clientId !== e.clientId) throw new NotFoundException('Not found.');
    } else this.courses.assertView(actor);
    return (await this.views([id]))[0]!;
  }

  async forClient(actor: AuthUser, clientId: string): Promise<EnrollmentView[]> {
    this.courses.assertView(actor);
    const rows = await this.db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(and(eq(enrollments.clientId, clientId), eq(enrollments.tenantId, tenantOf(actor))))
      .orderBy(desc(enrollments.createdAt));
    return this.views(rows.map((r) => r.id));
  }

  /** A batch's roster: everyone in it or waiting, waiting list in order. */
  async roster(batchId: string): Promise<EnrollmentView[]> {
    const rows = await this.db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(and(eq(enrollments.batchId, batchId), ne(enrollments.status, 'transferred')))
      .orderBy(sql`case ${enrollments.status} when 'enrolled' then 0 when 'frozen' then 1 when 'completed' then 2 when 'waitlisted' then 3 else 4 end`, asc(enrollments.waitlistedAt), asc(enrollments.createdAt));
    return this.views(rows.map((r) => r.id));
  }

  /**
   * Every course student across batches, filtered. Who has "See courses"
   * sees all of them; a trainer only the batches they teach.
   */
  async list(actor: AuthUser, raw: ListStudentsQuery): Promise<StudentListView> {
    this.courses.assertView(actor);
    const q = listStudentsQuerySchema.parse(raw);
    const day = today();
    const E = { id: qualified('enrollments', 'id'), batchId: qualified('enrollments', 'batch_id') };
    const conds: (SQL | undefined)[] = [eq(enrollments.tenantId, tenantOf(actor))];
    if (!staffCan(actor, 'course.view')) {
      conds.push(sql`exists (select 1 from batch_trainers bt where bt.batch_id = ${E.batchId} and bt.user_id = ${actor.id})`);
    }
    switch (q.status) {
      case 'current':
        conds.push(inArray(enrollments.status, ['waitlisted', 'enrolled', 'frozen']));
        break;
      case 'upcoming':
        conds.push(inArray(enrollments.status, ['waitlisted', 'enrolled']), sql`${batches.startDate} > ${day}`);
        break;
      case 'running':
        conds.push(eq(enrollments.status, 'enrolled'), sql`${batches.startDate} <= ${day}`, ne(batches.status, 'completed'), ne(batches.status, 'cancelled'));
        break;
      case 'all':
        conds.push(ne(enrollments.status, 'transferred'));
        break;
      default:
        conds.push(eq(enrollments.status, q.status));
    }
    if (q.courseId) conds.push(eq(batches.courseId, q.courseId));
    if (q.batchId) conds.push(eq(enrollments.batchId, q.batchId));
    if (q.programme) conds.push(eq(clients.programme, q.programme));
    if (q.handOver) conds.push(eq(enrollments.status, 'completed'), eq(clients.programme, 'course_only'));
    if (q.q) {
      const term = `%${q.q}%`;
      conds.push(or(ilike(clients.fullName, term), ilike(clients.email, term), ilike(clients.phone, term), ilike(enrollments.number, term)));
    }
    const balance = sql`(${invoices.total} - ${paidSql} - ${creditedSql})`;
    switch (q.fees) {
      case 'owing':
        conds.push(eq(invoices.status, 'issued'), sql`${balance} > 0`);
        break;
      case 'overdue':
        conds.push(overdueSql(day));
        break;
      case 'paid':
        conds.push(eq(invoices.status, 'issued'), sql`${balance} <= 0`);
        break;
      case 'not_billed':
        conds.push(sql`(${invoices.id} is null or ${invoices.status} = 'void')`);
        break;
    }
    const where = and(...conds.filter(Boolean));
    const base = () =>
      this.db
        .select({ id: enrollments.id })
        .from(enrollments)
        .innerJoin(batches, eq(batches.id, enrollments.batchId))
        .innerJoin(clients, eq(clients.id, enrollments.clientId))
        .leftJoin(invoices, eq(invoices.id, enrollments.invoiceId))
        .where(where);
    const [rows, [count], owing] = await Promise.all([
      base()
        .orderBy(desc(batches.startDate), asc(clients.fullName))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(enrollments)
        .innerJoin(batches, eq(batches.id, enrollments.batchId))
        .innerJoin(clients, eq(clients.id, enrollments.clientId))
        .leftJoin(invoices, eq(invoices.id, enrollments.invoiceId))
        .where(where),
      // Each invoice once: a bundle's invoice covers several enrolments.
      this.db
        .select({ currency: invoices.currency, amount: sql<string>`sum(${balance})` })
        .from(invoices)
        .where(
          and(
            eq(invoices.status, 'issued'),
            sql`${balance} > 0`,
            sql`${invoices.id} in (select e2.invoice_id from (${base()}) x join enrollments e2 on e2.id = x.id)`,
          ),
        )
        .groupBy(invoices.currency),
    ]);
    const total = count?.n ?? 0;
    return {
      items: await this.views(rows.map((r) => r.id)),
      page: q.page,
      pageSize: q.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
      owing: owing.map((o) => ({ currency: o.currency as Currency, amount: Number(o.amount) })).filter((o) => o.amount > 0),
    };
  }

  /**
   * A course-only student who now wants to study abroad: they join the
   * study-abroad side (all clients, ready for an application) and the
   * consultant taking them on is told.
   */
  async handOver(actor: AuthUser, clientId: string, raw: HandOverInput): Promise<{ clientId: string }> {
    this.assertEnrol(actor);
    const input = handOverSchema.parse(raw);
    await this.assertStudent(actor, clientId);
    const tenantId = tenantOf(actor);
    const [c] = await this.db.select().from(clients).where(and(eq(clients.id, clientId), eq(clients.tenantId, tenantId))).limit(1);
    if (!c) throw new NotFoundException('Student not found.');
    if (c.programme !== 'course_only') throw new BadRequestException('They are already a study-abroad client.');
    if (input.consultantId && input.consultantId !== c.assignedConsultantId) {
      // The usual reassignment, with its permission check and notice.
      await this.clientsService.update(actor, clientId, { assignedConsultantId: input.consultantId });
    }
    await this.db.update(clients).set({ programme: 'study_abroad', updatedAt: new Date() }).where(eq(clients.id, clientId));
    const [latest] = await this.db
      .select({ course: courses.name, overall: sql<string | null>`(select tr.overall from test_results tr where tr.client_id = ${clientId} and tr.status = 'result' order by tr.test_date desc limit 1)` })
      .from(enrollments)
      .innerJoin(batches, eq(batches.id, enrollments.batchId))
      .innerJoin(courses, eq(courses.id, batches.courseId))
      .where(eq(enrollments.clientId, clientId))
      .orderBy(desc(enrollments.createdAt))
      .limit(1);
    await this.audit.record(actor, {
      action: 'client.handed_over',
      entityType: 'client',
      entityId: clientId,
      clientId,
      metadata: { fullName: c.fullName, consultantId: input.consultantId ?? c.assignedConsultantId, note: input.note },
    });
    const facts = [latest ? `Took ${latest.course}` : null, latest?.overall ? `official score ${Number(latest.overall)}` : null, input.note].filter(Boolean).join('. ');
    await this.tellConsultant(clientId, 'wants to study abroad', `${facts ? `${facts}. ` : ''}Open their first application.`, 'course_update', true);
    return { clientId };
  }

  async views(ids: string[]): Promise<EnrollmentView[]> {
    if (!ids.length) return [];
    const consultantUser = users;
    const day = today();
    const rows = await this.db
      .select({
        e: enrollments,
        b: batches,
        c: courses,
        clientName: clients.fullName,
        programme: clients.programme,
        consultantName: consultantUser.fullName,
        invoiceNumber: invoices.number,
        inv: {
          status: invoices.status,
          currency: invoices.currency,
          total: invoices.total,
          dueDate: invoices.dueDate,
          paid: paidSql,
          credited: creditedSql,
          overdue: sql<boolean>`${overdueSql(day)}`,
        },
      })
      .from(enrollments)
      .innerJoin(batches, eq(batches.id, enrollments.batchId))
      .innerJoin(courses, eq(courses.id, batches.courseId))
      .innerJoin(clients, eq(clients.id, enrollments.clientId))
      .leftJoin(consultants, eq(consultants.id, clients.assignedConsultantId))
      .leftJoin(consultantUser, eq(consultantUser.id, consultants.userId))
      .leftJoin(invoices, eq(invoices.id, enrollments.invoiceId))
      .where(inArray(enrollments.id, ids));
    const [att, mocks, fromBatches, waitOrder] = await Promise.all([
      this.db
        .select({
          id: attendance.enrollmentId,
          present: sql<number>`count(*) filter (where ${attendance.status} = 'present')::int`,
          late: sql<number>`count(*) filter (where ${attendance.status} = 'late')::int`,
          absent: sql<number>`count(*) filter (where ${attendance.status} = 'absent')::int`,
          excused: sql<number>`count(*) filter (where ${attendance.status} = 'excused')::int`,
        })
        .from(attendance)
        .where(inArray(attendance.enrollmentId, ids))
        .groupBy(attendance.enrollmentId),
      this.db
        .selectDistinctOn([assessmentScores.enrollmentId], { id: assessmentScores.enrollmentId, title: assessments.title, overall: assessmentScores.overall, heldOn: assessments.heldOn })
        .from(assessmentScores)
        .innerJoin(assessments, eq(assessments.id, assessmentScores.assessmentId))
        .where(inArray(assessmentScores.enrollmentId, ids))
        .orderBy(assessmentScores.enrollmentId, desc(assessments.heldOn)),
      this.db
        .select({ id: enrollments.id, code: batches.code })
        .from(enrollments)
        .innerJoin(batches, eq(batches.id, enrollments.batchId))
        .where(inArray(enrollments.id, rows.map((r) => r.e.transferredFromId).filter((x): x is string => Boolean(x)).concat(['00000000-0000-0000-0000-000000000000']))),
      this.db
        .select({ id: enrollments.id, pos: sql<number>`row_number() over (partition by ${enrollments.batchId} order by ${enrollments.waitlistedAt}, ${enrollments.createdAt})::int` })
        .from(enrollments)
        .where(and(inArray(enrollments.batchId, [...new Set(rows.map((r) => r.e.batchId))]), eq(enrollments.status, 'waitlisted'))),
    ]);
    const byId = new Map(rows.map((r) => [r.e.id, r]));
    return ids
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .map(({ e, b, c, clientName, programme, consultantName, invoiceNumber, inv }) => {
        const a = att.find((x) => x.id === e.id) ?? { present: 0, late: 0, absent: 0, excused: 0 };
        const m = mocks.find((x) => x.id === e.id);
        return {
          id: e.id,
          number: e.number,
          batchId: b.id,
          batchCode: b.code,
          courseId: c.id,
          courseName: c.name,
          testType: c.testType as TestType,
          clientId: e.clientId,
          clientName,
          consultantName,
          status: e.status as EnrollmentStatus,
          waitlistPosition: e.status === 'waitlisted' ? (waitOrder.find((w) => w.id === e.id)?.pos ?? null) : null,
          targetScore: e.targetScore === null ? null : Number(e.targetScore),
          enrolledAt: iso(e.enrolledAt),
          frozenFrom: e.frozenFrom,
          frozenUntil: e.frozenUntil,
          freezeReason: e.freezeReason,
          dropReason: e.dropReason,
          completedAt: isoOrNull(e.completedAt),
          certificateNumber: e.certificateNumber,
          invoiceId: e.invoiceId,
          invoiceNumber,
          fee: feeOf(e.invoiceId ? inv : null),
          programme: programme === 'course_only' ? 'course_only' : 'study_abroad',
          transferredFromBatch: fromBatches.find((f) => f.id === e.transferredFromId)?.code ?? null,
          attendance: { held: a.present + a.late + a.absent + a.excused, present: a.present, late: a.late, absent: a.absent, excused: a.excused, percent: attendancePercent(a) },
          latestMock: m ? { title: m.title, overall: m.overall === null ? null : Number(m.overall), heldOn: m.heldOn } : null,
        };
      });
  }

  async find(tenantId: string, id: string): Promise<Row> {
    const [e] = await this.db.select().from(enrollments).where(and(eq(enrollments.id, id), eq(enrollments.tenantId, tenantId))).limit(1);
    if (!e) throw new NotFoundException('Enrolment not found.');
    return e;
  }

  /* ---------------------------------------------------------------- */
  /* The daily sweep                                                   */
  /* ---------------------------------------------------------------- */

  /**
   * Batches whose first day has come start running; students whose pause
   * has ended are back in class (their consultant is told).
   */
  async sweep(): Promise<number> {
    const day = today();
    const started = await this.db
      .update(batches)
      .set({ status: 'running', updatedAt: new Date() })
      .where(and(inArray(batches.status, ['planned', 'enrolling']), sql`${batches.startDate} <= ${day}`))
      .returning({ id: batches.id });
    const back = await this.db
      .update(enrollments)
      .set({ status: 'enrolled', updatedAt: new Date() })
      .where(and(eq(enrollments.status, 'frozen'), sql`${enrollments.frozenUntil} < ${day}`))
      .returning({ clientId: enrollments.clientId, batchId: enrollments.batchId });
    for (const r of back) await this.tellConsultant(r.clientId, 'A paused student is back in class', 'Their pause has ended.');
    return started.length + back.length;
  }

  /* ---------------------------------------------------------------- */
  /* Telling people                                                    */
  /* ---------------------------------------------------------------- */

  async tellStudent(clientId: string, title: string, body: string): Promise<void> {
    const [c] = await this.db.select({ userId: clients.userId }).from(clients).where(eq(clients.id, clientId)).limit(1);
    if (c?.userId) await this.notifications.push({ userId: c.userId, type: 'course_update', title, body, link: '/portal/courses' });
  }

  async tellConsultant(clientId: string, title: string, body: string, type: 'course_update' | 'absence_alert' = 'course_update', email = false): Promise<void> {
    const [c] = await this.db
      .select({ userId: consultants.userId, name: clients.fullName })
      .from(clients)
      .innerJoin(consultants, eq(consultants.id, clients.assignedConsultantId))
      .where(eq(clients.id, clientId))
      .limit(1);
    if (c?.userId) await this.notifications.push({ userId: c.userId, type, title: `${c.name}: ${title}`, body, link: `/desk/clients/${clientId}`, email });
  }
}


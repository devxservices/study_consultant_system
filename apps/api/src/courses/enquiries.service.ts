import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  ENQUIRY_SOURCE_LABEL,
  ENQUIRY_SOURCES,
  OPEN_ENQUIRY,
  TRIAL_OUTCOME_LABEL,
  convertEnquirySchema,
  enquiryContactSchema,
  enquiryLostSchema,
  enquirySchema,
  listEnquiriesQuerySchema,
  publicEnquirySchema,
  trialOutcomeSchema,
  trialSchema,
  type AuthUser,
  type ConvertEnquiryInput,
  type CourseMode,
  type EnquiryContactInput,
  type EnquiryDetail,
  type EnquiryInput,
  type EnquirySource,
  type EnquiryStatus,
  type EnquirySummary,
  type EnquiryView,
  type EnrollmentView,
  type ListEnquiriesQuery,
  type PublicCoursesView,
  type PublicEnquiryInput,
  type TestType,
  type TrialOutcome,
  type TrialSlotView,
} from '@crm/shared';
import { z } from 'zod';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { batchTrainers, batches, classSessions, clients, courseEnquiries, courseEnquiryEvents, courses, enrollments, users } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RemindersService } from '../reminders/reminders.service';
import { ClientsService } from '../clients/clients.service';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { tenantIdentity } from '../tenancy/tenant-links';
import { staffCan } from '../auth/permissions';
import { addDays, iso, isoOrNull, today, withDocumentNumber } from '../common/db-helpers';
import { qualified } from '../documents/drive-sql';
import { CoursesService } from './courses.service';
import { EnrollmentsService } from './enrollments.service';

type Row = typeof courseEnquiries.$inferSelect;

const assignee = alias(users, 'enquiry_assignee');
const creator = alias(users, 'enquiry_creator');
const trialSession = alias(classSessions, 'trial_session');
const trialBatch = alias(batches, 'trial_batch');
const enrolledBatch = alias(batches, 'enrolled_batch');
const wantedBatch = alias(batches, 'wanted_batch');

/**
 * People interested in a course, before they enrol: who asked, about what,
 * every call and note, a trial class, and how it ended - enrolled (and so a
 * student, with a client record) or not joining, with the reason.
 *
 * "See courses" reads them; "Enrol students" works them (calls, trials,
 * enrolling). A trainer marks whether a trial guest came to their class.
 */
@Injectable()
export class EnquiriesService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly reminders: RemindersService,
    private readonly clientsService: ClientsService,
    private readonly courses: CoursesService,
    private readonly enrollments: EnrollmentsService,
  ) {}

  onModuleInit(): void {
    this.reminders.register('course-enquiry-followups', () => this.remindFollowUps());
  }

  private assertSee(actor: AuthUser): void {
    if (!staffCan(actor, 'course.view') && !staffCan(actor, 'course.enroll') && !staffCan(actor, 'course.manage')) {
      throw new ForbiddenException('You do not have permission to see course enquiries.');
    }
  }

  private assertWork(actor: AuthUser): void {
    if (!staffCan(actor, 'course.enroll') && !staffCan(actor, 'course.manage')) throw new ForbiddenException('Working enquiries needs “Enrol students”.');
  }

  /* ---------------------------------------------------------------- */
  /* Reading                                                           */
  /* ---------------------------------------------------------------- */

  async list(actor: AuthUser, raw: ListEnquiriesQuery): Promise<EnquiryView[]> {
    this.assertSee(actor);
    const q = listEnquiriesQuerySchema.parse(raw);
    const conds: (SQL | undefined)[] = [eq(courseEnquiries.tenantId, tenantOf(actor))];
    if (q.status === 'open') conds.push(inArray(courseEnquiries.status, [...OPEN_ENQUIRY]));
    else if (q.status !== 'all') conds.push(eq(courseEnquiries.status, q.status));
    if (q.courseId) conds.push(eq(courseEnquiries.courseId, q.courseId));
    if (q.mine) conds.push(eq(courseEnquiries.assignedTo, actor.id));
    if (q.due) conds.push(inArray(courseEnquiries.status, [...OPEN_ENQUIRY]), lte(courseEnquiries.followUpOn, today()));
    if (q.q) {
      const term = `%${q.q}%`;
      conds.push(or(ilike(courseEnquiries.fullName, term), ilike(courseEnquiries.phone, term), ilike(courseEnquiries.email, term), ilike(courseEnquiries.number, term)));
    }
    const rows = await this.db
      .select({ id: courseEnquiries.id })
      .from(courseEnquiries)
      .where(and(...conds.filter(Boolean)))
      // Follow-ups that are due first, then the newest.
      .orderBy(sql`${courseEnquiries.followUpOn} asc nulls last`, desc(courseEnquiries.createdAt))
      .limit(500);
    return this.views(rows.map((r) => r.id));
  }

  async get(actor: AuthUser, id: string): Promise<EnquiryDetail> {
    this.assertSee(actor);
    await this.find(tenantOf(actor), id);
    const [view] = await this.views([id]);
    const events = await this.db
      .select({ id: courseEnquiryEvents.id, kind: courseEnquiryEvents.kind, body: courseEnquiryEvents.body, byName: users.fullName, at: courseEnquiryEvents.createdAt })
      .from(courseEnquiryEvents)
      .leftJoin(users, eq(users.id, courseEnquiryEvents.createdBy))
      .where(eq(courseEnquiryEvents.enquiryId, id))
      .orderBy(desc(courseEnquiryEvents.createdAt));
    return { ...view!, events: events.map((e) => ({ ...e, at: iso(e.at) })) };
  }

  async summary(actor: AuthUser): Promise<EnquirySummary> {
    this.assertSee(actor);
    const tenantId = tenantOf(actor);
    const day = today();
    const since = addDays(day, -90);
    const [open, [due], last, sources] = await Promise.all([
      this.db
        .select({ status: courseEnquiries.status, n: sql<number>`count(*)::int` })
        .from(courseEnquiries)
        .where(and(eq(courseEnquiries.tenantId, tenantId), inArray(courseEnquiries.status, [...OPEN_ENQUIRY])))
        .groupBy(courseEnquiries.status),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(courseEnquiries)
        .where(and(eq(courseEnquiries.tenantId, tenantId), inArray(courseEnquiries.status, [...OPEN_ENQUIRY]), lte(courseEnquiries.followUpOn, day))),
      this.db
        .select({ status: courseEnquiries.status, n: sql<number>`count(*)::int` })
        .from(courseEnquiries)
        .where(and(eq(courseEnquiries.tenantId, tenantId), gte(courseEnquiries.createdAt, new Date(`${since}T00:00:00Z`))))
        .groupBy(courseEnquiries.status),
      this.db
        .select({
          source: courseEnquiries.source,
          received: sql<number>`count(*)::int`,
          enrolled: sql<number>`count(*) filter (where ${courseEnquiries.status} = 'enrolled')::int`,
        })
        .from(courseEnquiries)
        .where(and(eq(courseEnquiries.tenantId, tenantId), gte(courseEnquiries.createdAt, new Date(`${since}T00:00:00Z`))))
        .groupBy(courseEnquiries.source),
    ]);
    const count = (list: { status: string; n: number }[], s: string) => list.find((x) => x.status === s)?.n ?? 0;
    const received = last.reduce((t, x) => t + x.n, 0);
    const enrolled = count(last, 'enrolled');
    const lost = count(last, 'lost');
    return {
      open: { new: count(open, 'new'), contacted: count(open, 'contacted'), trial_booked: count(open, 'trial_booked'), trial_done: count(open, 'trial_done') },
      followUpsDue: due?.n ?? 0,
      // Of those decided either way, how many enrolled.
      last90: { received, enrolled, lost, conversionPercent: enrolled + lost ? Math.round((enrolled / (enrolled + lost)) * 100) : null },
      bySource: sources
        .map((s) => ({ source: s.source as EnquirySource, received: s.received, enrolled: s.enrolled }))
        .sort((a, b) => b.received - a.received),
    };
  }

  /** Classes a trial guest can sit in on: the next three weeks of open batches. */
  async trialSlots(actor: AuthUser, courseId?: string): Promise<TrialSlotView[]> {
    this.assertSee(actor);
    const day = today();
    const S = { id: qualified('class_sessions', 'id') };
    const rows = await this.db
      .select({
        sessionId: classSessions.id,
        batchId: batches.id,
        batchCode: batches.code,
        courseId: courses.id,
        courseName: courses.name,
        date: classSessions.date,
        startTime: classSessions.startTime,
        endTime: classSessions.endTime,
        guests: sql<number>`(select count(*)::int from course_enquiries ce where ce.trial_session_id = ${S.id})`,
      })
      .from(classSessions)
      .innerJoin(batches, eq(batches.id, classSessions.batchId))
      .innerJoin(courses, eq(courses.id, batches.courseId))
      .where(
        and(
          eq(classSessions.tenantId, tenantOf(actor)),
          eq(classSessions.cancelled, false),
          gte(classSessions.date, day),
          lte(classSessions.date, addDays(day, 21)),
          inArray(batches.status, ['planned', 'enrolling', 'running']),
          courseId ? eq(courses.id, courseId) : undefined,
        ),
      )
      .orderBy(asc(classSessions.date), asc(classSessions.startTime))
      .limit(60);
    return rows;
  }

  /* ---------------------------------------------------------------- */
  /* Writing                                                           */
  /* ---------------------------------------------------------------- */

  async create(actor: AuthUser, raw: EnquiryInput): Promise<EnquiryDetail> {
    this.assertWork(actor);
    const input = enquirySchema.parse(raw);
    const tenantId = tenantOf(actor);
    await this.checkRefs(tenantId, input);
    if (input.clientId) await this.clientsService.findOne(actor, input.clientId);
    const dupe = await this.openFor(tenantId, input.phone);
    if (dupe) throw new ConflictException({ message: `${dupe.fullName} already has an open enquiry (${dupe.number}). Add to that one instead.`, fieldErrors: { phone: `Open enquiry ${dupe.number}` } });
    const assignedTo = input.assignedTo ?? actor.id;
    if (assignedTo !== actor.id) await this.assertStaff(tenantId, assignedTo);
    const row = await withDocumentNumber(this.db, courseEnquiries, tenantId, 'ENQ', async (number) => {
      const [r] = await this.db
        .insert(courseEnquiries)
        .values({
          tenantId,
          number,
          fullName: input.fullName,
          phone: input.phone,
          email: input.email,
          city: input.city,
          courseId: input.courseId ?? null,
          batchId: input.batchId ?? null,
          source: input.source,
          studyAbroad: input.studyAbroad,
          targetScore: input.targetScore === null || input.targetScore === undefined ? null : String(input.targetScore),
          assignedTo,
          followUpOn: input.followUpOn ?? today(),
          notes: input.notes,
          clientId: input.clientId ?? null,
          createdBy: actor.id,
        })
        .returning();
      return r!;
    });
    await this.event(row, actor.id, 'created', `Enquiry taken (${ENQUIRY_SOURCE_LABEL[input.source]}).`);
    await this.audit.record(actor, { action: 'enquiry.created', entityType: 'enquiry', entityId: row.id, clientId: row.clientId, metadata: { number: row.number, fullName: row.fullName, source: row.source } });
    if (assignedTo !== actor.id) await this.tellAssignee(row, `New course enquiry: ${row.fullName}`, 'It has been given to you to follow up.');
    return this.get(actor, row.id);
  }

  /** From the consultancy's own website. Asking again adds to the open enquiry rather than making another. */
  async createPublic(tenantId: string, raw: PublicEnquiryInput): Promise<{ ok: true; number: string }> {
    const input = publicEnquirySchema.parse(raw);
    if (input.courseId) {
      const [c] = await this.db.select({ id: courses.id }).from(courses).where(and(eq(courses.id, input.courseId), eq(courses.tenantId, tenantId), eq(courses.active, true))).limit(1);
      if (!c) throw new BadRequestException({ message: 'Pick a course from the list.', fieldErrors: { courseId: 'Not offered' } });
    }
    let batchId: string | null = null;
    if (input.batchId) {
      const [b] = await this.db.select({ id: batches.id, courseId: batches.courseId }).from(batches).where(and(eq(batches.id, input.batchId), eq(batches.tenantId, tenantId))).limit(1);
      if (b && (!input.courseId || b.courseId === input.courseId)) batchId = b.id;
    }
    const body = [input.message, input.studyAbroad ? 'Also interested in studying abroad.' : null].filter(Boolean).join(' ') || null;
    const dupe = await this.openFor(tenantId, input.phone);
    if (dupe) {
      await this.db
        .update(courseEnquiries)
        .set({ followUpOn: today(), courseId: dupe.courseId ?? input.courseId ?? null, studyAbroad: dupe.studyAbroad || input.studyAbroad, updatedAt: new Date() })
        .where(eq(courseEnquiries.id, dupe.id));
      await this.event(dupe, null, 'note', `Asked again on the website${body ? `: ${body}` : '.'}`);
      await this.tellAssignee(dupe, `${dupe.fullName} asked again about a course`, 'On the website form. Follow up today.');
      return { ok: true, number: dupe.number };
    }
    const row = await withDocumentNumber(this.db, courseEnquiries, tenantId, 'ENQ', async (number) => {
      const [r] = await this.db
        .insert(courseEnquiries)
        .values({
          tenantId,
          number,
          fullName: input.fullName,
          phone: input.phone,
          email: input.email,
          city: input.city,
          courseId: input.courseId ?? null,
          batchId,
          source: 'website',
          studyAbroad: input.studyAbroad,
          followUpOn: today(),
          notes: input.message,
        })
        .returning();
      return r!;
    });
    await this.event(row, null, 'created', `Enquiry from the website form.${body ? ` ${body}` : ''}`);
    // Nobody owns it yet: the managers hear about it.
    const managers = await this.db.select({ id: users.id }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.role, 'manager'), eq(users.isActive, true)));
    await this.notifications.pushMany(
      managers.map((m) => m.id),
      { type: 'course_update', title: `New course enquiry: ${row.fullName}`, body: 'From the website form. Give it to someone to follow up.', link: `/desk/courses/enquiries/${row.id}` },
    );
    return { ok: true, number: row.number };
  }

  async update(actor: AuthUser, id: string, raw: EnquiryInput): Promise<EnquiryDetail> {
    this.assertWork(actor);
    const input = enquirySchema.parse(raw);
    const tenantId = tenantOf(actor);
    const current = await this.find(tenantId, id);
    await this.checkRefs(tenantId, input);
    if (input.clientId && input.clientId !== current.clientId) await this.clientsService.findOne(actor, input.clientId);
    if (input.assignedTo && input.assignedTo !== current.assignedTo) await this.assertStaff(tenantId, input.assignedTo);
    await this.db
      .update(courseEnquiries)
      .set({
        fullName: input.fullName,
        phone: input.phone,
        email: input.email,
        city: input.city,
        courseId: input.courseId ?? null,
        batchId: input.batchId ?? null,
        source: input.source,
        studyAbroad: input.studyAbroad,
        targetScore: input.targetScore === null || input.targetScore === undefined ? null : String(input.targetScore),
        assignedTo: input.assignedTo ?? current.assignedTo,
        followUpOn: input.followUpOn === undefined ? current.followUpOn : input.followUpOn,
        notes: input.notes,
        clientId: input.clientId === undefined ? current.clientId : input.clientId,
        updatedAt: new Date(),
      })
      .where(eq(courseEnquiries.id, id));
    if (input.assignedTo && input.assignedTo !== current.assignedTo) {
      const [who] = await this.db.select({ name: users.fullName }).from(users).where(eq(users.id, input.assignedTo)).limit(1);
      await this.event(current, actor.id, 'assigned', `Given to ${who?.name ?? 'someone else'} to follow up.`);
      if (input.assignedTo !== actor.id) await this.tellAssignee({ ...current, assignedTo: input.assignedTo }, `Course enquiry: ${current.fullName}`, 'It has been given to you to follow up.');
    }
    await this.audit.record(actor, { action: 'enquiry.updated', entityType: 'enquiry', entityId: id, clientId: current.clientId, metadata: { number: current.number } });
    return this.get(actor, id);
  }

  /** A call or a note; a first contact moves a new enquiry on. */
  async contact(actor: AuthUser, id: string, raw: EnquiryContactInput): Promise<EnquiryDetail> {
    this.assertWork(actor);
    const input = enquiryContactSchema.parse(raw);
    const current = await this.find(tenantOf(actor), id);
    if (!OPEN_ENQUIRY.includes(current.status as EnquiryStatus)) throw new BadRequestException('This enquiry is closed. Reopen it first.');
    await this.db
      .update(courseEnquiries)
      .set({
        status: current.status === 'new' && input.kind === 'call' ? 'contacted' : current.status,
        lastContactAt: input.kind === 'call' ? new Date() : current.lastContactAt,
        followUpOn: input.followUpOn === undefined ? current.followUpOn : input.followUpOn,
        updatedAt: new Date(),
      })
      .where(eq(courseEnquiries.id, id));
    const next = input.followUpOn ? ` Next follow-up ${input.followUpOn}.` : input.followUpOn === null ? ' No follow-up set.' : '';
    await this.event(current, actor.id, input.kind, `${input.body}${next}`);
    return this.get(actor, id);
  }

  async bookTrial(actor: AuthUser, id: string, raw: z.input<typeof trialSchema>): Promise<EnquiryDetail> {
    this.assertWork(actor);
    const input = trialSchema.parse(raw);
    const tenantId = tenantOf(actor);
    const current = await this.find(tenantId, id);
    if (!OPEN_ENQUIRY.includes(current.status as EnquiryStatus)) throw new BadRequestException('This enquiry is closed. Reopen it first.');
    const [s] = await this.db
      .select({ s: classSessions, b: batches, courseName: courses.name })
      .from(classSessions)
      .innerJoin(batches, eq(batches.id, classSessions.batchId))
      .innerJoin(courses, eq(courses.id, batches.courseId))
      .where(and(eq(classSessions.id, input.sessionId), eq(classSessions.tenantId, tenantId)))
      .limit(1);
    if (!s) throw new NotFoundException('Class not found.');
    if (s.s.cancelled) throw new BadRequestException('That class is cancelled.');
    if (s.s.date < today()) throw new BadRequestException('That class has already happened.');
    if (s.b.status === 'completed' || s.b.status === 'cancelled') throw new BadRequestException(`${s.b.code} is ${s.b.status}.`);
    await this.db
      .update(courseEnquiries)
      .set({
        trialSessionId: s.s.id,
        trialOutcome: null,
        status: 'trial_booked',
        courseId: current.courseId ?? s.b.courseId,
        batchId: current.batchId ?? s.b.id,
        followUpOn: s.s.date,
        updatedAt: new Date(),
      })
      .where(eq(courseEnquiries.id, id));
    await this.event(current, actor.id, 'trial', `Trial class booked: ${s.courseName}, ${s.b.code}, ${s.s.date} ${s.s.startTime}-${s.s.endTime}.`);
    // The trainers expect a guest.
    const trainers = await this.db.select({ userId: batchTrainers.userId }).from(batchTrainers).where(eq(batchTrainers.batchId, s.b.id));
    await this.notifications.pushMany(
      trainers.map((t) => t.userId).filter((u) => u !== actor.id),
      { type: 'course_update', title: `Trial guest in ${s.b.code} on ${s.s.date}`, body: `${current.fullName} is sitting in on your class. Mark whether they came on the attendance sheet.`, link: `/desk/courses/sessions/${s.s.id}` },
    );
    return this.get(actor, id);
  }

  /** Whether the guest came. Enquiry staff, or a trainer of that class. */
  async trialOutcome(actor: AuthUser, id: string, raw: z.input<typeof trialOutcomeSchema>): Promise<EnquiryDetail> {
    const input = trialOutcomeSchema.parse(raw);
    const tenantId = tenantOf(actor);
    const current = await this.find(tenantId, id);
    if (!current.trialSessionId) throw new BadRequestException('No trial class is booked.');
    const [s] = await this.db.select().from(classSessions).where(eq(classSessions.id, current.trialSessionId)).limit(1);
    if (!s) throw new BadRequestException('No trial class is booked.');
    if (!staffCan(actor, 'course.enroll') && !staffCan(actor, 'course.manage')) await this.courses.assertTeaches(actor, s.batchId);
    if (s.date > today()) throw new BadRequestException('The trial class has not happened yet.');
    if (!OPEN_ENQUIRY.includes(current.status as EnquiryStatus)) throw new BadRequestException('This enquiry is closed.');
    await this.db
      .update(courseEnquiries)
      .set({
        trialOutcome: input.outcome,
        status: 'trial_done',
        // Strike while it is warm: tomorrow after a good class, today after a no-show.
        followUpOn: input.outcome === 'attended' ? addDays(today(), 1) : today(),
        updatedAt: new Date(),
      })
      .where(eq(courseEnquiries.id, id));
    await this.event(current, actor.id, 'trial', `Trial class on ${s.date}: ${TRIAL_OUTCOME_LABEL[input.outcome].toLowerCase()}.${input.note ? ` ${input.note}` : ''}`);
    if (current.assignedTo && current.assignedTo !== actor.id) {
      await this.tellAssignee(current, `${current.fullName}: trial class ${input.outcome === 'attended' ? 'attended' : 'missed'}`, input.outcome === 'attended' ? 'Follow up to enrol them.' : 'They did not come. Call to rebook.');
    }
    return this.get(actor, id);
  }

  async lose(actor: AuthUser, id: string, raw: z.input<typeof enquiryLostSchema>): Promise<EnquiryDetail> {
    this.assertWork(actor);
    const input = enquiryLostSchema.parse(raw);
    const current = await this.find(tenantOf(actor), id);
    if (current.status === 'enrolled') throw new BadRequestException('They enrolled. Drop the enrolment instead.');
    if (current.status === 'lost') throw new BadRequestException('Already closed.');
    await this.db.update(courseEnquiries).set({ status: 'lost', lostReason: input.reason, followUpOn: null, updatedAt: new Date() }).where(eq(courseEnquiries.id, id));
    await this.event(current, actor.id, 'lost', `Not joining: ${input.reason}`);
    await this.audit.record(actor, { action: 'enquiry.closed', entityType: 'enquiry', entityId: id, clientId: current.clientId, metadata: { number: current.number, reason: input.reason } });
    return this.get(actor, id);
  }

  async reopen(actor: AuthUser, id: string): Promise<EnquiryDetail> {
    this.assertWork(actor);
    const current = await this.find(tenantOf(actor), id);
    if (current.status !== 'lost') throw new BadRequestException('Only a closed enquiry can be reopened.');
    await this.db
      .update(courseEnquiries)
      .set({ status: current.lastContactAt ? 'contacted' : 'new', lostReason: null, followUpOn: today(), updatedAt: new Date() })
      .where(eq(courseEnquiries.id, id));
    await this.event(current, actor.id, 'reopened', 'Reopened.');
    return this.get(actor, id);
  }

  /**
   * They are joining: their client record (an existing one, one with the
   * same email, or a new course-only record), then the usual enrolment -
   * a seat or the waiting list, and the fees on an invoice.
   */
  async convert(actor: AuthUser, id: string, raw: ConvertEnquiryInput): Promise<{ enquiry: EnquiryDetail; enrollments: EnrollmentView[] }> {
    this.assertWork(actor);
    const input = convertEnquirySchema.parse(raw);
    const tenantId = tenantOf(actor);
    const current = await this.find(tenantId, id);
    if (current.status === 'enrolled') throw new BadRequestException('Already enrolled.');
    if (current.status === 'lost') throw new BadRequestException('This enquiry is closed. Reopen it first.');

    let clientId = current.clientId;
    const email = input.email ?? current.email;
    if (!clientId && email) {
      const [same] = await this.db
        .select({ id: clients.id })
        .from(clients)
        .where(and(eq(clients.tenantId, tenantId), eq(sql`lower(${clients.email})`, email.toLowerCase())))
        .limit(1);
      clientId = same?.id ?? null;
    }
    if (!clientId) {
      if (!email) throw new BadRequestException({ message: 'Their email is needed to make their student record and portal login.', fieldErrors: { email: 'Needed' } });
      const made = await this.clientsService.create(actor, {
        fullName: current.fullName,
        email,
        phone: current.phone,
        city: current.city ?? undefined,
        programme: input.programme,
        notes: current.studyAbroad ? 'Also interested in studying abroad (from their course enquiry).' : undefined,
      });
      clientId = made.id;
    }
    // Linked now, so a failed enrolment (no seat money, a closed batch) can simply be retried.
    await this.db.update(courseEnquiries).set({ clientId, email, updatedAt: new Date() }).where(eq(courseEnquiries.id, id));

    const made = await this.enrollments.enrol(actor, {
      clientId,
      batchIds: input.batchIds,
      targetScore: input.targetScore ?? (current.targetScore === null ? null : Number(current.targetScore)),
      invoice: input.invoice,
      packageId: input.packageId,
      discount: input.discount,
      discountReason: input.discountReason,
    });
    const first = made[0]!;
    await this.db
      .update(courseEnquiries)
      .set({ status: 'enrolled', enrollmentId: first.id, batchId: first.batchId, courseId: first.courseId, followUpOn: null, updatedAt: new Date() })
      .where(eq(courseEnquiries.id, id));
    const where = made.map((e) => `${e.courseName} (${e.batchCode}${e.status === 'waitlisted' ? ', waiting list' : ''})`).join(', ');
    await this.event(current, actor.id, 'enrolled', `Enrolled: ${where}.${first.invoiceNumber ? ` Fees on ${first.invoiceNumber}.` : ''}`);
    await this.audit.record(actor, { action: 'enquiry.enrolled', entityType: 'enquiry', entityId: id, clientId, metadata: { number: current.number, enrollments: made.map((e) => e.number) } });
    return { enquiry: await this.get(actor, id), enrollments: made };
  }

  /* ---------------------------------------------------------------- */
  /* The public form                                                   */
  /* ---------------------------------------------------------------- */

  async publicCourses(tenantId: string): Promise<PublicCoursesView> {
    const site = await tenantIdentity(this.db, tenantId);
    const list = await this.db.select().from(courses).where(and(eq(courses.tenantId, tenantId), eq(courses.active, true))).orderBy(asc(courses.name));
    const open = list.length
      ? await this.db
          .select({
            b: batches,
            seated: sql<number>`(select count(*)::int from enrollments e where e.batch_id = ${qualified('batches', 'id')} and e.status in ('enrolled', 'frozen'))`,
          })
          .from(batches)
          .where(and(inArray(batches.courseId, list.map((c) => c.id)), inArray(batches.status, ['planned', 'enrolling']), gte(batches.startDate, today())))
          .orderBy(asc(batches.startDate))
      : [];
    return {
      consultancy: site.name,
      courses: list.map((c) => ({
        id: c.id,
        name: c.name,
        testType: c.testType as TestType,
        mode: c.mode as CourseMode,
        durationWeeks: c.durationWeeks,
        batches: open
          .filter((o) => o.b.courseId === c.id)
          .map((o) => ({ id: o.b.id, code: o.b.code, startDate: o.b.startDate, days: o.b.days, startTime: o.b.startTime, endTime: o.b.endTime, seatsLeft: Math.max(0, o.b.capacity - o.seated) })),
      })),
    };
  }

  /* ---------------------------------------------------------------- */
  /* The daily reminder                                                */
  /* ---------------------------------------------------------------- */

  /** Each open enquiry's follow-up, to whoever has it, once on the day it falls due. */
  async remindFollowUps(): Promise<number> {
    const day = today();
    const due = await this.db
      .select()
      .from(courseEnquiries)
      .where(
        and(
          inArray(courseEnquiries.status, [...OPEN_ENQUIRY]),
          lte(courseEnquiries.followUpOn, day),
          sql`${courseEnquiries.assignedTo} is not null`,
          or(isNull(courseEnquiries.remindedOn), sql`${courseEnquiries.remindedOn} < ${courseEnquiries.followUpOn}`),
        ),
      )
      .limit(1000);
    for (const e of due) {
      await this.tellAssignee(e, `Follow up with ${e.fullName} today`, `Course enquiry ${e.number}, ${e.phone}.`);
      await this.db.update(courseEnquiries).set({ remindedOn: day }).where(eq(courseEnquiries.id, e.id));
    }
    return due.length;
  }

  /* ---------------------------------------------------------------- */
  /* Helpers                                                           */
  /* ---------------------------------------------------------------- */

  async find(tenantId: string, id: string): Promise<Row> {
    const [e] = await this.db.select().from(courseEnquiries).where(and(eq(courseEnquiries.id, id), eq(courseEnquiries.tenantId, tenantId))).limit(1);
    if (!e) throw new NotFoundException('Enquiry not found.');
    return e;
  }

  /** An open enquiry with this phone number (digits compared, so spacing and dashes do not matter). */
  private async openFor(tenantId: string, phone: string): Promise<Row | null> {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 7) return null;
    const [e] = await this.db
      .select()
      .from(courseEnquiries)
      .where(and(eq(courseEnquiries.tenantId, tenantId), inArray(courseEnquiries.status, [...OPEN_ENQUIRY]), sql`regexp_replace(${courseEnquiries.phone}, '[^0-9]', '', 'g') = ${digits}`))
      .limit(1);
    return e ?? null;
  }

  private async checkRefs(tenantId: string, input: { courseId?: string | null; batchId?: string | null }): Promise<void> {
    if (input.courseId) {
      const [c] = await this.db.select({ id: courses.id }).from(courses).where(and(eq(courses.id, input.courseId), eq(courses.tenantId, tenantId))).limit(1);
      if (!c) throw new BadRequestException({ message: 'That course does not exist.', fieldErrors: { courseId: 'Not found' } });
    }
    if (input.batchId) {
      const [b] = await this.db.select({ courseId: batches.courseId }).from(batches).where(and(eq(batches.id, input.batchId), eq(batches.tenantId, tenantId))).limit(1);
      if (!b) throw new BadRequestException({ message: 'That batch does not exist.', fieldErrors: { batchId: 'Not found' } });
      if (input.courseId && b.courseId !== input.courseId) throw new BadRequestException({ message: 'That batch is of another course.', fieldErrors: { batchId: 'Another course' } });
    }
  }

  private async assertStaff(tenantId: string, userId: string): Promise<void> {
    const [u] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId), eq(users.isActive, true), inArray(users.role, ['manager', 'consultant'])))
      .limit(1);
    if (!u) throw new BadRequestException({ message: 'Pick someone on the team.', fieldErrors: { assignedTo: 'Not on the team' } });
  }

  /** Staff who can be given an enquiry. */
  async staffOptions(actor: AuthUser): Promise<{ id: string; name: string }[]> {
    this.assertSee(actor);
    return this.db
      .select({ id: users.id, name: users.fullName })
      .from(users)
      .where(and(eq(users.tenantId, tenantOf(actor)), eq(users.isActive, true), inArray(users.role, ['manager', 'consultant'])))
      .orderBy(asc(users.fullName));
  }

  private async event(e: Pick<Row, 'id' | 'tenantId'>, by: string | null, kind: string, body: string): Promise<void> {
    await this.db.insert(courseEnquiryEvents).values({ tenantId: e.tenantId, enquiryId: e.id, kind, body, createdBy: by });
  }

  private async tellAssignee(e: Pick<Row, 'id' | 'assignedTo'>, title: string, body: string): Promise<void> {
    if (!e.assignedTo) return;
    await this.notifications.push({ userId: e.assignedTo, type: 'course_update', title, body, link: `/desk/courses/enquiries/${e.id}` });
  }

  async views(ids: string[]): Promise<EnquiryView[]> {
    if (!ids.length) return [];
    const day = today();
    const rows = await this.db
      .select({
        e: courseEnquiries,
        courseName: courses.name,
        wanted: { id: wantedBatch.id, code: wantedBatch.code, startDate: wantedBatch.startDate },
        assigneeName: assignee.fullName,
        creatorName: creator.fullName,
        trial: { date: trialSession.date, startTime: trialSession.startTime, endTime: trialSession.endTime, batchId: trialBatch.id, batchCode: trialBatch.code },
        client: { name: clients.fullName, programme: clients.programme },
        enrolled: { number: enrollments.number, batchCode: enrolledBatch.code },
      })
      .from(courseEnquiries)
      .leftJoin(courses, eq(courses.id, courseEnquiries.courseId))
      .leftJoin(wantedBatch, eq(wantedBatch.id, courseEnquiries.batchId))
      .leftJoin(assignee, eq(assignee.id, courseEnquiries.assignedTo))
      .leftJoin(creator, eq(creator.id, courseEnquiries.createdBy))
      .leftJoin(trialSession, eq(trialSession.id, courseEnquiries.trialSessionId))
      .leftJoin(trialBatch, eq(trialBatch.id, trialSession.batchId))
      .leftJoin(clients, eq(clients.id, courseEnquiries.clientId))
      .leftJoin(enrollments, eq(enrollments.id, courseEnquiries.enrollmentId))
      .leftJoin(enrolledBatch, eq(enrolledBatch.id, enrollments.batchId))
      .where(inArray(courseEnquiries.id, ids));
    const byId = new Map(rows.map((r) => [r.e.id, r]));
    return ids
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .map(({ e, courseName, wanted, assigneeName, creatorName, trial, client, enrolled }) => {
        const status = e.status as EnquiryStatus;
        return {
          id: e.id,
          number: e.number,
          fullName: e.fullName,
          phone: e.phone,
          email: e.email,
          city: e.city,
          course: e.courseId && courseName ? { id: e.courseId, name: courseName } : null,
          batch: wanted?.id ? { id: wanted.id, code: wanted.code, startDate: wanted.startDate } : null,
          source: (ENQUIRY_SOURCES as readonly string[]).includes(e.source) ? (e.source as EnquirySource) : 'other',
          status,
          studyAbroad: e.studyAbroad,
          targetScore: e.targetScore === null ? null : Number(e.targetScore),
          assignedTo: e.assignedTo ? { id: e.assignedTo, name: assigneeName ?? '' } : null,
          followUpOn: e.followUpOn,
          followUpDue: OPEN_ENQUIRY.includes(status) && Boolean(e.followUpOn && e.followUpOn <= day),
          trial:
            e.trialSessionId && trial?.date
              ? { sessionId: e.trialSessionId, batchId: trial.batchId!, batchCode: trial.batchCode!, date: trial.date, startTime: trial.startTime!, endTime: trial.endTime!, outcome: (e.trialOutcome as TrialOutcome | null) ?? null }
              : null,
          lostReason: e.lostReason,
          client: e.clientId && client?.name ? { id: e.clientId, name: client.name, programme: client.programme === 'course_only' ? 'course_only' : 'study_abroad' } : null,
          enrollment: e.enrollmentId && enrolled?.number ? { id: e.enrollmentId, number: enrolled.number, batchCode: enrolled.batchCode ?? '' } : null,
          notes: e.notes,
          lastContactAt: isoOrNull(e.lastContactAt),
          createdAt: iso(e.createdAt),
          createdByName: creatorName,
        };
      });
  }
}

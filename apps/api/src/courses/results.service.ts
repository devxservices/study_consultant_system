import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  TEST_SCALES,
  checkScore,
  eligibility,
  normaliseCountry,
  overallScore,
  resultExpiry,
  testResultSchema,
  type AuthUser,
  type LanguageRequirement,
  type MyCoursesView,
  type TestResultInput,
  type TestResultStatus,
  type TestResultView,
  type TestType,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { assessmentScores, assessments, cases, classSessions, clients, consultants, countries, enrollments, homework, testResults, users } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DocumentsService } from '../documents/documents.service';
import { ClientsService } from '../clients/clients.service';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { staffCan } from '../auth/permissions';
import { iso, today } from '../common/db-helpers';
import { CoursesService } from './courses.service';
import { EnrollmentsService } from './enrollments.service';
import { TeachingService } from './teaching.service';

type Upload = { buffer: Buffer; originalname: string; size: number };
type Row = typeof testResults.$inferSelect;

/** What a profile calls each test, for keeping it in step with results. */
const PROFILE_TEST: Partial<Record<TestType, string>> = {
  ielts_academic: 'ielts',
  ielts_general: 'ielts',
  pte_academic: 'pte',
  toefl_ibt: 'toefl',
  duolingo: 'duolingo',
  oet: 'oet',
};

/**
 * Official tests: bookings and results. A result keeps the student's profile
 * score up to date, files the score report as a document that expires when
 * the result does (two years after the test, which the document expiry
 * reminders then follow), and is checked against the language minimums of
 * the countries the student wants.
 */
@Injectable()
export class TestResultsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly documents: DocumentsService,
    private readonly clientsService: ClientsService,
    private readonly courses: CoursesService,
    private readonly enrollments: EnrollmentsService,
    private readonly teaching: TeachingService,
  ) {}

  async list(actor: AuthUser, q: { clientId?: string; status?: string; expiring?: boolean }): Promise<TestResultView[]> {
    let clientId = q.clientId;
    if (actor.role === 'client') clientId = actor.clientId ?? '00000000-0000-0000-0000-000000000000';
    else this.courses.assertView(actor);
    const tenantId = tenantOf(actor);
    const rows = await this.db
      .select({ id: testResults.id })
      .from(testResults)
      .where(
        and(
          eq(testResults.tenantId, tenantId),
          clientId ? eq(testResults.clientId, clientId) : undefined,
          q.status && q.status !== 'all' ? eq(testResults.status, q.status) : undefined,
          q.expiring ? and(eq(testResults.status, 'result'), sql`${testResults.expiresOn} between ${today()} and ${today()}::date + 90`) : undefined,
        ),
      )
      .orderBy(desc(testResults.testDate))
      .limit(300);
    return this.views(rows.map((r) => r.id));
  }

  async views(ids: string[]): Promise<TestResultView[]> {
    if (!ids.length) return [];
    const recorder = alias(users, 'recorder');
    const rows = await this.db
      .select({ r: testResults, clientName: clients.fullName, preferred: clients.preferredCountries, recordedByName: recorder.fullName })
      .from(testResults)
      .innerJoin(clients, eq(clients.id, testResults.clientId))
      .leftJoin(recorder, eq(recorder.id, testResults.recordedBy))
      .where(inArray(testResults.id, ids));
    if (!rows.length) return [];
    const tenantId = rows[0]!.r.tenantId;
    const [countryRows, caseCountries] = await Promise.all([
      this.db.select({ name: countries.name, requirements: countries.languageRequirements }).from(countries).where(and(eq(countries.tenantId, tenantId), eq(countries.active, true))),
      this.db
        .select({ clientId: cases.clientId, country: cases.targetCountry })
        .from(cases)
        .where(and(inArray(cases.clientId, [...new Set(rows.map((r) => r.r.clientId))]), inArray(cases.status, ['active', 'on_hold']))),
    ]);
    const byId = new Map(rows.map((r) => [r.r.id, r]));
    return ids
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .map(({ r, clientName, preferred, recordedByName }) => {
        const wanted = new Set([...(preferred ?? []), ...caseCountries.filter((c) => c.clientId === r.clientId).map((c) => c.country)].map((c) => normaliseCountry(c.toLowerCase())));
        const destinations = countryRows
          .filter((c) => wanted.has(normaliseCountry(c.name.toLowerCase())))
          .map((c) => ({ country: c.name, requirements: c.requirements as LanguageRequirement[] }));
        const overall = r.overall === null ? null : Number(r.overall);
        return {
          id: r.id,
          clientId: r.clientId,
          clientName,
          testType: r.testType as TestType,
          status: r.status as TestResultStatus,
          testDate: r.testDate,
          bookedOn: r.bookedOn,
          venue: r.venue,
          reference: r.reference,
          scores: r.scores,
          overall,
          expiresOn: r.expiresOn,
          expired: Boolean(r.expiresOn && r.expiresOn < today()),
          documentId: r.documentId,
          notes: r.notes,
          eligibility: r.status === 'result' ? eligibility(r.testType as TestType, overall, r.scores, destinations) : [],
          recordedByName,
          createdAt: iso(r.createdAt),
        };
      });
  }

  /**
   * Records a booking or a result. Recording one needs "Manage courses", or
   * "Enrol students" for a student one works with.
   */
  async save(actor: AuthUser, raw: TestResultInput, id?: string, file?: Upload): Promise<TestResultView> {
    const input = testResultSchema.parse(raw);
    const tenantId = tenantOf(actor);
    if (!staffCan(actor, 'course.manage')) {
      if (!staffCan(actor, 'course.enroll')) throw new ForbiddenException('You do not have permission to record test results.');
      await this.clientsService.findOne(actor, input.clientId);
    } else {
      const [c] = await this.db.select({ id: clients.id }).from(clients).where(and(eq(clients.id, input.clientId), eq(clients.tenantId, tenantId))).limit(1);
      if (!c) throw new NotFoundException('Student not found.');
    }
    let before: Row | null = null;
    if (id) {
      [before] = (await this.db.select().from(testResults).where(and(eq(testResults.id, id), eq(testResults.tenantId, tenantId))).limit(1)) as [Row];
      if (!before) throw new NotFoundException('Result not found.');
      if (before.clientId !== input.clientId) throw new BadRequestException('A result stays with its student.');
    }
    // Scores on the test's own scale, and the overall the test's way.
    const scale = TEST_SCALES[input.testType];
    const scores: Record<string, number | null> = {};
    const fieldErrors: Record<string, string> = {};
    for (const m of scale.modules) {
      const v = input.scores[m.key];
      scores[m.key] = v === undefined ? null : v;
      if (typeof v === 'number') {
        const problem = checkScore(input.testType, v);
        if (problem) fieldErrors[`scores.${m.key}`] = `${m.label}: ${problem}`;
      }
    }
    let overall = scale.overall === 'entered' || scale.overall === 'none' ? (input.overall ?? null) : overallScore(input.testType, scores);
    if (overall === null && input.overall !== null && input.overall !== undefined) overall = input.overall;
    if (overall !== null && scale.overall === 'entered') {
      const problem = checkScore(input.testType, overall);
      if (problem) fieldErrors.overall = `Overall: ${problem}`;
    }
    if (input.status === 'result' && overall === null && scale.overall !== 'none') fieldErrors.overall = 'The overall score';
    if (input.status === 'result' && input.testDate > today()) fieldErrors.testDate = 'A result is for a test already taken';
    if (Object.keys(fieldErrors).length) throw new BadRequestException({ message: Object.values(fieldErrors)[0], fieldErrors });
    const expiresOn = input.status === 'result' ? resultExpiry(input.testDate) : null;

    // The score report, filed with the student's documents (and expiring with the result).
    let documentId = before?.documentId ?? null;
    if (file) {
      const valid = await this.documents.accept(actor, file);
      const doc = await this.documents.store(actor, { clientId: input.clientId, typeKey: 'language_test', expiresOn, issuedOn: input.testDate, replacesId: documentId }, valid);
      documentId = doc.id;
    }
    const values = {
      clientId: input.clientId,
      testType: input.testType,
      status: input.status,
      testDate: input.testDate,
      bookedOn: input.bookedOn ?? null,
      venue: input.venue,
      reference: input.reference,
      scores,
      overall: overall === null ? null : String(overall),
      expiresOn,
      documentId,
      notes: input.notes,
      recordedBy: actor.id,
    };
    let saved: Row;
    if (id) [saved] = (await this.db.update(testResults).set({ ...values, updatedAt: new Date() }).where(eq(testResults.id, id)).returning()) as [Row];
    else [saved] = (await this.db.insert(testResults).values({ tenantId, ...values }).returning()) as [Row];

    if (input.status === 'result') {
      // The profile shows the latest result.
      const [latest] = await this.db.select().from(testResults).where(and(eq(testResults.clientId, input.clientId), eq(testResults.status, 'result'))).orderBy(desc(testResults.testDate)).limit(1);
      if (latest?.id === saved.id && PROFILE_TEST[input.testType]) {
        await this.db.update(clients).set({ englishTest: PROFILE_TEST[input.testType]!, englishScore: overall === null ? null : String(overall), englishTestDate: input.testDate, updatedAt: new Date() }).where(eq(clients.id, input.clientId));
      }
      if (documentId && expiresOn) {
        await this.db.execute(sql`update documents set expires_on = ${expiresOn}, issued_on = ${input.testDate} where id = ${documentId}`);
      }
    }
    await this.audit.record(actor, { action: 'test_result.saved', entityType: 'client', entityId: input.clientId, clientId: input.clientId, metadata: { test: input.testType, status: input.status, overall, testDate: input.testDate } });
    if (input.status === 'result' && before?.status !== 'result') {
      const [c] = await this.db.select({ userId: clients.userId, consultantUser: consultants.userId, name: clients.fullName }).from(clients).leftJoin(consultants, eq(consultants.id, clients.assignedConsultantId)).where(eq(clients.id, input.clientId));
      const title = `Test result recorded: ${overall ?? '-'} overall`;
      if (c?.userId) await this.notifications.push({ userId: c.userId, type: 'course_update', title, body: `Valid until ${expiresOn}.`, link: '/portal/courses' });
      if (c?.consultantUser && c.consultantUser !== actor.id) await this.notifications.push({ userId: c.consultantUser, type: 'course_update', title: `${c.name}: ${title.toLowerCase()}`, body: `Valid until ${expiresOn}.`, link: `/desk/clients/${input.clientId}` });
    }
    return (await this.views([saved.id]))[0]!;
  }

  /* ---------------------------------------------------------------- */
  /* The student's own view                                            */
  /* ---------------------------------------------------------------- */

  async mine(actor: AuthUser): Promise<MyCoursesView> {
    if (actor.role !== 'client' || !actor.clientId) throw new ForbiddenException();
    const clientId = actor.clientId;
    const rows = await this.db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(and(eq(enrollments.clientId, clientId), inArray(enrollments.status, ['waitlisted', 'enrolled', 'frozen', 'completed'])))
      .orderBy(desc(enrollments.createdAt));
    const views = await this.enrollments.views(rows.map((r) => r.id));
    const summaries = await this.courses.summaries([...new Set(views.map((v) => v.batchId))]);
    const out: MyCoursesView['enrollments'] = [];
    for (const v of views) {
      const b = summaries.find((s) => s.id === v.batchId)!;
      const [upcoming, hw, mocks] = await Promise.all([
        this.db
          .select({ date: classSessions.date, startTime: classSessions.startTime, endTime: classSessions.endTime, topic: classSessions.topic })
          .from(classSessions)
          .where(and(eq(classSessions.batchId, v.batchId), gte(classSessions.date, today()), eq(classSessions.cancelled, false)))
          .orderBy(asc(classSessions.date))
          .limit(5),
        v.status === 'waitlisted' ? Promise.resolve([]) : this.db.select({ id: homework.id }).from(homework).where(eq(homework.batchId, v.batchId)).orderBy(desc(homework.createdAt)),
        this.db
          .select({ title: assessments.title, heldOn: assessments.heldOn, scores: assessmentScores.scores, overall: assessmentScores.overall, feedback: assessmentScores.feedback })
          .from(assessmentScores)
          .innerJoin(assessments, eq(assessments.id, assessmentScores.assessmentId))
          .where(eq(assessmentScores.enrollmentId, v.id))
          .orderBy(asc(assessments.heldOn)),
      ]);
      const homeworkViews = await this.teaching.homeworkViews(hw.map((h) => h.id), true, v.id);
      out.push({
        ...v,
        batch: { days: b.days, startTime: b.startTime, endTime: b.endTime, location: b.location, onlineLink: b.onlineLink, startDate: b.startDate, endDate: b.endDate, trainers: b.trainers },
        upcoming: v.status === 'waitlisted' ? [] : upcoming,
        homework: homeworkViews.map(({ submissions, ...h }) => ({ ...h, mine: submissions[0] ?? null })),
        mocks: mocks.map((m) => ({ ...m, overall: m.overall === null ? null : Number(m.overall) })),
      });
    }
    return { enrollments: out, results: await this.list(actor, {}) };
  }
}

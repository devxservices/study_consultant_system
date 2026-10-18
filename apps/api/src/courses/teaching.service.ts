import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  localIsoDate,
  SEATED,
  TEST_SCALES,
  assessmentSchema,
  attendanceSchema,
  checkScore,
  gradeSchema,
  homeworkSchema,
  overallScore,
  scoresInputSchema,
  type AssessmentInput,
  type AssessmentKind,
  type AssessmentView,
  type AttendanceInput,
  type AttendanceSheet,
  type AttendanceStatus,
  type TrialOutcome,
  type AuthUser,
  type HomeworkInput,
  type HomeworkKind,
  type HomeworkSubmissionStatus,
  type HomeworkView,
  type ScoresInput,
  type SubmissionView,
  type TestType,
} from '@crm/shared';
import { z } from 'zod';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { assessmentScores, assessments, attendance, batches, classSessions, clients, courseEnquiries, courses, enrollments, homework, homeworkSubmissions, users } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DocumentsService } from '../documents/documents.service';
import { STORAGE, type StorageDriver } from '../storage/storage.driver';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { iso, isoOrNull } from '../common/db-helpers';
import { CoursesService } from './courses.service';
import { EnrollmentsService } from './enrollments.service';

type Upload = { buffer: Buffer; originalname: string; size: number };

/**
 * What happens in class: attendance session by session (with an alert to the
 * student's consultant when absences run on), mock tests scored part by part
 * on the test's own scale, and homework and materials with what students hand
 * in and the trainer's grade.
 */
@Injectable()
export class TeachingService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: StorageDriver,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly documents: DocumentsService,
    private readonly courses: CoursesService,
    private readonly enrollments: EnrollmentsService,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Attendance                                                        */
  /* ---------------------------------------------------------------- */

  async sheet(actor: AuthUser, sessionId: string): Promise<AttendanceSheet> {
    const s = await this.session(actor, sessionId);
    await this.assertReadsBatch(actor, s.batchId);
    const [[summary], marks, roster] = await Promise.all([
      this.courses.summaries([s.batchId]),
      this.db.select().from(attendance).where(eq(attendance.sessionId, sessionId)),
      this.db
        .select({ e: enrollments, name: clients.fullName })
        .from(enrollments)
        .innerJoin(clients, eq(clients.id, enrollments.clientId))
        .where(and(eq(enrollments.batchId, s.batchId), inArray(enrollments.status, ['enrolled', 'frozen', 'completed'])))
        .orderBy(asc(clients.fullName)),
    ]);
    const trials = await this.db
      .select({ enquiryId: courseEnquiries.id, number: courseEnquiries.number, fullName: courseEnquiries.fullName, phone: courseEnquiries.phone, outcome: courseEnquiries.trialOutcome })
      .from(courseEnquiries)
      .where(and(eq(courseEnquiries.trialSessionId, sessionId), eq(courseEnquiries.tenantId, tenantOf(actor))))
      .orderBy(asc(courseEnquiries.fullName));
    const [stats] = await this.courses.sessions(s.batchId).then((all) => all.filter((x) => x.id === sessionId));
    return {
      session: { ...stats!, batchId: s.batchId, batchCode: summary!.code, courseName: summary!.courseName },
      rows: roster.map(({ e, name }) => {
        const m = marks.find((x) => x.enrollmentId === e.id);
        const frozen = e.status === 'frozen' && Boolean(e.frozenFrom && e.frozenUntil && s.date >= e.frozenFrom && s.date <= e.frozenUntil);
        return { enrollmentId: e.id, clientName: name, status: (m?.status as AttendanceStatus | undefined) ?? null, note: m?.note ?? null, frozen };
      }),
      trials: trials.map((t) => ({ ...t, outcome: (t.outcome as TrialOutcome | null) ?? null })),
    };
  }

  async mark(actor: AuthUser, sessionId: string, raw: AttendanceInput): Promise<AttendanceSheet> {
    const input = attendanceSchema.parse(raw);
    const s = await this.session(actor, sessionId);
    await this.courses.assertTeaches(actor, s.batchId);
    if (s.cancelled) throw new BadRequestException('That session was cancelled.');
    if (s.date > localIsoDate()) throw new BadRequestException('That session has not happened yet.');
    const ids = input.marks.map((m) => m.enrollmentId);
    // Those in the batch now (or who finished it) - not someone who left or moved on.
    const mine = await this.db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(and(inArray(enrollments.id, ids), eq(enrollments.batchId, s.batchId), inArray(enrollments.status, ['enrolled', 'frozen', 'completed'])));
    if (mine.length !== new Set(ids).size) throw new BadRequestException('Someone on that list is not in this batch.');
    await this.db.transaction(async (tx) => {
      for (const m of input.marks) {
        await tx
          .insert(attendance)
          .values({ tenantId: s.tenantId, sessionId, enrollmentId: m.enrollmentId, status: m.status, note: m.note, markedBy: actor.id })
          .onConflictDoUpdate({ target: [attendance.sessionId, attendance.enrollmentId], set: { status: m.status, note: m.note, markedBy: actor.id, markedAt: new Date() } });
      }
    });
    await this.audit.record(actor, {
      action: 'attendance.marked',
      entityType: 'course',
      entityId: s.batchId,
      metadata: { session: s.date, present: input.marks.filter((m) => m.status === 'present' || m.status === 'late').length, absent: input.marks.filter((m) => m.status === 'absent').length },
    });
    await this.absenceAlerts(s.tenantId, s.batchId, input.marks.filter((m) => m.status === 'absent').map((m) => m.enrollmentId));
    return this.sheet(actor, sessionId);
  }

  /**
   * Absences in a row: at the consultancy's threshold the student's
   * consultant (and the student) hear about it - once per run of absences.
   */
  private async absenceAlerts(tenantId: string, batchId: string, absentIds: string[]): Promise<void> {
    if (!absentIds.length) return;
    const { absenceAlertAfter } = await this.courses.settings(tenantId);
    const [b] = await this.db.select({ code: batches.code }).from(batches).where(eq(batches.id, batchId));
    for (const enrollmentId of absentIds) {
      const recent = await this.db
        .select({ status: attendance.status, date: classSessions.date })
        .from(attendance)
        .innerJoin(classSessions, eq(classSessions.id, attendance.sessionId))
        .where(and(eq(attendance.enrollmentId, enrollmentId), ne(attendance.status, 'excused')))
        .orderBy(desc(classSessions.date), desc(classSessions.startTime))
        .limit(absenceAlertAfter + 1);
      let streak = 0;
      for (const r of recent) {
        if (r.status !== 'absent') break;
        streak++;
      }
      if (streak !== absenceAlertAfter) continue;
      const [e] = await this.db.update(enrollments).set({ absenceAlertedAt: new Date() }).where(eq(enrollments.id, enrollmentId)).returning({ clientId: enrollments.clientId });
      await this.enrollments.tellConsultant(e!.clientId, `missed ${streak} classes in a row`, `${b!.code}: absent from the last ${streak} sessions.`, 'absence_alert', true);
      await this.enrollments.tellStudent(e!.clientId, `We missed you in class`, `You have been absent from the last ${streak} sessions of ${b!.code}. Let your trainer know if something is wrong.`);
    }
  }

  private async session(actor: AuthUser, sessionId: string) {
    const [s] = await this.db.select().from(classSessions).where(and(eq(classSessions.id, sessionId), eq(classSessions.tenantId, tenantOf(actor)))).limit(1);
    if (!s) throw new NotFoundException('Session not found.');
    return s;
  }

  /** "See courses", or teaching this batch. */
  private async assertReadsBatch(actor: AuthUser, batchId: string): Promise<void> {
    this.courses.assertView(actor);
    const [b] = await this.db.select({ id: batches.id }).from(batches).where(and(eq(batches.id, batchId), eq(batches.tenantId, tenantOf(actor)))).limit(1);
    if (!b) throw new NotFoundException('Batch not found.');
    if (actor.role === 'manager') return;
    const canView = (actor.permissions ?? []).includes('course.view');
    if (!canView) await this.courses.assertTeaches(actor, batchId);
  }

  /* ---------------------------------------------------------------- */
  /* Mock tests                                                        */
  /* ---------------------------------------------------------------- */

  async assessments(actor: AuthUser, batchId: string): Promise<AssessmentView[]> {
    await this.assertReadsBatch(actor, batchId);
    const list = await this.db.select().from(assessments).where(eq(assessments.batchId, batchId)).orderBy(asc(assessments.heldOn));
    return this.assessmentViews(list.map((a) => a.id));
  }

  private async assessmentViews(ids: string[]): Promise<AssessmentView[]> {
    if (!ids.length) return [];
    const [list, scores] = await Promise.all([
      this.db.select({ a: assessments, testType: courses.testType }).from(assessments).innerJoin(batches, eq(batches.id, assessments.batchId)).innerJoin(courses, eq(courses.id, batches.courseId)).where(inArray(assessments.id, ids)),
      this.db
        .select({ s: assessmentScores, name: clients.fullName })
        .from(assessmentScores)
        .innerJoin(enrollments, eq(enrollments.id, assessmentScores.enrollmentId))
        .innerJoin(clients, eq(clients.id, enrollments.clientId))
        .where(inArray(assessmentScores.assessmentId, ids))
        .orderBy(asc(clients.fullName)),
    ]);
    const byId = new Map(list.map((r) => [r.a.id, r]));
    return ids
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .map(({ a, testType }) => {
        const mine = scores.filter((s) => s.s.assessmentId === a.id);
        const overalls = mine.map((s) => s.s.overall).filter((o): o is string => o !== null).map(Number);
        return {
          id: a.id,
          batchId: a.batchId,
          title: a.title,
          kind: a.kind as AssessmentKind,
          heldOn: a.heldOn,
          testType: testType as TestType,
          scores: mine.map((s) => ({ enrollmentId: s.s.enrollmentId, clientName: s.name, scores: s.s.scores, overall: s.s.overall === null ? null : Number(s.s.overall), feedback: s.s.feedback })),
          average: overalls.length ? Math.round((overalls.reduce((x, y) => x + y, 0) / overalls.length) * 100) / 100 : null,
        };
      });
  }

  async addAssessment(actor: AuthUser, batchId: string, raw: AssessmentInput): Promise<AssessmentView[]> {
    const input = assessmentSchema.parse(raw);
    const b = await this.courses.assertTeaches(actor, batchId);
    await this.db.insert(assessments).values({ tenantId: b.tenantId, batchId, ...input, createdBy: actor.id });
    await this.audit.record(actor, { action: 'assessment.saved', entityType: 'course', entityId: b.courseId, metadata: { batch: b.code, title: input.title, kind: input.kind, heldOn: input.heldOn } });
    return this.assessments(actor, batchId);
  }

  /** Scores part by part on the test's own scale; the overall worked out the test's way (or entered, for tests that report their own). */
  async recordScores(actor: AuthUser, assessmentId: string, raw: ScoresInput): Promise<AssessmentView> {
    const input = scoresInputSchema.parse(raw);
    const [a] = await this.db.select().from(assessments).where(and(eq(assessments.id, assessmentId), eq(assessments.tenantId, tenantOf(actor)))).limit(1);
    if (!a) throw new NotFoundException('Mock test not found.');
    const b = await this.courses.assertTeaches(actor, a.batchId);
    const [course] = await this.db.select({ testType: courses.testType }).from(courses).where(eq(courses.id, b.courseId));
    const test = course!.testType as TestType;
    const scale = TEST_SCALES[test];
    const keys = scale.modules.map((m) => m.key);
    const fieldErrors: Record<string, string> = {};
    const rows = input.scores.map((s, i) => {
      const clean: Record<string, number | null> = {};
      for (const k of keys) {
        const v = s.scores[k];
        if (v === null || v === undefined) {
          clean[k] = null;
          continue;
        }
        const problem = checkScore(test, v);
        if (problem) fieldErrors[`scores.${i}.${k}`] = `${scale.modules.find((m) => m.key === k)!.label}: ${problem}`;
        clean[k] = v;
      }
      for (const k of Object.keys(s.scores)) if (!keys.includes(k)) fieldErrors[`scores.${i}.${k}`] = `${k} is not part of this test`;
      const worked = overallScore(test, clean);
      const overall = scale.overall === 'entered' ? (s.overall ?? null) : worked;
      if (overall !== null && scale.overall === 'entered') {
        const problem = checkScore(test, overall);
        if (problem) fieldErrors[`scores.${i}.overall`] = `Overall: ${problem}`;
      }
      return { enrollmentId: s.enrollmentId, scores: clean, overall, feedback: s.feedback };
    });
    if (Object.keys(fieldErrors).length) throw new BadRequestException({ message: Object.values(fieldErrors)[0], fieldErrors });
    const ids = rows.map((r) => r.enrollmentId);
    const inBatch = await this.db.select({ id: enrollments.id }).from(enrollments).where(and(inArray(enrollments.id, ids), eq(enrollments.batchId, a.batchId)));
    if (inBatch.length !== new Set(ids).size) throw new BadRequestException('Someone on that list is not in this batch.');
    await this.db.transaction(async (tx) => {
      for (const r of rows) {
        await tx
          .insert(assessmentScores)
          .values({ tenantId: a.tenantId, assessmentId, enrollmentId: r.enrollmentId, scores: r.scores, overall: r.overall === null ? null : String(r.overall), feedback: r.feedback, recordedBy: actor.id })
          .onConflictDoUpdate({
            target: [assessmentScores.assessmentId, assessmentScores.enrollmentId],
            set: { scores: r.scores, overall: r.overall === null ? null : String(r.overall), feedback: r.feedback, recordedBy: actor.id, recordedAt: new Date() },
          });
      }
    });
    await this.audit.record(actor, { action: 'scores.recorded', entityType: 'course', entityId: b.courseId, metadata: { batch: b.code, assessment: a.title, students: rows.length } });
    return (await this.assessmentViews([assessmentId]))[0]!;
  }

  /* ---------------------------------------------------------------- */
  /* Homework and materials                                            */
  /* ---------------------------------------------------------------- */

  async homeworkList(actor: AuthUser, batchId: string): Promise<HomeworkView[]> {
    await this.assertReadsBatch(actor, batchId);
    const rows = await this.db.select({ id: homework.id }).from(homework).where(eq(homework.batchId, batchId)).orderBy(desc(homework.createdAt));
    return this.homeworkViews(rows.map((r) => r.id), true);
  }

  async homeworkViews(ids: string[], withSubmissions: boolean, onlyEnrollment?: string): Promise<HomeworkView[]> {
    if (!ids.length) return [];
    const creator = alias(users, 'creator');
    const grader = alias(users, 'grader');
    const [list, subs] = await Promise.all([
      this.db.select({ h: homework, createdByName: creator.fullName }).from(homework).leftJoin(creator, eq(creator.id, homework.createdBy)).where(inArray(homework.id, ids)),
      this.db
        .select({ s: homeworkSubmissions, name: clients.fullName, gradedByName: grader.fullName })
        .from(homeworkSubmissions)
        .innerJoin(enrollments, eq(enrollments.id, homeworkSubmissions.enrollmentId))
        .innerJoin(clients, eq(clients.id, enrollments.clientId))
        .leftJoin(grader, eq(grader.id, homeworkSubmissions.gradedBy))
        .where(and(inArray(homeworkSubmissions.homeworkId, ids), onlyEnrollment ? eq(homeworkSubmissions.enrollmentId, onlyEnrollment) : undefined))
        .orderBy(asc(clients.fullName)),
    ]);
    const byId = new Map(list.map((r) => [r.h.id, r]));
    return ids
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .map(({ h, createdByName }) => {
        const mine = subs.filter((s) => s.s.homeworkId === h.id);
        return {
          id: h.id,
          batchId: h.batchId,
          kind: h.kind as HomeworkKind,
          title: h.title,
          instructions: h.instructions,
          dueAt: isoOrNull(h.dueAt),
          maxScore: h.maxScore === null ? null : Number(h.maxScore),
          fileName: h.fileName,
          createdByName,
          createdAt: iso(h.createdAt),
          submitted: mine.length,
          graded: mine.filter((s) => s.s.status === 'graded').length,
          submissions: withSubmissions ? mine.map((s) => this.submissionView(s.s, s.name, s.gradedByName, h.dueAt)) : [],
        };
      });
  }

  private submissionView(s: typeof homeworkSubmissions.$inferSelect, clientName: string, gradedByName: string | null, dueAt: Date | null): SubmissionView {
    return {
      id: s.id,
      enrollmentId: s.enrollmentId,
      clientName,
      text: s.text,
      fileName: s.fileName,
      submittedAt: iso(s.submittedAt),
      late: Boolean(dueAt && s.submittedAt > dueAt),
      status: s.status as HomeworkSubmissionStatus,
      score: s.score === null ? null : Number(s.score),
      feedback: s.feedback,
      gradedByName,
    };
  }

  async addHomework(actor: AuthUser, batchId: string, raw: HomeworkInput, file?: Upload): Promise<HomeworkView[]> {
    const input = homeworkSchema.parse(raw);
    const b = await this.courses.assertTeaches(actor, batchId);
    let stored: { key: string; name: string; mime: string } | null = null;
    if (file) {
      const valid = await this.documents.accept(actor, file);
      const key = `tenants/${b.tenantId}/courses/${batchId}/${randomUUID()}`;
      await this.storage.put(key, valid.buffer, valid.mimeType);
      stored = { key, name: valid.fileName, mime: valid.mimeType };
    }
    if (input.kind === 'material' && !stored && !input.instructions) throw new BadRequestException('A material needs a file or some text.');
    await this.db.insert(homework).values({
      tenantId: b.tenantId,
      batchId,
      kind: input.kind,
      title: input.title,
      instructions: input.instructions,
      dueAt: input.kind === 'homework' && input.dueAt ? new Date(input.dueAt) : null,
      maxScore: input.kind === 'homework' && input.maxScore ? String(input.maxScore) : null,
      fileKey: stored?.key ?? null,
      fileName: stored?.name ?? null,
      fileMime: stored?.mime ?? null,
      createdBy: actor.id,
    });
    await this.audit.record(actor, { action: 'homework.saved', entityType: 'homework', entityId: batchId, metadata: { batch: b.code, title: input.title, kind: input.kind } });
    // Everyone in the batch hears about new homework.
    if (input.kind === 'homework') {
      const students = await this.db
        .select({ userId: clients.userId })
        .from(enrollments)
        .innerJoin(clients, eq(clients.id, enrollments.clientId))
        .where(and(eq(enrollments.batchId, batchId), eq(enrollments.status, 'enrolled')));
      await this.notifications.pushMany(
        students.map((s) => s.userId).filter((u): u is string => Boolean(u)),
        { type: 'homework_update', title: `New homework: ${input.title}`, body: input.dueAt ? `Due ${new Date(input.dueAt).toUTCString().slice(0, 16)}.` : b.code, link: '/portal/courses' },
      );
    }
    return this.homeworkList(actor, batchId);
  }

  async homeworkFile(actor: AuthUser, homeworkId: string): Promise<{ stream: Readable; name: string; mime: string }> {
    const [h] = await this.db.select().from(homework).where(and(eq(homework.id, homeworkId), eq(homework.tenantId, tenantOf(actor)))).limit(1);
    if (!h?.fileKey) throw new NotFoundException('No file.');
    if (actor.role === 'client') await this.myEnrollment(actor, h.batchId);
    else await this.assertReadsBatch(actor, h.batchId);
    return { stream: await this.storage.get(h.fileKey), name: h.fileName ?? 'file', mime: h.fileMime ?? 'application/octet-stream' };
  }

  /** The student hands it in (again, if it was returned). */
  async submit(actor: AuthUser, homeworkId: string, raw: { text?: string | null }, file?: Upload): Promise<SubmissionView> {
    if (actor.role !== 'client') throw new ForbiddenException('Students hand in homework.');
    const [h] = await this.db.select().from(homework).where(and(eq(homework.id, homeworkId), eq(homework.tenantId, tenantOf(actor)))).limit(1);
    if (!h || h.kind !== 'homework') throw new NotFoundException('Homework not found.');
    const e = await this.myEnrollment(actor, h.batchId);
    const text = z.string().trim().max(20_000).optional().nullable().parse(raw.text) || null;
    if (!text && !file) throw new BadRequestException('Write your answer or attach a file.');
    const [existing] = await this.db.select().from(homeworkSubmissions).where(and(eq(homeworkSubmissions.homeworkId, homeworkId), eq(homeworkSubmissions.enrollmentId, e.id))).limit(1);
    if (existing && existing.status === 'graded') throw new BadRequestException('It has been graded already.');
    let stored: { key: string; name: string; mime: string } | null = null;
    if (file) {
      const valid = await this.documents.accept(actor, file);
      const key = `tenants/${h.tenantId}/courses/${h.batchId}/submissions/${randomUUID()}`;
      await this.storage.put(key, valid.buffer, valid.mimeType);
      stored = { key, name: valid.fileName, mime: valid.mimeType };
    }
    const values = { text, fileKey: stored?.key ?? existing?.fileKey ?? null, fileName: stored?.name ?? existing?.fileName ?? null, fileMime: stored?.mime ?? existing?.fileMime ?? null, submittedAt: new Date(), status: 'submitted' };
    if (existing) await this.db.update(homeworkSubmissions).set(values).where(eq(homeworkSubmissions.id, existing.id));
    else await this.db.insert(homeworkSubmissions).values({ tenantId: h.tenantId, homeworkId, enrollmentId: e.id, ...values });
    await this.audit.record(actor, { action: 'homework.submitted', entityType: 'homework', entityId: homeworkId, clientId: e.clientId, metadata: { title: h.title } });
    const trainers = await this.db.execute<{ user_id: string }>(sql`select user_id from batch_trainers where batch_id = ${h.batchId}`);
    const ids = ((trainers as unknown as { rows?: { user_id: string }[] }).rows ?? (trainers as unknown as { user_id: string }[])).map((t) => t.user_id);
    await this.notifications.pushMany(ids, { type: 'homework_update', title: `${actor.fullName} handed in “${h.title}”`, body: null, link: `/desk/courses/batches/${h.batchId}?tab=homework` });
    const [s] = await this.db.select({ s: homeworkSubmissions }).from(homeworkSubmissions).where(and(eq(homeworkSubmissions.homeworkId, homeworkId), eq(homeworkSubmissions.enrollmentId, e.id)));
    return this.submissionView(s!.s, actor.fullName, null, h.dueAt);
  }

  async grade(actor: AuthUser, submissionId: string, raw: z.input<typeof gradeSchema>): Promise<HomeworkView> {
    const input = gradeSchema.parse(raw);
    const [s] = await this.db
      .select({ s: homeworkSubmissions, h: homework })
      .from(homeworkSubmissions)
      .innerJoin(homework, eq(homework.id, homeworkSubmissions.homeworkId))
      .where(and(eq(homeworkSubmissions.id, submissionId), eq(homeworkSubmissions.tenantId, tenantOf(actor))))
      .limit(1);
    if (!s) throw new NotFoundException('Submission not found.');
    await this.courses.assertTeaches(actor, s.h.batchId);
    if (input.score !== null && input.score !== undefined && s.h.maxScore !== null && input.score > Number(s.h.maxScore)) {
      throw new BadRequestException({ message: `Out of ${Number(s.h.maxScore)}.`, fieldErrors: { score: 'Too high' } });
    }
    if (input.returned && !input.feedback) throw new BadRequestException({ message: 'Say what to do again.', fieldErrors: { feedback: 'Why it is going back' } });
    await this.db
      .update(homeworkSubmissions)
      .set({ status: input.returned ? 'returned' : 'graded', score: input.score === null || input.score === undefined ? null : String(input.score), feedback: input.feedback, gradedBy: actor.id, gradedAt: new Date() })
      .where(eq(homeworkSubmissions.id, submissionId));
    const [e] = await this.db.select({ clientId: enrollments.clientId }).from(enrollments).where(eq(enrollments.id, s.s.enrollmentId));
    await this.audit.record(actor, { action: 'homework.graded', entityType: 'homework', entityId: s.h.id, clientId: e!.clientId, metadata: { title: s.h.title, score: input.score, returned: input.returned } });
    await this.enrollments.tellStudent(e!.clientId, input.returned ? `“${s.h.title}” came back to you` : `“${s.h.title}” has been marked`, input.feedback ?? (input.score !== null && input.score !== undefined ? `Score: ${input.score}` : ''));
    return (await this.homeworkViews([s.h.id], true))[0]!;
  }

  async submissionFile(actor: AuthUser, submissionId: string): Promise<{ stream: Readable; name: string; mime: string }> {
    const [s] = await this.db
      .select({ s: homeworkSubmissions, batchId: homework.batchId, clientId: enrollments.clientId })
      .from(homeworkSubmissions)
      .innerJoin(homework, eq(homework.id, homeworkSubmissions.homeworkId))
      .innerJoin(enrollments, eq(enrollments.id, homeworkSubmissions.enrollmentId))
      .where(and(eq(homeworkSubmissions.id, submissionId), eq(homeworkSubmissions.tenantId, tenantOf(actor))))
      .limit(1);
    if (!s?.s.fileKey) throw new NotFoundException('No file.');
    if (actor.role === 'client') {
      if (actor.clientId !== s.clientId) throw new NotFoundException('No file.');
    } else await this.assertReadsBatch(actor, s.batchId);
    return { stream: await this.storage.get(s.s.fileKey), name: s.s.fileName ?? 'file', mime: s.s.fileMime ?? 'application/octet-stream' };
  }

  /** The student's place in a batch (enrolled, paused or finished) - their access to its homework. */
  async myEnrollment(actor: AuthUser, batchId: string) {
    const [e] = await this.db
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.batchId, batchId), eq(enrollments.clientId, actor.clientId ?? '00000000-0000-0000-0000-000000000000'), inArray(enrollments.status, [...SEATED, 'completed'])))
      .limit(1);
    if (!e) throw new NotFoundException('Not found.');
    return e;
  }
}

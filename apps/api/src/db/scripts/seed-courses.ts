import { and, asc, eq, sql } from 'drizzle-orm';
import { overallScore, resultExpiry, sessionDates } from '@crm/shared';
import type { Db } from '../connection';
import {
  assessmentScores,
  assessments,
  attendance,
  batchTrainers,
  batches,
  classSessions,
  clients,
  courses,
  enrollments,
  homework,
  homeworkSubmissions,
  invoiceItems,
  invoices,
  servicePackages,
  testResults,
  userPermissions,
  users,
} from '../schema';
import { postInvoice } from '../../finance/journal';

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/**
 * Demo courses for a consultancy that has none: IELTS, PTE and spoken
 * English, a bundle price in the fee catalogue, a running IELTS batch (with a
 * waiting list, attendance, three mock tests with improving scores, homework
 * handed in and marked), a running PTE batch, one coming up, and a finished
 * spoken English batch with certificates. Fees are invoiced and booked as
 * course income exactly as the app does it. A few students have official
 * results. Safe to re-run: it does nothing where courses exist.
 */
export async function seedCourses(db: Db, tenantId: string): Promise<{ courses: number; enrollments: number; results: number }> {
  const none = { courses: 0, enrollments: 0, results: 0 };
  const [has] = await db.select({ n: sql<number>`count(*)::int` }).from(courses).where(eq(courses.tenantId, tenantId));
  if ((has?.n ?? 0) > 0) return none;
  const [manager] = await db.select({ id: users.id }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.role, 'manager'))).limit(1);
  const staff = await db.select({ id: users.id }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.role, 'consultant'), eq(users.isActive, true))).orderBy(asc(users.createdAt)).limit(2);
  const people = await db.select({ id: clients.id, name: clients.fullName }).from(clients).where(and(eq(clients.tenantId, tenantId), eq(clients.archived, false))).orderBy(asc(clients.createdAt)).limit(20);
  if (!manager || people.length < 8) return none;
  const by = manager.id;
  // The first consultant also teaches.
  const trainer = staff[0]?.id ?? by;
  if (staff[0]) await db.insert(userPermissions).values({ tenantId, userId: staff[0].id, permission: 'course.teach', effect: 'allow' }).onConflictDoNothing();

  /* ---------------- The catalogue ---------------- */
  const [bundle] = await db
    .insert(servicePackages)
    .values({ tenantId, name: 'IELTS + Spoken English bundle', description: 'Both courses together at a lower price.', amount: 42_000_00, currency: 'PKR', category: 'course' })
    .returning();
  const mk = async (v: Partial<typeof courses.$inferInsert> & { code: string; name: string }) => (await db.insert(courses).values({ tenantId, currency: 'PKR', createdBy: by, ...v }).returning())[0]!;
  const ieltsC = await mk({ code: 'IELTS-A', name: 'IELTS Academic preparation', testType: 'ielts_academic', level: 'any', mode: 'hybrid', durationWeeks: 6, hoursPerWeek: 600, fee: 35_000_00, capacity: 8, description: 'Six weeks of all four skills, three full mock tests under exam conditions, and one-to-one speaking practice.' });
  const pteC = await mk({ code: 'PTE-A', name: 'PTE Academic preparation', testType: 'pte_academic', mode: 'in_person', durationWeeks: 4, hoursPerWeek: 800, fee: 40_000_00, capacity: 10, description: 'Computer-based practice on the real question types, with scored mock tests.' });
  const spokenC = await mk({ code: 'SPOKEN', name: 'Spoken English', testType: 'none', mode: 'in_person', durationWeeks: 6, hoursPerWeek: 400, fee: 15_000_00, capacity: 12, description: 'Everyday and interview English for students about to travel.' });
  void bundle;

  /* ---------------- Batches and their sessions ---------------- */
  const mkBatch = async (courseId: string, code: string, from: string, to: string, daysOfWeek: number[], start: string, end: string, capacity: number, status: string, location: string | null, link: string | null) => {
    const [b] = await db.insert(batches).values({ tenantId, courseId, code, startDate: from, endDate: to, days: daysOfWeek, startTime: start, endTime: end, capacity, status, location, onlineLink: link, createdBy: by }).returning();
    const dates = sessionDates(from, to, daysOfWeek);
    const topics = ['Diagnostic and test format', 'Listening: section 1-2', 'Reading: skimming and scanning', 'Writing task 1: describing data', 'Speaking part 2', 'Writing task 2: opinion essays', 'Listening: maps and plans', 'Reading: matching headings', 'Speaking part 3'];
    if (dates.length) await db.insert(classSessions).values(dates.map((date, i) => ({ tenantId, batchId: b!.id, date, startTime: start, endTime: end, topic: topics[i] ?? (i === dates.length - 1 ? 'Final mock test and review' : 'Practice test and feedback') })));
    await db.insert(batchTrainers).values({ tenantId, batchId: b!.id, userId: trainer });
    return b!;
  };
  const ielts = await mkBatch(ieltsC.id, `IELTS-${monthCode(day(-21))}-EVE`, day(-21), day(21), [1, 3, 5], '18:00', '20:00', 8, 'running', 'Room 2, Gulberg office', 'https://meet.example.com/ielts-evening');
  const ieltsNext = await mkBatch(ieltsC.id, `IELTS-${monthCode(day(14))}-MOR`, day(14), day(56), [2, 4, 6], '10:00', '12:00', 8, 'enrolling', 'Room 1, Gulberg office', null);
  const pte = await mkBatch(pteC.id, `PTE-${monthCode(day(-10))}-WKD`, day(-10), day(18), [0, 6], '11:00', '15:00', 10, 'running', 'PTE lab', null);
  const spoken = await mkBatch(spokenC.id, `SPOKEN-${monthCode(day(-60))}`, day(-60), day(-12), [2, 4], '17:00', '18:30', 12, 'completed', 'Room 3', null);

  /* ---------------- Enrolments, billed as course income ---------------- */
  let invSeq = await nextInvoiceSeq(db, tenantId);
  let enrSeq = 0;
  const year = new Date().getFullYear();
  const bill = async (clientId: string, description: string, amount: number, issueDate: string, packageId: string | null = null) => {
    const number = `INV-${issueDate.slice(0, 4)}-${String(invSeq++).padStart(4, '0')}`;
    return db.transaction(async (tx) => {
      const [inv] = await tx.insert(invoices).values({ tenantId, number, clientId, currency: 'PKR', issueDate, dueDate: day(10), total: amount, subtotal: amount, fxRate: '1', createdBy: by, notes: 'Course fees.' }).returning();
      await tx.insert(invoiceItems).values({ tenantId, invoiceId: inv!.id, description, quantity: 1, unitAmount: amount, amount, lineTotal: amount, position: 0, category: 'course', packageId });
      await postInvoice(tx, { ...inv!, items: [{ category: 'course', amount, discount: 0, taxAmount: 0, taxInclusive: false }] }, by);
      return inv!.id;
    });
  };
  const enrol = async (batchId: string, clientId: string, status: string, invoiceId: string | null, extra: Partial<typeof enrollments.$inferInsert> = {}) => {
    enrSeq++;
    const [e] = await db
      .insert(enrollments)
      .values({ tenantId, number: `ENR-${year}-${String(enrSeq).padStart(4, '0')}`, batchId, clientId, status, invoiceId, createdBy: by, waitlistedAt: status === 'waitlisted' ? new Date() : null, ...extra })
      .returning();
    return e!;
  };
  // IELTS evening: eight seats, nine students - the ninth waits.
  const ieltsPeople = people.slice(0, 9);
  const ieltsEnr: (typeof enrollments.$inferSelect)[] = [];
  for (const [i, p] of ieltsPeople.entries()) {
    const seat = i < 8;
    const inv = seat ? (i === 0 ? await bill(p.id, `IELTS + Spoken English bundle: ${ieltsC.name} (${ielts.code}), ${spokenC.name}`, bundle!.amount, day(-25), bundle!.id) : await bill(p.id, `${ieltsC.name} (${ielts.code}, ${ielts.startDate} to ${ielts.endDate})`, ieltsC.fee, day(-24))) : null;
    ieltsEnr.push(await enrol(ielts.id, p.id, seat ? 'enrolled' : 'waitlisted', inv, { targetScore: String([6.5, 7, 6, 7.5, 6.5, 7, 6, 6.5][i % 8]) }));
  }
  // One is away for a family wedding.
  await db.update(enrollments).set({ status: 'frozen', frozenFrom: day(-3), frozenUntil: day(7), freezeReason: 'Family wedding in Faisalabad' }).where(eq(enrollments.id, ieltsEnr[5]!.id));
  const pteEnr: (typeof enrollments.$inferSelect)[] = [];
  for (const p of people.slice(9, 13)) pteEnr.push(await enrol(pte.id, p.id, 'enrolled', await bill(p.id, `${pteC.name} (${pte.code})`, pteC.fee, day(-12)), { targetScore: '65' }));
  for (const p of people.slice(13, 16)) await enrol(ieltsNext.id, p.id, 'enrolled', await bill(p.id, `${ieltsC.name} (${ieltsNext.code})`, ieltsC.fee, day(-1)), { targetScore: '7' });
  // Spoken English finished: certificates for those who came often enough.
  const spokenEnr: (typeof enrollments.$inferSelect)[] = [];
  for (const [i, p] of [people[0]!, ...people.slice(16, 20)].entries()) {
    spokenEnr.push(await enrol(spoken.id, p.id, 'completed', i === 0 ? ieltsEnr[0]!.invoiceId : await bill(p.id, `${spokenC.name} (${spoken.code})`, spokenC.fee, day(-62)), { completedAt: new Date(Date.now() - 12 * 86_400_000) }));
  }

  /* ---------------- Attendance ---------------- */
  const mark = async (batchId: string, list: (typeof enrollments.$inferSelect)[], pattern: (student: number, session: number, total: number) => string | null) => {
    const sessions = await db.select().from(classSessions).where(and(eq(classSessions.batchId, batchId), sql`${classSessions.date} <= ${day(0)}`)).orderBy(asc(classSessions.date));
    const rows: (typeof attendance.$inferInsert)[] = [];
    sessions.forEach((s, j) =>
      list.forEach((e, i) => {
        const status = pattern(i, j, sessions.length);
        if (status) rows.push({ tenantId, sessionId: s.id, enrollmentId: e.id, status, markedBy: trainer, markedAt: new Date(`${s.date}T20:05:00Z`) });
      }),
    );
    if (rows.length) await db.insert(attendance).values(rows);
  };
  await mark(ielts.id, ieltsEnr.slice(0, 8), (i, j, n) => {
    if (i === 5 && j >= n - 2) return 'excused'; // away on the paused days
    if (i === 3 && j >= n - 2) return 'absent'; // two in a row: the consultant was told
    if ((i + j) % 9 === 0) return 'late';
    if ((i * 3 + j) % 11 === 0) return 'absent';
    return 'present';
  });
  await mark(pte.id, pteEnr, (i, j) => ((i + j) % 7 === 0 ? 'absent' : 'present'));
  await mark(spoken.id, spokenEnr, (i, j) => (i === 4 && j % 2 === 0 ? 'absent' : 'present'));
  const certStudents = spokenEnr.slice(0, 4);
  for (const [n, e] of certStudents.entries()) {
    await db.update(enrollments).set({ certificateNumber: `CERT-${year}-${String(n + 1).padStart(4, '0')}` }).where(eq(enrollments.id, e.id));
  }

  /* ---------------- Mock tests ---------------- */
  const mocks = [
    { title: 'Diagnostic test', kind: 'diagnostic', heldOn: day(-19), lift: 0 },
    { title: 'Mock test 1', kind: 'mock', heldOn: day(-10), lift: 0.5 },
    { title: 'Mock test 2', kind: 'mock', heldOn: day(-3), lift: 1 },
  ];
  for (const m of mocks) {
    const [a] = await db.insert(assessments).values({ tenantId, batchId: ielts.id, title: m.title, kind: m.kind, heldOn: m.heldOn, createdBy: trainer }).returning();
    const rows = ieltsEnr.slice(0, 8).map((e, i) => {
      const base = 5.5 + (i % 3) * 0.5;
      const scores = { listening: band(base + 0.5 + m.lift), reading: band(base + m.lift), writing: band(base - 0.5 + m.lift * 0.5), speaking: band(base + m.lift * 0.5) };
      return { tenantId, assessmentId: a!.id, enrollmentId: e.id, scores, overall: String(overallScore('ielts_academic', scores)), feedback: m.lift === 1 && i % 2 === 0 ? 'Writing task 2: plan before you write.' : null, recordedBy: trainer };
    });
    await db.insert(assessmentScores).values(rows);
  }

  /* ---------------- Homework and materials ---------------- */
  const [essay] = await db
    .insert(homework)
    .values({ tenantId, batchId: ielts.id, kind: 'homework', title: 'Writing task 2: remote work', instructions: 'Some say remote work is better for employees and employers. Discuss both views and give your opinion. 250 words, 40 minutes.', dueAt: new Date(`${day(-6)}T18:00:00Z`), maxScore: '9', createdBy: trainer })
    .returning();
  await db.insert(homework).values({ tenantId, batchId: ielts.id, kind: 'homework', title: 'Listening practice test 4', instructions: 'Do the full test, then check your answers against the key.', dueAt: new Date(`${day(3)}T18:00:00Z`), maxScore: '40', createdBy: trainer });
  await db.insert(homework).values({ tenantId, batchId: ielts.id, kind: 'material', title: 'Band descriptors for writing', instructions: 'What examiners look for at each band - read before every essay.', createdBy: trainer });
  await db.insert(homeworkSubmissions).values(
    ieltsEnr.slice(0, 6).map((e, i) => ({
      tenantId,
      homeworkId: essay!.id,
      enrollmentId: e.id,
      text: 'Remote work has transformed how many of us earn a living. Supporters argue…',
      submittedAt: new Date(`${day(i < 5 ? -7 : -5)}T15:00:00Z`),
      status: i < 4 ? 'graded' : 'submitted',
      score: i < 4 ? String([6, 6.5, 5.5, 7][i]) : null,
      feedback: i < 4 ? ['Clear position; develop paragraph two.', 'Good range of vocabulary.', 'Answer both views before your opinion.', 'Well organised - aim for more complex sentences.'][i] : null,
      gradedBy: i < 4 ? trainer : null,
      gradedAt: i < 4 ? new Date(`${day(-4)}T10:00:00Z`) : null,
    })),
  );

  /* ---------------- Official results ---------------- */
  let results = 0;
  for (const [i, e] of spokenEnr.slice(1, 4).entries()) {
    const scores = [
      { listening: 7, reading: 6.5, writing: 6, speaking: 6.5 },
      { listening: 6, reading: 6, writing: 5.5, speaking: 6 },
      { listening: 8, reading: 7.5, writing: 6.5, speaking: 7 },
    ][i]!;
    const testDate = day(-30 - i * 7);
    await db.insert(testResults).values({ tenantId, clientId: e.clientId, testType: 'ielts_academic', status: 'result', testDate, bookedOn: day(-60), venue: 'British Council, Lahore', reference: `25PK00${4471 + i}`, scores, overall: String(overallScore('ielts_academic', scores)), expiresOn: resultExpiry(testDate), recordedBy: by });
    await db.update(clients).set({ englishTest: 'ielts', englishScore: String(overallScore('ielts_academic', scores)), englishTestDate: testDate }).where(eq(clients.id, e.clientId));
    results++;
  }
  for (const e of ieltsEnr.slice(0, 2)) {
    await db.insert(testResults).values({ tenantId, clientId: e.clientId, testType: 'ielts_academic', status: 'booked', testDate: day(30), bookedOn: day(-2), venue: 'IDP, Lahore', reference: 'IDP-BK-2291', recordedBy: by });
    results++;
  }
  return { courses: 3, enrollments: enrSeq, results };
}

function band(v: number): number {
  return Math.max(0, Math.min(9, Math.round(v * 2) / 2));
}

function monthCode(d: string): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }).toUpperCase();
}

async function nextInvoiceSeq(db: Db, tenantId: string): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(invoices).where(and(eq(invoices.tenantId, tenantId), sql`${invoices.number} like ${`INV-${new Date().getFullYear()}-%`}`));
  return (r?.n ?? 0) + 1;
}

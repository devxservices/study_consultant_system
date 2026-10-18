import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../connection';
import { batches, classSessions, clients, courseEnquiries, courseEnquiryEvents, courses, enrollments, users } from '../schema';

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const at = (offset: number) => new Date(Date.now() + offset * 86_400_000);

/**
 * Demo course enquiries for a consultancy that has courses but no enquiries:
 * one at every step (new, called, a trial class booked, a trial done, one
 * enrolled, two not joining) with their history, and a course-only student
 * who has finished Spoken English and could be offered study abroad. Safe to
 * re-run: it does nothing where enquiries exist.
 */
export async function seedEnquiries(db: Db, tenantId: string): Promise<{ enquiries: number; courseOnly: number }> {
  const none = { enquiries: 0, courseOnly: 0 };
  const [has] = await db.select({ n: sql<number>`count(*)::int` }).from(courseEnquiries).where(eq(courseEnquiries.tenantId, tenantId));
  if ((has?.n ?? 0) > 0) return none;
  const list = await db.select().from(courses).where(eq(courses.tenantId, tenantId)).orderBy(asc(courses.code));
  const ielts = list.find((c) => c.testType === 'ielts_academic');
  const pte = list.find((c) => c.testType === 'pte_academic');
  const spoken = list.find((c) => c.testType === 'none');
  if (!ielts || !pte || !spoken) return none;
  const [manager] = await db.select({ id: users.id }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.role, 'manager'))).limit(1);
  const [staff] = await db.select({ id: users.id }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.role, 'consultant'), eq(users.isActive, true))).orderBy(asc(users.createdAt)).limit(1);
  if (!manager) return none;
  const owner = staff?.id ?? manager.id;

  // A class of the running IELTS batch two days from now, for a booked trial; one two days ago for a done one.
  const [ieltsBatch] = await db.select().from(batches).where(and(eq(batches.courseId, ielts.id), eq(batches.status, 'running'))).limit(1);
  const nextClass = ieltsBatch
    ? (await db.select().from(classSessions).where(and(eq(classSessions.batchId, ieltsBatch.id), sql`${classSessions.date} > ${day(0)}`, eq(classSessions.cancelled, false))).orderBy(asc(classSessions.date)).limit(1))[0]
    : undefined;
  const pastClass = ieltsBatch
    ? (await db.select().from(classSessions).where(and(eq(classSessions.batchId, ieltsBatch.id), sql`${classSessions.date} < ${day(0)}`, eq(classSessions.cancelled, false))).orderBy(desc(classSessions.date)).limit(1))[0]
    : undefined;
  const [upcoming] = await db.select().from(batches).where(and(eq(batches.tenantId, tenantId), eq(batches.status, 'enrolling'))).orderBy(asc(batches.startDate)).limit(1);
  const [enrolment] = await db
    .select({ id: enrollments.id, clientId: enrollments.clientId, batchId: enrollments.batchId, name: clients.fullName, phone: clients.phone, email: clients.email, courseId: batches.courseId, createdAt: enrollments.createdAt })
    .from(enrollments)
    .innerJoin(clients, eq(clients.id, enrollments.clientId))
    .innerJoin(batches, eq(batches.id, enrollments.batchId))
    .where(and(eq(enrollments.tenantId, tenantId), eq(enrollments.status, 'enrolled'), eq(batches.courseId, pte.id)))
    .limit(1);

  const year = new Date().getFullYear();
  let seq = 0;
  type Seed = Partial<typeof courseEnquiries.$inferInsert> & { fullName: string; phone: string; createdDays: number; events: [number, string, string, string | null][] };
  const seeds: Seed[] = [
    {
      fullName: 'Hamza Sheikh', phone: '+92 300 410 2201', email: 'hamza.sheikh@example.com', city: 'Lahore', courseId: ielts.id, source: 'walk_in', status: 'new', targetScore: '7.00', assignedTo: owner, followUpOn: day(0), createdDays: 0,
      events: [[0, 'created', 'Enquiry taken (Walk-in). Wants 7 overall for a UK master’s.', owner]],
    },
    {
      fullName: 'Ayesha Noor', phone: '+92 321 555 7710', email: 'ayesha.noor@example.com', city: 'Karachi', courseId: pte.id, source: 'website', status: 'new', studyAbroad: true, followUpOn: day(0), createdDays: 0, notes: 'Is there a weekend batch?',
      events: [[0, 'created', 'Enquiry from the website form. Is there a weekend batch? Also interested in studying abroad.', null]],
    },
    {
      fullName: 'Danish Mehmood', phone: '+92 333 812 4490', city: 'Lahore', courseId: ielts.id, source: 'phone', status: 'contacted', assignedTo: owner, followUpOn: day(-1), lastContactAt: at(-3), createdDays: -5,
      events: [
        [-5, 'created', 'Enquiry taken (Phone call).', owner],
        [-3, 'call', 'Called. Comparing fees with another institute; will decide after his exams. Next follow-up ' + day(-1) + '.', owner],
      ],
    },
    {
      fullName: 'Sana Javed', phone: '+92 345 220 9031', email: 'sana.javed@example.com', city: 'Islamabad', courseId: ielts.id, batchId: ieltsBatch?.id ?? null, source: 'referral', status: nextClass ? 'trial_booked' : 'contacted', assignedTo: owner, followUpOn: nextClass?.date ?? day(1), trialSessionId: nextClass?.id ?? null, lastContactAt: at(-1), createdDays: -2,
      events: [
        [-2, 'created', 'Enquiry taken (Referral). Her cousin studied with us.', owner],
        [-1, 'call', 'Called. Wants to see a class before paying.', owner],
        ...(nextClass ? ([[-1, 'trial', `Trial class booked: ${ielts.name}, ${ieltsBatch!.code}, ${nextClass.date} ${nextClass.startTime}-${nextClass.endTime}.`, owner]] as [number, string, string, string | null][]) : []),
      ],
    },
    {
      fullName: 'Fahad Ali', phone: '+92 300 667 1180', email: 'fahad.ali@example.com', city: 'Faisalabad', courseId: ielts.id, batchId: ieltsBatch?.id ?? null, source: 'social', status: pastClass ? 'trial_done' : 'contacted', targetScore: '6.50', assignedTo: owner, followUpOn: day(1), trialSessionId: pastClass?.id ?? null, trialOutcome: pastClass ? 'attended' : null, lastContactAt: at(-4), createdDays: -6,
      events: [
        [-6, 'created', 'Enquiry taken (Social media).', owner],
        [-4, 'call', 'Called. Booked into a class to try it.', owner],
        ...(pastClass ? ([[-2, 'trial', `Trial class on ${pastClass.date}: attended. Joined in well, asked about the fee in instalments.`, owner]] as [number, string, string, string | null][]) : []),
      ],
    },
    ...(enrolment
      ? [
          {
            fullName: enrolment.name, phone: enrolment.phone, email: enrolment.email, courseId: pte.id, batchId: enrolment.batchId, source: 'walk_in', status: 'enrolled', assignedTo: owner, clientId: enrolment.clientId, enrollmentId: enrolment.id, lastContactAt: at(-12), createdDays: -14,
            events: [
              [-14, 'created', 'Enquiry taken (Walk-in).', owner],
              [-12, 'call', 'Called. Ready to join.', owner],
              [-12, 'enrolled', 'Enrolled in PTE Academic preparation.', owner],
            ],
          } as Seed,
        ]
      : []),
    {
      fullName: 'Rabia Aslam', phone: '+92 312 448 2290', courseId: spoken.id, batchId: upcoming?.id ?? null, source: 'whatsapp', status: 'lost', lostReason: 'Fee too high', assignedTo: owner, lastContactAt: at(-8), createdDays: -10,
      events: [
        [-10, 'created', 'Enquiry taken (WhatsApp).', owner],
        [-8, 'call', 'Called. Says the fee is more than she can manage this month.', owner],
        [-8, 'lost', 'Not joining: Fee too high', owner],
      ],
    },
    {
      fullName: 'Umer Farooq', phone: '+92 301 990 3412', email: 'umer.f@example.com', courseId: ielts.id, source: 'phone', status: 'lost', lostReason: 'Joined another institute', assignedTo: manager.id, lastContactAt: at(-40), createdDays: -45,
      events: [
        [-45, 'created', 'Enquiry taken (Phone call).', manager.id],
        [-40, 'lost', 'Not joining: Joined another institute', manager.id],
      ],
    },
  ];
  for (const s of seeds) {
    const { events, createdDays, ...v } = s;
    const [row] = await db
      .insert(courseEnquiries)
      .values({ tenantId, number: `ENQ-${year}-${String(++seq).padStart(4, '0')}`, createdBy: v.source === 'website' ? null : (v.assignedTo ?? manager.id), createdAt: at(createdDays), updatedAt: at(createdDays), ...v })
      .returning();
    for (const [offset, kind, body, by] of events) await db.insert(courseEnquiryEvents).values({ tenantId, enquiryId: row!.id, kind, body, createdBy: by, createdAt: at(offset) });
  }

  // A course-only student who finished Spoken English: who to offer study abroad.
  let courseOnly = 0;
  const [done] = await db.select().from(batches).where(and(eq(batches.courseId, spoken.id), eq(batches.status, 'completed'))).limit(1);
  if (done) {
    const [c] = await db
      .insert(clients)
      .values({ tenantId, fullName: 'Mahnoor Saleem', email: 'mahnoor.saleem@example.com', phone: '+92 300 123 7788', city: 'Lahore', programme: 'course_only', createdBy: manager.id, createdAt: at(-60) })
      .onConflictDoNothing()
      .returning();
    if (c) {
      const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(enrollments).where(and(eq(enrollments.tenantId, tenantId), sql`${enrollments.number} like ${`ENR-${year}-%`}`));
      await db.insert(enrollments).values({
        tenantId,
        number: `ENR-${year}-${String((n?.n ?? 0) + 1).padStart(4, '0')}`,
        batchId: done.id,
        clientId: c.id,
        status: 'completed',
        enrolledAt: at(-58),
        completedAt: new Date(`${done.endDate}T18:00:00Z`),
        createdBy: manager.id,
      });
      courseOnly = 1;
    }
  }
  return { enquiries: seeds.length, courseOnly };
}

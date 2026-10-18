import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../connection';
import {
  announcements,
  cases,
  clients,
  consultants,
  invoiceItems,
  invoices,
  payments,
  plans,
  servicePackages,
  staffRoles,
  tasks,
  tenants,
  users,
} from '../schema';
import { seedTenantDefaults } from '../../tenancy/tenant-defaults';
import { METHOD_ACCOUNT } from '@crm/shared';
import { postInvoice, postPayment, reverseEntry, systemAccountId } from '../../finance/journal';
import { seedDrive } from './seed-drive';
import { seedWorkflows } from './seed-workflows';
import { seedFinance } from './seed-finance';
import { seedCommissions } from './seed-commissions';
import { seedPartners } from './seed-partners';
import { seedCourses } from './seed-courses';
import { seedEnquiries } from './seed-enquiries';
import { hashPassword } from '../../auth/local-auth.provider';

/**
 * Demo data for the modules on top of the core: plans, service packages, invoices and payments, tasks, announcements,
 * student profiles and application dates.
 *
 * Used two ways: by the full seed on a fresh database, and by `db:seed:extras`
 * on an existing one - where every function only fills what is empty and never
 * changes a value somebody entered.
 */

/* ------------------------------------------------------------------ */
/* Deterministic randomness                                            */
/* ------------------------------------------------------------------ */

let state = 424242;
const rand = () => {
  state = (state * 1103515245 + 12345) % 2147483648;
  return state / 2147483648;
};
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;
const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const at = (offsetDays: number, hour: number) => {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  d.setHours(hour, 0, 0, 0);
  return d;
};

/* ------------------------------------------------------------------ */
/* Plans                                                               */
/* ------------------------------------------------------------------ */

export async function seedPlans(db: Db): Promise<Record<string, string>> {
  const wanted = [
    {
      code: 'basic',
      name: 'Basic',
      priceMonthly: 4900,
      currency: 'USD',
      maxStaff: 3,
      maxActiveClients: 100,
      storageGb: 5,
      modules: ['announcements'],
    },
    {
      code: 'standard',
      name: 'Standard',
      priceMonthly: 9900,
      currency: 'USD',
      maxStaff: 10,
      maxActiveClients: 500,
      storageGb: 25,
      modules: ['tasks', 'announcements'],
    },
    {
      code: 'premium',
      name: 'Premium',
      priceMonthly: 19900,
      currency: 'USD',
      maxStaff: 30,
      maxActiveClients: 2000,
      storageGb: 100,
      modules: ['billing', 'tasks', 'announcements'],
    },
    {
      code: 'enterprise',
      name: 'Enterprise',
      priceMonthly: 49900,
      currency: 'USD',
      maxStaff: null,
      maxActiveClients: null,
      storageGb: null,
      modules: ['billing', 'tasks', 'announcements'],
    },
  ];
  const out: Record<string, string> = {};
  for (const p of wanted) {
    const [existing] = await db.select({ id: plans.id }).from(plans).where(eq(plans.code, p.code));
    if (existing) {
      out[p.code] = existing.id;
      continue;
    }
    const [row] = await db.insert(plans).values(p).returning({ id: plans.id });
    out[p.code] = row!.id;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Profiles and application dates                                      */
/* ------------------------------------------------------------------ */

const FIELDS = ['Computer Science', 'Data Science', 'Business', 'Engineering', 'Public Health'];
const INSTITUTIONS = [
  'University of the Punjab',
  'COMSATS University Islamabad',
  'NUST',
  'University of Karachi',
  'FAST-NUCES',
  'Bahauddin Zakariya University',
];
const SOURCES = ['walk_in', 'referral', 'referral', 'facebook', 'instagram', 'website', 'whatsapp', 'event'];

/** Fills profile fields on clients that have none yet. Never touches one somebody filled in. */
export async function seedProfiles(db: Db, tenantId: string): Promise<number> {
  const rows = await db
    .select({ id: clients.id })
    .from(clients)
    .where(
      and(
        eq(clients.tenantId, tenantId),
        isNull(clients.dateOfBirth),
        isNull(clients.passportNumber),
        isNull(clients.englishTest),
        isNull(clients.leadSource),
      ),
    );
  for (const r of rows) {
    const master = rand() < 0.75;
    const test = pick(['ielts', 'ielts', 'pte', 'toefl', 'duolingo', 'none'] as const);
    const score =
      test === 'ielts' ? pick(['6.0', '6.5', '6.5', '7.0', '7.5']) :
      test === 'pte' ? String(randInt(55, 72)) :
      test === 'toefl' ? String(randInt(80, 105)) :
      test === 'duolingo' ? String(randInt(105, 130)) : null;
    // One in eight passports is close enough to expiry to trigger the warning.
    const passportExpiry = rand() < 0.12 ? day(randInt(20, 170)) : day(randInt(400, 3000));
    await db
      .update(clients)
      .set({
        dateOfBirth: `${randInt(1996, 2005)}-${String(randInt(1, 12)).padStart(2, '0')}-${String(randInt(1, 28)).padStart(2, '0')}`,
        nationality: 'Pakistani',
        passportNumber: `${pick(['AB', 'BC', 'CD', 'EF', 'GH'])}${randInt(1000000, 9999999)}`,
        passportExpiry,
        highestQualification: master ? 'bachelor' : pick(['intermediate', 'a_levels'] as const),
        lastInstitution: master ? pick(INSTITUTIONS) : pick(['Punjab Group of Colleges', 'Beaconhouse', 'The City School']),
        lastGrade: master ? `${(2.6 + rand() * 1.2).toFixed(2)} CGPA` : `${randInt(68, 92)}%`,
        graduationYear: randInt(2019, 2025),
        englishTest: test,
        englishScore: score,
        englishTestDate: test === 'none' ? null : day(-randInt(20, 500)),
        intendedLevel: master ? 'master' : 'bachelor',
        intendedField: pick(FIELDS),
        preferredCountries: [pick(['United Kingdom', 'Canada', 'Australia', 'United States'])],
        budget: `PKR ${randInt(4, 12)}-${randInt(13, 20)} million / year`,
        leadSource: pick(SOURCES),
        emergencyContactName: `${pick(['Muhammad', 'Abdul', 'Shahid', 'Tariq', 'Nasreen', 'Farzana'])} ${pick(['Khan', 'Malik', 'Butt', 'Iqbal'])}`,
        emergencyContactPhone: `+92 30${randInt(0, 9)} ${randInt(1000000, 9999999)}`,
      })
      .where(eq(clients.id, r.id));
  }
  return rows.length;
}

/** The dates each live application runs on, set from where it is in the pipeline. */
export async function seedKeyDates(db: Db, tenantId: string): Promise<number> {
  const rows = await db
    .select({ id: cases.id, stage: cases.currentStage })
    .from(cases)
    .where(
      and(
        eq(cases.tenantId, tenantId),
        eq(cases.status, 'active'),
        isNull(cases.applicationDeadline),
        isNull(cases.offerDeadline),
        isNull(cases.visaAppointmentAt),
        isNull(cases.travelDate),
      ),
    );
  for (const r of rows) {
    const patch: Partial<typeof cases.$inferInsert> = {};
    switch (r.stage) {
      case 'inquiry':
      case 'shortlisting':
      case 'documents_collection':
        patch.applicationDeadline = day(randInt(-3, 75));
        break;
      case 'application_submitted':
        patch.applicationDeadline = day(-randInt(5, 40));
        break;
      case 'offer_letter':
      case 'fee_payment':
        patch.offerType = rand() < 0.6 ? 'conditional' : 'unconditional';
        patch.offerConditions =
          patch.offerType === 'conditional'
            ? pick([
                'Final degree transcript showing a 2:1 equivalent.',
                'IELTS 6.5 with no band below 6.0, before 30 June.',
                'Proof of funds for the first year’s tuition and living costs.',
              ])
            : null;
        patch.offerDeadline = day(randInt(-2, 40));
        break;
      case 'visa_filed':
      case 'visa_interview':
        patch.visaAppointmentAt = at(randInt(-1, 30), pick([9, 10, 11, 14]));
        patch.offerType = 'unconditional';
        break;
      case 'visa_decision':
        patch.travelDate = day(randInt(20, 90));
        patch.offerType = 'unconditional';
        break;
    }
    if (Object.keys(patch).length) await db.update(cases).set(patch).where(eq(cases.id, r.id));
  }
  return rows.length;
}

/* ------------------------------------------------------------------ */
/* Billing                                                             */
/* ------------------------------------------------------------------ */

const PACKAGES = [
  { name: 'Initial consultation', description: 'One-to-one profile assessment and country advice.', amount: 5_000_00 },
  { name: 'Admission processing', description: 'Shortlisting, applications to up to five universities, SOP review.', amount: 75_000_00 },
  { name: 'Visa file preparation', description: 'Financial documents, visa forms and submission.', amount: 60_000_00 },
  { name: 'Complete package', description: 'Admission and visa, start to finish.', amount: 150_000_00 },
  { name: 'Interview preparation', description: 'Two mock embassy interviews with feedback.', amount: 15_000_00 },
];

export async function seedBilling(db: Db, tenantId: string): Promise<{ invoices: number; payments: number }> {
  const [hasPackages] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(servicePackages)
    .where(eq(servicePackages.tenantId, tenantId));
  if ((hasPackages?.n ?? 0) === 0) {
    await db.insert(servicePackages).values(PACKAGES.map((p) => ({ tenantId, ...p, currency: 'PKR' })));
  }

  const [hasInvoices] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(invoices)
    .where(eq(invoices.tenantId, tenantId));
  if ((hasInvoices?.n ?? 0) > 0) return { invoices: 0, payments: 0 };

  const pkgs = await db.select().from(servicePackages).where(eq(servicePackages.tenantId, tenantId));
  const byName = new Map(pkgs.map((p) => [p.name, p]));
  const manager = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.role, 'manager')))
    .limit(1);
  const staffId = manager[0]?.id ?? null;

  const caseRows = await db
    .select({
      id: cases.id,
      clientId: cases.clientId,
      stage: cases.currentStage,
      createdAt: cases.createdAt,
      consultantUserId: consultants.userId,
    })
    .from(cases)
    .innerJoin(clients, eq(clients.id, cases.clientId))
    .leftJoin(consultants, eq(consultants.id, cases.consultantId))
    .where(and(eq(cases.tenantId, tenantId), eq(clients.archived, false)))
    .orderBy(asc(cases.createdAt));

  const year = new Date().getFullYear();
  let invSeq = 0;
  let rctSeq = 0;
  let madeInvoices = 0;
  let madePayments = 0;
  const later = ['offer_letter', 'fee_payment', 'visa_filed', 'visa_interview', 'visa_decision', 'closed'];

  for (const k of caseRows) {
    if (rand() < 0.15) continue; // not everyone has been billed yet
    const created = new Date(k.createdAt);
    const ageDays = Math.max(1, Math.floor((Date.now() - created.getTime()) / 86_400_000));
    const bills: { items: string[]; issuedAgo: number }[] = [];
    if (later.includes(k.stage) && rand() < 0.5) {
      bills.push({ items: ['Complete package'], issuedAgo: Math.max(1, ageDays - randInt(0, 5)) });
    } else {
      bills.push({ items: ['Initial consultation', 'Admission processing'], issuedAgo: Math.max(1, ageDays - randInt(0, 5)) });
      if (later.includes(k.stage)) {
        bills.push({ items: ['Visa file preparation', ...(rand() < 0.4 ? ['Interview preparation'] : [])], issuedAgo: Math.max(1, Math.floor(ageDays / 3)) });
      }
    }

    for (const bill of bills) {
      invSeq++;
      const lines = bill.items.map((n) => byName.get(n)!).filter(Boolean);
      const total = lines.reduce((s, l) => s + l.amount, 0);
      const issueDate = day(-bill.issuedAgo);
      const dueDate = day(-bill.issuedAgo + 14);
      // One transaction per invoice: the books check that each entry balances
      // when it commits, so the entry and its lines have to land together.
      await db.transaction(async (tx) => {
        const [inv] = await tx
          .insert(invoices)
          .values({
            tenantId,
            number: `INV-${year}-${String(invSeq).padStart(4, '0')}`,
            clientId: k.clientId,
            caseId: k.id,
            currency: 'PKR',
            issueDate,
            dueDate,
            total,
            subtotal: total,
            fxRate: '1',
            createdBy: k.consultantUserId ?? staffId,
            createdAt: new Date(`${issueDate}T10:00:00Z`),
          })
          .returning();
        await tx.insert(invoiceItems).values(
          lines.map((l, i) => ({
            tenantId,
            invoiceId: inv!.id,
            packageId: l.id,
            description: l.name,
            quantity: 1,
            unitAmount: l.amount,
            amount: l.amount,
            lineTotal: l.amount,
            position: i,
          })),
        );
        // The books, exactly as the app would have posted them.
        await postInvoice(tx, { ...inv!, items: lines.map((l) => ({ category: 'service', amount: l.amount, discount: 0, taxAmount: 0, taxInclusive: false })) }, staffId);
        madeInvoices++;
  
        // Paid in full, in instalments, or not yet - the mix a real ledger has.
        const roll = rand();
        const instalments =
          roll < 0.5 ? [total] : roll < 0.75 ? [Math.round(total * 0.5), total - Math.round(total * 0.5)] : roll < 0.88 ? [Math.round(total * 0.4)] : [];
        let paidDay = bill.issuedAgo;
        for (const [i, amount] of instalments.entries()) {
          paidDay = Math.max(0, paidDay - randInt(1, 12));
          rctSeq++;
          const voided = i === 0 && rand() < 0.04;
          const method = pick(['bank_transfer', 'bank_transfer', 'cash', 'online', 'card'] as const);
          const [p] = await tx.insert(payments).values({
            tenantId,
            number: `RCT-${year}-${String(rctSeq).padStart(4, '0')}`,
            invoiceId: inv!.id,
            clientId: k.clientId,
            kind: 'payment',
            amount,
            currency: 'PKR',
            method,
            accountId: await systemAccountId(tx, tenantId, METHOD_ACCOUNT[method]),
            fxRate: '1',
            reference: rand() < 0.6 ? `TRX${randInt(100000, 999999)}` : null,
            receivedOn: day(-paidDay),
            recordedBy: k.consultantUserId ?? staffId,
            createdAt: new Date(`${day(-paidDay)}T12:00:00Z`),
            ...(voided
              ? { voidedAt: new Date(), voidedBy: staffId, voidReason: 'Recorded against the wrong client - re-entered.' }
              : {}),
          }).returning();
          const entry = await postPayment(tx, { ...p!, kind: 'payment', method }, staffId);
          if (voided && entry) {
            await reverseEntry(tx, entry, {
              date: day(0),
              memo: `Payment ${p!.number} voided: Recorded against the wrong client - re-entered.`,
              sourceType: 'payment_void',
              createdBy: staffId,
            });
          }
          madePayments++;
        }
      });
    }
  }
  return { invoices: madeInvoices, payments: madePayments };
}

/* ------------------------------------------------------------------ */
/* Tasks + announcements                                               */
/* ------------------------------------------------------------------ */

const TASKS = [
  'Call about the missing transcript',
  'Chase bank statement with bank stamp',
  'Review SOP draft and send feedback',
  'Confirm IELTS test date',
  'Follow up with university admissions office',
  'Book visa biometrics appointment',
  'Send offer acceptance form',
  'Remind about tuition deposit deadline',
  'Mock visa interview',
  'Check CAS / I-20 status',
];

export async function seedTasks(db: Db, tenantId: string): Promise<number> {
  const [has] = await db.select({ n: sql<number>`count(*)::int` }).from(tasks).where(eq(tasks.tenantId, tenantId));
  if ((has?.n ?? 0) > 0) return 0;

  const live = await db
    .select({ id: cases.id, clientId: cases.clientId, consultantUserId: consultants.userId })
    .from(cases)
    .innerJoin(consultants, eq(consultants.id, cases.consultantId))
    .where(and(eq(cases.tenantId, tenantId), eq(cases.status, 'active')))
    .limit(40);
  const [manager] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.role, 'manager')))
    .limit(1);

  let made = 0;
  for (const [i, k] of live.entries()) {
    if (rand() < 0.35) continue;
    const bucket = i % 5; // overdue, today, upcoming, upcoming, done
    const dueAt =
      bucket === 0 ? at(-randInt(1, 6), 11) :
      bucket === 1 ? at(0, pick([10, 12, 15, 17])) :
      bucket === 4 ? at(-randInt(2, 20), 12) : at(randInt(1, 14), pick([10, 14, 16]));
    await db.insert(tasks).values({
      tenantId,
      title: pick(TASKS),
      notes: rand() < 0.3 ? 'Prefers WhatsApp after 6pm.' : null,
      clientId: k.clientId,
      caseId: k.id,
      assigneeId: k.consultantUserId,
      createdBy: rand() < 0.2 && manager ? manager.id : k.consultantUserId,
      dueAt,
      priority: pick(['normal', 'normal', 'high', 'low', 'urgent'] as const),
      status: bucket === 4 ? 'done' : 'open',
      completedAt: bucket === 4 ? at(-randInt(0, 2), 15) : null,
      completedBy: bucket === 4 ? k.consultantUserId : null,
      escalated: bucket === 0 && rand() < 0.3,
      // Existing overdue ones count as already alerted, so a fresh seed does not ring every bell.
      overdueNotifiedAt: bucket === 0 ? new Date() : null,
    });
    made++;
  }
  if (manager) {
    await db.insert(tasks).values([
      { tenantId, title: 'Review this month’s outstanding invoices', assigneeId: manager.id, createdBy: manager.id, dueAt: at(1, 10), priority: 'high' },
      { tenantId, title: 'Plan the UK September intake webinar', assigneeId: manager.id, createdBy: manager.id, dueAt: at(6, 11) },
    ]);
    made += 2;
  }
  return made;
}

export async function seedAnnouncements(db: Db, tenantId: string): Promise<number> {
  const [has] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(announcements)
    .where(eq(announcements.tenantId, tenantId));
  if ((has?.n ?? 0) > 0) return 0;
  const [manager] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.role, 'manager')))
    .limit(1);
  await db.insert(announcements).values([
    {
      tenantId,
      title: 'UK September intake: apply before the end of next month',
      body: 'Popular programmes close early. If you are aiming for September, make sure your documents are uploaded so we can submit your applications in time.',
      audience: 'clients',
      pinned: true,
      createdBy: manager?.id ?? null,
      createdAt: new Date(Date.now() - 2 * 86_400_000),
    },
    {
      tenantId,
      title: 'Office timings during the holidays',
      body: 'The office will be closed on public holidays. Messages sent through the portal will be answered on the next working day.',
      audience: 'everyone',
      createdBy: manager?.id ?? null,
      createdAt: new Date(Date.now() - 6 * 86_400_000),
    },
    {
      tenantId,
      title: 'New: record every payment in the ledger',
      body: 'From this week, every fee received - cash included - goes into the payments ledger the same day, with a receipt number. No more receipts in the drawer.',
      audience: 'staff',
      createdBy: manager?.id ?? null,
      createdAt: new Date(Date.now() - 9 * 86_400_000),
    },
  ]);
  return 3;
}

/**
 * The built-in roles, and one accountant and one trainer to hold them, so
 * the role-based screens have someone to show. Skips what exists.
 */
export async function seedRoles(db: Db, tenantId: string): Promise<number> {
  await seedTenantDefaults(db, tenantId);
  const roles = await db
    .select({ id: staffRoles.id, key: staffRoles.systemKey })
    .from(staffRoles)
    .where(eq(staffRoles.tenantId, tenantId));
  const roleId = (key: string) => roles.find((r) => r.key === key)?.id ?? null;
  const [tenant] = await db.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId));
  const domain = tenant?.slug === 'main' ? 'consultancy.pk' : `${tenant?.slug ?? 'example'}.pk`;
  const passwordHash = await hashPassword(process.env.SEED_PASSWORD ?? 'password123');

  let added = 0;
  for (const person of [
    { email: `accounts@${domain}`, fullName: 'Rabia Accounts', role: 'accountant' },
    { email: `trainer@${domain}`, fullName: 'Usman Trainer', role: 'trainer' },
  ]) {
    const [exists] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(sql`lower(${users.email})`, person.email)))
      .limit(1);
    if (exists) continue;
    const [u] = await db
      .insert(users)
      .values({
        tenantId,
        email: person.email,
        passwordHash,
        fullName: person.fullName,
        role: 'consultant',
        staffRoleId: roleId(person.role),
      })
      .returning({ id: users.id });
    await db.insert(consultants).values({ tenantId, userId: u!.id, maxActiveClients: 0 });
    added++;
  }
  return added;
}

/** Everything above, for one consultancy, each part skipping what is already there. */
export async function seedModulesFor(db: Db, tenantId: string) {
  const roleStaff = await seedRoles(db, tenantId);
  const profiles = await seedProfiles(db, tenantId);
  const dates = await seedKeyDates(db, tenantId);
  const billing = await seedBilling(db, tenantId);
  const taskCount = await seedTasks(db, tenantId);
  const notices = await seedAnnouncements(db, tenantId);
  const drive = await seedDrive(db, tenantId);
  const workflows = await seedWorkflows(db, tenantId);
  const finance = await seedFinance(db, tenantId);
  const commissions = await seedCommissions(db, tenantId);
  const partnerData = await seedPartners(db, tenantId);
  const courseData = await seedCourses(db, tenantId);
  const enquiryData = await seedEnquiries(db, tenantId);
  return { roleStaff, profiles, dates, ...billing, tasks: taskCount, announcements: notices, drive, workflows, finance, commissions, partners: partnerData, courses: courseData, enquiries: enquiryData };
}


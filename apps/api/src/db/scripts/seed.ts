import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hash } from 'bcryptjs';
import { and, eq, sql } from 'drizzle-orm';
import {
  DOCUMENT_META,
  STAGE_DEFINITIONS,
  STAGE_ORDER,
  applicableStages,
  type DocumentType,
  type Stage,
} from '@crm/shared';
import { createDb, type Db } from '../connection';
import { seedModulesFor, seedPlans } from './seed-modules';
import { seedTenantDefaults } from '../../tenancy/tenant-defaults';
import {
  announcements,
  auditLog,
  caseStageEvents,
  invoiceItems,
  invoices,
  payments,
  plans,
  servicePackages,
  tasks,
  cases,
  clients,
  consultants,
  documentComments,
  documents,
  messages,
  notifications,
  rolePermissions,
  tenantDomains,
  tenants,
  userPermissions,
  users,
} from '../schema';

/**
 * Fills the local database with two consultancies that have been running for a
 * while - cases spread across every stage, real review queues, a few genuinely
 * stuck cases, documents in all three states - plus a platform admin who
 * manages them both. Designing the UI against three placeholder rows hides
 * every layout problem that matters, and testing tenancy against one tenant
 * proves nothing.
 *
 *  - "main" (Global Study Consultants) is the big one, and the consultancy the
 *    bare http://localhost:3000 serves in development.
 *  - "futurepath" (Future Path Education) is smaller, has its own brand colour,
 *    and lives at http://futurepath.localhost:3000.
 *  - The platform admin signs in at http://admin.localhost:3000.
 */

const PASSWORD = process.env.SEED_PASSWORD ?? 'password123';

const AVATAR_COLORS = ['indigo', 'teal', 'amber', 'rose', 'violet', 'slate'];

const PLATFORM_ADMIN = { name: 'Platform Owner', email: 'admin@platform.test' };

interface ConsultancySpec {
  slug: string;
  name: string;
  primaryColor: string | null;
  contactEmail: string;
  contactPhone: string;
  manager: { name: string; email: string };
  consultants: { name: string; email: string; countries: string[] }[];
  clientCount: number;
}

const CONSULTANCIES: ConsultancySpec[] = [
  {
    slug: 'main',
    name: 'Global Study Consultants',
    primaryColor: null,
    contactEmail: 'hello@consultancy.pk',
    contactPhone: '+92 42 111 222 333',
    manager: { name: 'Nadia Iftikhar', email: 'manager@consultancy.pk' },
    consultants: [
      { name: 'Ayesha Siddiqui', email: 'ayesha@consultancy.pk', countries: ['United Kingdom', 'Ireland'] },
      { name: 'Bilal Ahmed', email: 'bilal@consultancy.pk', countries: ['United States', 'Canada'] },
      { name: 'Hina Raza', email: 'hina@consultancy.pk', countries: ['Australia', 'New Zealand'] },
    ],
    clientCount: 42,
  },
  {
    slug: 'futurepath',
    name: 'Future Path Education',
    primaryColor: '#0f766e',
    contactEmail: 'info@futurepath.pk',
    contactPhone: '+92 51 444 555 666',
    manager: { name: 'Kamran Yousaf', email: 'manager@futurepath.pk' },
    consultants: [
      { name: 'Sana Tariq', email: 'sana@futurepath.pk', countries: ['United Kingdom', 'Germany'] },
      { name: 'Omar Latif', email: 'omar@futurepath.pk', countries: ['Canada', 'Australia'] },
    ],
    clientCount: 12,
  },
];

const COUNTRIES = [
  { country: 'United Kingdom', unis: ['University of Leeds', 'Coventry University', 'University of Glasgow'] },
  { country: 'United States', unis: ['Arizona State University', 'Purdue University', 'DePaul University'] },
  { country: 'Canada', unis: ['University of Windsor', 'Seneca College', 'Dalhousie University'] },
  { country: 'Australia', unis: ['Deakin University', 'RMIT University', 'Monash University'] },
  { country: 'Germany', unis: ['TU Berlin', 'RWTH Aachen'] },
];

const PROGRAMS = [
  'MSc Computer Science',
  'MSc Data Analytics',
  'MBA',
  'MSc Civil Engineering',
  'BSc Business Administration',
  'MSc Public Health',
  'MSc Cyber Security',
];

const FIRST_NAMES = [
  'Hamza', 'Zainab', 'Usman', 'Fatima', 'Ali', 'Maryam', 'Ahmed', 'Sana', 'Bilal', 'Areeba',
  'Hassan', 'Noor', 'Umar', 'Iqra', 'Talha', 'Aiman', 'Saad', 'Hira', 'Faizan', 'Amna',
  'Shahzaib', 'Kinza', 'Danish', 'Rabia', 'Zohaib', 'Mahnoor', 'Arsalan', 'Laiba',
];
const LAST_NAMES = [
  'Khan', 'Malik', 'Sheikh', 'Butt', 'Chaudhry', 'Qureshi', 'Farooq', 'Nawaz', 'Iqbal',
  'Rehman', 'Javed', 'Aslam', 'Bhatti', 'Mir', 'Hussain', 'Abbas',
];
const CITIES = ['Lahore', 'Karachi', 'Islamabad', 'Faisalabad', 'Multan', 'Peshawar', 'Sialkot'];

const INTAKES = ['Fall 2026', 'Spring 2027', 'Fall 2027'];

/**
 * Seeded documents need real bytes behind them, otherwise every "Open file"
 * in the demo data 404s and the app looks broken. A tiny valid PDF is written
 * for each one, using the same key layout the upload path produces.
 */
const STORAGE_ROOT = path.resolve(process.cwd(), process.env.STORAGE_LOCAL_DIR ?? '../../storage');

function placeholderPdf(title: string): Buffer {
  const text = title.replace(/[()\\]/g, '');
  const body = `BT /F1 18 Tf 60 700 Td (${text}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

function writePlaceholder(key: string, title: string): number {
  const full = path.join(STORAGE_ROOT, key);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const buf = placeholderPdf(title);
  fs.writeFileSync(full, buf);
  return buf.byteLength;
}

/** Deterministic pseudo-random, so re-seeding gives the same dataset. */
let seedState = 1337;
function rand(): number {
  seedState = (seedState * 1103515245 + 12345) % 2147483648;
  return seedState / 2147483648;
}
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;
const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function main() {
  const handle = await createDb();
  const db = handle.db;

  console.log('[seed] clearing existing data');
  fs.rmSync(STORAGE_ROOT, { recursive: true, force: true });
  // Children before parents: tenant ids are ON DELETE RESTRICT, deliberately,
  // so nothing can delete a consultancy with its data still inside it.
  // The audit log is append-only in the database; wiping it is maintenance and
  // has to say so, inside its own transaction.
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.audit_maintenance', 'on', true)`);
    await tx.delete(auditLog);
  });
  await db.delete(notifications);
  await db.delete(payments);
  await db.delete(invoiceItems);
  await db.delete(invoices);
  await db.delete(servicePackages);
  await db.delete(tasks);
  await db.delete(announcements);
  await db.delete(messages);
  await db.delete(documentComments);
  await db.delete(documents);
  await db.delete(caseStageEvents);
  await db.delete(cases);
  await db.delete(clients);
  await db.delete(consultants);
  await db.delete(userPermissions);
  await db.delete(rolePermissions);
  await db.delete(users);
  await db.delete(tenantDomains);
  await db.delete(tenants);
  await db.delete(plans);

  const passwordHash = await hash(PASSWORD, 10);

  await db.insert(users).values({
    tenantId: null,
    email: PLATFORM_ADMIN.email,
    passwordHash,
    fullName: PLATFORM_ADMIN.name,
    role: 'super_admin',
    avatarColor: 'slate',
  });

  const planIds = await seedPlans(db);

  const summaries: string[] = [];
  for (const spec of CONSULTANCIES) {
    summaries.push(await seedConsultancy(db, spec, passwordHash));
    const [tenant] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, spec.slug));
    const extras = await seedModulesFor(db, tenant!.id);
    // The big consultancy on Premium (every module), the small one on Standard -
    // so the platform admin sees two plans in use, and Future Path shows what a
    // plan without billing looks like.
    await db
      .update(tenants)
      .set({
        planId: spec.slug === 'main' ? planIds.premium : planIds.standard,
        subscriptionStatus: 'active',
        currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10),
      })
      .where(eq(tenants.id, tenant!.id));
    summaries.push(
      `    + ${extras.invoices} invoices, ${extras.payments} payments, ${extras.tasks} tasks\n`,
    );
  }

  console.log('[seed] done');
  console.log('');
  for (const block of summaries) console.log(block);
  console.log('  Platform admin - http://admin.localhost:3000');
  console.log(`    ${PLATFORM_ADMIN.email}`);
  console.log('');
  console.log(`  Password for every account: ${PASSWORD}`);

  await handle.close();
}

/**
 * One consultancy's worth of data. Every row is stamped with the tenant the
 * same way the API stamps it, so seeded data is shaped exactly like data
 * created through the product.
 */
async function seedConsultancy(
  db: Db,
  spec: ConsultancySpec,
  passwordHash: string,
): Promise<string> {
  const [tenant] = await db
    .insert(tenants)
    .values({
      slug: spec.slug,
      name: spec.name,
      primaryColor: spec.primaryColor,
      contactEmail: spec.contactEmail,
      contactPhone: spec.contactPhone,
    })
    .returning();
  if (!tenant) throw new Error('tenant insert failed');
  const tenantId = tenant.id;
  // What onboarding gives a real consultancy - before any application is
  // written, so the database attaches each one to the Standard workflow.
  await seedTenantDefaults(db, tenantId);

  /* ---- staff ---------------------------------------------------- */

  const [manager] = await db
    .insert(users)
    .values({
      tenantId,
      email: spec.manager.email,
      passwordHash,
      fullName: spec.manager.name,
      role: 'manager',
      phone: '+92 300 1234567',
      avatarColor: 'indigo',
    })
    .returning();
  if (!manager) throw new Error('manager insert failed');

  const consultantRows: { id: string; userId: string; name: string }[] = [];
  for (const [i, c] of spec.consultants.entries()) {
    const [u] = await db
      .insert(users)
      .values({
        tenantId,
        email: c.email,
        passwordHash,
        fullName: c.name,
        role: 'consultant',
        phone: `+92 30${i} ${randInt(1000000, 9999999)}`,
        avatarColor: AVATAR_COLORS[i % AVATAR_COLORS.length]!,
      })
      .returning();
    if (!u) throw new Error('consultant user insert failed');

    const [row] = await db
      .insert(consultants)
      .values({ tenantId, userId: u.id, countries: c.countries, maxActiveClients: 60 })
      .returning();
    if (!row) throw new Error('consultant insert failed');
    consultantRows.push({ id: row.id, userId: u.id, name: c.name });
  }

  /* ---- clients + cases ------------------------------------------- */

  const usedEmails = new Set<string>();
  let caseSeq = 0;
  let documentCount = 0;
  let messageCount = 0;

  for (let i = 0; i < spec.clientCount; i++) {
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const fullName = `${first} ${last}`;

    let email = `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, '');
    while (usedEmails.has(email)) email = `${email}${randInt(1, 99)}`;
    usedEmails.add(email);

    const consultant = consultantRows[i % consultantRows.length]!;
    const createdDaysAgo = randInt(5, 260);

    // Roughly two thirds of clients have activated their portal login.
    const hasLogin = rand() < 0.68;
    let clientUserId: string | null = null;
    if (hasLogin) {
      const [cu] = await db
        .insert(users)
        .values({
          tenantId,
          email: `${email}@gmail.com`,
          passwordHash,
          fullName,
          role: 'client',
          phone: `+92 3${randInt(10, 49)} ${randInt(1000000, 9999999)}`,
          avatarColor: pick(AVATAR_COLORS),
          createdAt: daysAgo(createdDaysAgo),
        })
        .returning();
      clientUserId = cu?.id ?? null;
    }

    const [client] = await db
      .insert(clients)
      .values({
        tenantId,
        userId: clientUserId,
        fullName,
        email: `${email}@gmail.com`,
        phone: `+92 3${randInt(10, 49)} ${randInt(1000000, 9999999)}`,
        city: pick(CITIES),
        assignedConsultantId: consultant.id,
        notes: rand() < 0.3 ? 'Prefers a call in the evening.' : null,
        archived: rand() < 0.05,
        createdBy: manager.id,
        createdAt: daysAgo(createdDaysAgo),
        updatedAt: daysAgo(randInt(0, createdDaysAgo)),
      })
      .returning();
    if (!client) throw new Error('client insert failed');

    // A minority of clients chase two countries at once.
    const applicationCount = rand() < 0.18 ? 2 : 1;

    for (let a = 0; a < applicationCount; a++) {
      const dest = pick(COUNTRIES);
      const stage = weightedStage();
      const applicable = applicableStages(dest.country);
      const effectiveStage = applicable.includes(stage) ? stage : 'visa_decision';

      // A few cases are deliberately left rotting so the manager's stuck-case
      // alerts have something real to find.
      const isStuck = rand() < 0.12;

      // A closed case has an outcome and a date it was decided on. Roughly one
      // in six visa applications is refused, and the dashboards need both
      // outcomes present or the trend chart only ever shows good news.
      //
      // Decisions are spread across the case's own lifetime rather than stamped
      // with today's date - otherwise every approval the consultancy has ever
      // made lands in the current month and the trend chart is a single spike.
      const closed = effectiveStage === 'closed';
      const decidedDaysAgo = randInt(0, Math.max(1, createdDaysAgo - 3));
      const status = closed
        ? rand() < 0.84
          ? ('approved' as const)
          : ('rejected' as const)
        : rand() < 0.04
          ? ('on_hold' as const)
          : ('active' as const);

      const stageEnteredAt = closed
        ? daysAgo(decidedDaysAgo)
        : daysAgo(isStuck ? randInt(18, 60) : randInt(0, 12));
      const lastActivityAt = closed
        ? stageEnteredAt
        : isStuck
          ? stageEnteredAt
          : daysAgo(randInt(0, 6));

      caseSeq++;
      const [kase] = await db
        .insert(cases)
        .values({
          tenantId,
          reference: `APP-2026-${String(caseSeq).padStart(4, '0')}`,
          clientId: client.id,
          consultantId: consultant.id,
          targetCountry: dest.country,
          targetUniversity: pick(dest.unis),
          targetProgram: pick(PROGRAMS),
          intake: pick(INTAKES),
          currentStage: effectiveStage,
          status,
          stageEnteredAt,
          lastActivityAt,
          closedAt: closed ? stageEnteredAt : null,
          createdAt: daysAgo(createdDaysAgo),
          updatedAt: lastActivityAt,
        })
        .returning();
      if (!kase) throw new Error('case insert failed');

      /* ---- stage history: every stage the case has passed through ---- */
      const reached = applicable.slice(0, applicable.indexOf(effectiveStage) + 1);
      let cursor = createdDaysAgo;
      for (const [si, s] of reached.entries()) {
        const isCurrent = si === reached.length - 1;
        const entered = isCurrent ? stageEnteredAt : daysAgo(cursor);
        const nextCursor = Math.max(0, cursor - randInt(3, 20));
        await db.insert(caseStageEvents).values({
          tenantId,
          caseId: kase.id,
          stage: s,
          enteredAt: entered,
          completedAt: isCurrent ? null : daysAgo(nextCursor),
          method: si === 0 ? 'initial' : rand() < 0.6 ? 'auto' : 'manual',
          changedBy: si === 0 ? manager.id : consultant.userId,
        });
        cursor = nextCursor;
      }

      /* ---- documents ------------------------------------------------- */
      const uploader = clientUserId ?? consultant.userId;
      const collected = new Set<DocumentType>();
      for (const s of reached) {
        for (const t of STAGE_DEFINITIONS[s].requiredDocuments) collected.add(t);
      }

      const stageIdx = STAGE_ORDER.indexOf(effectiveStage);
      for (const type of collected) {
        const isCurrentStageDoc =
          STAGE_DEFINITIONS[effectiveStage].requiredDocuments.includes(type);

        // Documents for stages already passed are verified by definition;
        // the current stage is a work in progress.
        let status: 'pending' | 'verified' | 'rejected' = 'verified';
        if (isCurrentStageDoc && stageIdx < STAGE_ORDER.length - 1) {
          const roll = rand();
          status = roll < 0.4 ? 'verified' : roll < 0.8 ? 'pending' : 'rejected';
        }

        const uploadedAt = daysAgo(randInt(0, 40));
        const fileKey = `tenants/${tenantId}/cases/${kase.id}/${type}/${randomUUID()}`;
        const fileSize = writePlaceholder(fileKey, DOCUMENT_META[type].label);
        const reviewed = status !== 'pending';

        const [doc] = await db
          .insert(documents)
          .values({
            tenantId,
            caseId: kase.id,
            clientId: client.id,
            type,
            fileKey,
            fileName: `${type}.pdf`,
            fileSize,
            mimeType: 'application/pdf',
            status,
            uploadedBy: uploader,
            uploadedAt,
            reviewerComment:
              status === 'rejected' ? pick(REJECTION_REASONS) : null,
            reviewedBy: reviewed ? consultant.userId : null,
            reviewedAt: reviewed ? new Date(uploadedAt.getTime() + 86_400_000) : null,
          })
          .returning();
        documentCount++;

        if (doc && status === 'pending' && rand() < 0.25) {
          await db.insert(documentComments).values({
            tenantId,
            documentId: doc.id,
            authorId: consultant.userId,
            body: 'Is this the most recent version? The date on page 2 looks old.',
            createdAt: new Date(uploadedAt.getTime() + 3_600_000),
          });
        }

        if (doc && status === 'rejected') {
          await db.insert(auditLog).values({
            tenantId,
            actorId: consultant.userId,
            actorRole: 'consultant',
            action: 'document.rejected',
            entityType: 'document',
            entityId: doc.id,
            caseId: kase.id,
            clientId: client.id,
            metadata: { type, reason: doc.reviewerComment },
            createdAt: doc.reviewedAt ?? uploadedAt,
          });
        }
      }

      /* ---- chat ------------------------------------------------------- */
      if (clientUserId && rand() < 0.75) {
        const turns = randInt(2, 8);
        for (let m = 0; m < turns; m++) {
          const fromClient = m % 2 === 0;
          const sentAt = daysAgo(randInt(0, 25));
          await db.insert(messages).values({
            tenantId,
            caseId: kase.id,
            senderId: fromClient ? clientUserId : consultant.userId,
            senderRole: fromClient ? 'client' : 'consultant',
            body: fromClient ? pick(CLIENT_MESSAGES) : pick(CONSULTANT_MESSAGES),
            sentAt,
            // The newest inbound message is often still unread.
            readAt: m === turns - 1 && fromClient ? null : sentAt,
          });
          messageCount++;
        }
      }

      /* ---- notifications ---------------------------------------------- */
      if (clientUserId && rand() < 0.5) {
        await db.insert(notifications).values({
          tenantId,
          userId: clientUserId,
          type: 'stage_changed',
          title: `Your case moved to ${STAGE_DEFINITIONS[effectiveStage].clientLabel}`,
          body: STAGE_DEFINITIONS[effectiveStage].clientDescription,
          link: '/portal',
          caseId: kase.id,
          readAt: rand() < 0.4 ? new Date() : null,
          createdAt: stageEnteredAt,
        });
      }
    }
  }

  const [sampleClient] = await db
    .select({ email: clients.email })
    .from(clients)
    .where(and(eq(clients.tenantId, tenantId), sql`${clients.userId} is not null`))
    .limit(1);

  const url =
    spec.slug === 'main' ? 'http://localhost:3000' : `http://${spec.slug}.localhost:3000`;
  const pad = (email: string) => email + ' '.repeat(Math.max(1, 30 - email.length));
  return [
    `  ${spec.name} - ${url}`,
    `    ${spec.clientCount} clients, ${caseSeq} cases, ${documentCount} documents, ${messageCount} messages`,
    `    ${pad(spec.manager.email)}(manager)`,
    ...spec.consultants.map((c) => `    ${pad(c.email)}(consultant)`),
    ...(sampleClient ? [`    ${pad(sampleClient.email)}(client)`] : []),
    '',
  ].join('\n');
}

/** Real pipelines are bottom-heavy: most cases sit in the early stages. */
function weightedStage(): Stage {
  const weights: [Stage, number][] = [
    ['inquiry', 10],
    ['shortlisting', 10],
    ['documents_collection', 22],
    ['application_submitted', 12],
    ['offer_letter', 8],
    ['fee_payment', 6],
    ['visa_filed', 6],
    ['visa_interview', 3],
    ['visa_decision', 3],
    // A consultancy nine months old has finished a fair number of cases. Too
    // few here and every outcome figure on every dashboard reads as zero.
    ['closed', 20],
  ];
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let roll = rand() * total;
  for (const [stage, w] of weights) {
    roll -= w;
    if (roll <= 0) return stage;
  }
  return 'inquiry';
}

const REJECTION_REASONS = [
  'The scan is cut off at the bottom - please re-upload the full page.',
  'This is expired. We need a document valid for at least 6 more months.',
  'Photo is too blurry to read the reference number.',
  'This is the wrong document - we need the transcript, not the degree.',
  'Bank statement is not stamped by the bank.',
];

const CLIENT_MESSAGES = [
  'Assalam o alaikum, has my transcript been checked yet?',
  'I have uploaded the bank statement, please confirm.',
  'When will I hear back from the university?',
  'Can I use my father as sponsor instead?',
  'Thank you so much for the update!',
];

const CONSULTANT_MESSAGES = [
  'Walaikum assalam. Yes, I have verified it just now.',
  'Received, thank you. I will review it by tomorrow.',
  'Universities usually take 3-4 weeks at this time of year.',
  'Yes, that is fine. Please upload his affidavit and bank statement.',
  'Please re-upload the passport - the bottom edge is cut off.',
];

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});

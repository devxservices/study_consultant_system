import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../connection';
import {
  announcements,
  attributionConflicts,
  clients,
  commissions,
  consultants,
  financeSettings,
  partnerAdvances,
  partnerAgreements,
  partnerDocuments,
  partnerEarnings,
  partnerMembers,
  partnerMessages,
  partnerRules,
  partnerSettings,
  partners,
  payouts,
  receiptAllocations,
  institutionReceipts,
  tenants,
  users,
} from '../schema';
import { postEntry, systemAccountId, systemAccountIds } from '../../finance/journal';
import { hashPassword } from '../../auth/local-auth.provider';
import { seal } from '../../auth/secret-box';
import { agreementHash } from '../../partners/agreements.service';
import { DEFAULT_AGREEMENT } from '../../partners/partners.service';
import { env } from '../../config/env';
import { LocalStorageDriver } from '../../storage/local.driver';
import { S3StorageDriver } from '../../storage/s3.driver';

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const PASSWORD = process.env.SEED_PASSWORD ?? 'password123';

/**
 * Demo partners for a consultancy that has none: a master partner (active,
 * papers approved, agreement signed in the app) with a sub-agent under it, a
 * partner still onboarding, and a fresh application from the public form.
 * Some of the consultancy's students are credited to them; their earnings are
 * worked out by the same rules the app uses and booked as it would book them;
 * the master partner has been paid once (with tax withheld and an advance
 * taken back). A registration clash waits in the queue. Logins use the demo
 * password. Safe to re-run: it does nothing where partners exist.
 */
export async function seedPartners(db: Db, tenantId: string): Promise<{ partners: number; earnings: number; payouts: number }> {
  const none = { partners: 0, earnings: 0, payouts: 0 };
  const [has] = await db.select({ n: sql<number>`count(*)::int` }).from(partners).where(eq(partners.tenantId, tenantId));
  if ((has?.n ?? 0) > 0) return none;
  const [tenant] = await db.select({ slug: tenants.slug, name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const [manager] = await db.select({ id: users.id }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.role, 'manager'))).limit(1);
  const [consultant] = await db
    .select({ userId: users.id, consultantId: consultants.id })
    .from(consultants)
    .innerJoin(users, eq(users.id, consultants.userId))
    .where(and(eq(users.tenantId, tenantId), eq(users.isActive, true)))
    .orderBy(asc(users.createdAt))
    .limit(1);
  if (!manager || !tenant) return none;
  const by = manager.id;
  const [fs] = await db.select({ base: financeSettings.baseCurrency }).from(financeSettings).where(eq(financeSettings.tenantId, tenantId)).limit(1);
  const base = fs?.base ?? 'PKR';
  await systemAccountIds(db, tenantId);
  const bank = await systemAccountId(db, tenantId, 'bank');
  await db.insert(partnerSettings).values({ tenantId }).onConflictDoNothing();
  await db.update(partnerSettings).set({ defaultWithholdingBp: 1000 }).where(eq(partnerSettings.tenantId, tenantId));
  const domain = `${tenant.slug}.example`;
  const passwordHash = await hashPassword(PASSWORD);

  /* ---------------- The partners ---------------- */
  const year = new Date().getFullYear();
  const make = async (n: number, values: Partial<typeof partners.$inferInsert> & { name: string; email: string; contactName: string }) => {
    const [row] = await db
      .insert(partners)
      .values({
        tenantId,
        number: `PTR-${year}-${String(n).padStart(4, '0')}`,
        kind: 'sub_agent',
        phone: '+92 42 3500 0000',
        country: 'Pakistan',
        currency: base,
        createdBy: by,
        ...values,
      })
      .returning();
    return row!;
  };
  const lge = await make(1, {
    name: 'Lahore Global Education',
    contactName: 'Ayesha Raza',
    email: `office@lge.${domain}`,
    phone: '+92 42 3571 2233',
    city: 'Lahore',
    address: '14-B Main Boulevard, Gulberg III',
    website: 'https://lge.example',
    registrationNumber: 'SECP-0098231',
    taxId: '4420981-7',
    tier: 'gold',
    status: 'active',
    managerUserId: consultant?.userId ?? by,
    approvedAt: new Date(Date.now() - 200 * 86_400_000),
    approvedBy: by,
    bankSealed: seal(JSON.stringify({ accountTitle: 'Lahore Global Education', bankName: 'Meezan Bank', iban: 'PK36MEZN0002010101234567', swift: null })),
  });
  const msl = await make(2, {
    name: 'Multan Study Link',
    contactName: 'Usman Tariq',
    email: `desk@msl.${domain}`,
    phone: '+92 61 451 7788',
    city: 'Multan',
    tier: 'standard',
    status: 'active',
    parentPartnerId: lge.id,
    overrideBp: 500,
    managerUserId: consultant?.userId ?? by,
    approvedAt: new Date(Date.now() - 120 * 86_400_000),
    approvedBy: by,
  });
  const kp = await make(3, {
    name: 'Karachi Pathways',
    contactName: 'Sana Iqbal',
    email: `team@kp.${domain}`,
    phone: '+92 21 3587 4410',
    city: 'Karachi',
    status: 'onboarding',
  });
  await make(4, {
    name: 'Skyline Overseas',
    contactName: 'Hamza Qureshi',
    email: `hello@skyline.${domain}`,
    city: 'Islamabad',
    status: 'applied',
    source: 'applied',
    application: { studentsPerYear: 40, message: 'We have placed students in the UK and Canada for six years and would like to add your universities.' },
  });

  /* ---------------- Their logins ---------------- */
  const member = async (partnerId: string, fullName: string, email: string, role: string) => {
    const [u] = await db.insert(users).values({ tenantId, email, passwordHash, fullName, role: 'partner', partnerId }).returning({ id: users.id });
    await db.insert(partnerMembers).values({ tenantId, partnerId, userId: u!.id, role, createdBy: by });
    return u!.id;
  };
  const lgeOwner = await member(lge.id, 'Ayesha Raza', `ayesha@lge.${domain}`, 'owner');
  await member(lge.id, 'Bilal Ahmed', `bilal@lge.${domain}`, 'counsellor');
  await member(msl.id, 'Usman Tariq', `usman@msl.${domain}`, 'owner');
  await member(kp.id, 'Sana Iqbal', `sana@kp.${domain}`, 'owner');

  /* ---------------- Papers and agreements ---------------- */
  // One small real PDF behind every demo paper, so opening one works.
  const storage = env().STORAGE_DRIVER === 's3' ? new S3StorageDriver() : new LocalStorageDriver();
  const STORAGE_DEMO_PDF = `tenants/${tenantId}/partners/demo-paper.pdf`;
  await storage.put(STORAGE_DEMO_PDF, demoPdf('Registration paper (demo)'), 'application/pdf');
  for (const p of [lge, msl]) {
    for (const kind of ['registration', 'owner_id', 'bank']) {
      await db.insert(partnerDocuments).values({ tenantId, partnerId: p.id, kind, name: `${kind}.pdf`, storageKey: STORAGE_DEMO_PDF, mime: 'application/pdf', size: 1200, status: 'approved', uploadedBy: by, reviewedBy: by, reviewedAt: new Date() });
    }
  }
  await db.insert(partnerDocuments).values({ tenantId, partnerId: kp.id, kind: 'registration', name: 'registration.pdf', storageKey: STORAGE_DEMO_PDF, mime: 'application/pdf', size: 1200, status: 'pending', uploadedBy: by });
  const body = (name: string) =>
    DEFAULT_AGREEMENT.replaceAll('{partner}', name)
      .replaceAll('{consultancy}', tenant.name)
      .replaceAll('{date}', new Date(Date.now() - 210 * 86_400_000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }));
  for (const [p, signer] of [
    [lge, 'Ayesha Raza'],
    [msl, 'Usman Tariq'],
  ] as const) {
    const a = { title: `Partner agreement: ${p.name}`, body: body(p.name), validFrom: day(-210), validTo: null };
    await db.insert(partnerAgreements).values({
      tenantId,
      partnerId: p.id,
      version: 1,
      ...a,
      status: 'signed',
      documentHash: agreementHash(a),
      sentAt: new Date(Date.now() - 205 * 86_400_000),
      sentBy: by,
      signedAt: new Date(Date.now() - 203 * 86_400_000),
      signerName: signer,
      signerTitle: 'Director',
      signatureKind: 'typed',
      signature: signer,
      signerIp: '39.40.12.8',
      signerUserAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      createdBy: by,
    });
  }
  const kpa = { title: 'Partner agreement: Karachi Pathways', body: body('Karachi Pathways'), validFrom: day(-3), validTo: null };
  await db.insert(partnerAgreements).values({ tenantId, partnerId: kp.id, version: 1, ...kpa, status: 'sent', documentHash: agreementHash(kpa), sentAt: new Date(Date.now() - 2 * 86_400_000), sentBy: by, createdBy: by });

  /* ---------------- Rules ---------------- */
  const rule = async (values: Partial<typeof partnerRules.$inferInsert> & { name: string; basis: string }) => {
    const [r] = await db.insert(partnerRules).values({ tenantId, ruleKey: crypto.randomUUID(), version: 1, validFrom: day(-365), createdBy: by, ...values }).returning();
    return r!;
  };
  const share = await rule({ name: 'Standard: 40% of university commission', basis: 'commission_share', rateBp: 4000 });
  const gold = await rule({ name: 'Gold partners: 50% of university commission', basis: 'commission_share', rateBp: 5000, tier: 'gold' });
  const fixed = await rule({ name: 'Lahore Global Education: per enrolled student', basis: 'fixed_per_student', fixedAmount: 15_000_00, currency: base, partnerId: lge.id });
  await rule({ name: 'Counselling fees: 10%', basis: 'fee_share', rateBp: 1000, feeCategories: ['service'] });

  /* ---------------- Students ---------------- */
  // What the universities have actually paid, commission by commission.
  const received = await db
    .select({ a: receiptAllocations, r: institutionReceipts, c: commissions })
    .from(receiptAllocations)
    .innerJoin(institutionReceipts, eq(institutionReceipts.id, receiptAllocations.receiptId))
    .innerJoin(commissions, eq(commissions.id, receiptAllocations.commissionId))
    .where(and(eq(receiptAllocations.tenantId, tenantId), sql`${receiptAllocations.amount} > 0`, sql`${institutionReceipts.voidedAt} is null`, isNotNull(commissions.clientId)));
  // The sub-agent brought a student the university has paid on, so its share and its master's override are real;
  // the master partner brought most of the other students with commission.
  const toMsl = [...new Set(received.map((x) => x.c.clientId!))].slice(0, 1);
  const withCommission = await db
    .selectDistinct({ clientId: commissions.clientId })
    .from(commissions)
    .where(and(eq(commissions.tenantId, tenantId), isNotNull(commissions.clientId), eq(commissions.kind, 'student')));
  const toLge = withCommission.map((r) => r.clientId!).filter((id) => !toMsl.includes(id)).slice(0, 6);
  if (toLge.length) await db.update(clients).set({ partnerId: lge.id, partnerAttributedAt: new Date(Date.now() - 150 * 86_400_000), partnerRegisteredBy: lgeOwner }).where(inArray(clients.id, toLge));
  if (toMsl.length) await db.update(clients).set({ partnerId: msl.id, partnerAttributedAt: new Date(Date.now() - 140 * 86_400_000) }).where(inArray(clients.id, toMsl));

  /* ---------------- Earnings, as the rules make them ---------------- */
  let n = 0;
  const earn = async (values: { partner: typeof lge; kind: string; clientId: string | null; sourceType: string; sourceId: string; ruleId: string | null; description: string; basisAmount: number | null; basisCurrency: string | null; rateBp: number | null; amount: number; earnedOn: string; fromPartnerId?: string | null; relatedEarningId?: string | null }) => {
    n++;
    return db.transaction(async (tx) => {
      const [e] = await tx
        .insert(partnerEarnings)
        .values({
          tenantId,
          number: `PE-${year}-${String(n).padStart(4, '0')}`,
          partnerId: values.partner.id,
          kind: values.kind,
          clientId: values.clientId,
          fromPartnerId: values.fromPartnerId ?? null,
          sourceType: values.sourceType,
          sourceId: values.sourceId,
          relatedEarningId: values.relatedEarningId ?? null,
          ruleId: values.ruleId,
          description: values.description,
          basisAmount: values.basisAmount,
          basisCurrency: values.basisCurrency,
          rateBp: values.rateBp,
          amount: values.amount,
          currency: base,
          fxRate: '1',
          earnedOn: values.earnedOn,
          createdBy: by,
        })
        .returning();
      await postEntry(tx, {
        tenantId,
        date: values.earnedOn,
        memo: `${e!.number}: ${values.partner.name} - ${values.description}`,
        currency: base,
        fxRate: 1,
        sourceType: 'partner_earning',
        sourceId: e!.id,
        createdBy: by,
        lines: [
          { account: 'partner_commission', debit: values.amount, clientId: values.clientId },
          { account: 'partner_payable', credit: values.amount },
        ],
      });
      return e!;
    });
  };
  const made: (typeof partnerEarnings.$inferSelect)[] = [];
  // The master partner's fixed amount, for each of its students whose enrolment was confirmed.
  const confirmed = await db
    .select({ c: commissions })
    .from(commissions)
    .where(and(eq(commissions.tenantId, tenantId), inArray(commissions.clientId, toLge.length ? toLge : ['00000000-0000-0000-0000-000000000000']), eq(commissions.kind, 'student'), eq(commissions.yearNo, 1), inArray(commissions.status, ['confirmed', 'claimed'])));
  for (const { c } of confirmed) {
    const on = c.confirmedAt ? c.confirmedAt.toISOString().slice(0, 10) : day(-20);
    made.push(await earn({ partner: lge, kind: 'fixed_per_student', clientId: c.clientId, sourceType: 'commission', sourceId: c.id, ruleId: fixed.id, description: `Student enrolled (${c.intake ?? c.number})`, basisAmount: 15_000_00, basisCurrency: base, rateBp: null, amount: 15_000_00, earnedOn: on }));
  }
  // Shares of what the universities paid, converted at the rate each payment was received at.
  for (const { a, r, c } of received) {
    const rate = c.currency === base ? 1 : r.fxRate ? Number(r.fxRate) : null;
    if (rate === null) continue;
    const basis = Math.round(a.amount * rate);
    const paid = `${(a.amount / 100).toFixed(2)} ${c.currency} received on ${c.number}`;
    if (toLge.includes(c.clientId!)) {
      made.push(await earn({ partner: lge, kind: 'commission_share', clientId: c.clientId, sourceType: 'receipt_allocation', sourceId: a.id, ruleId: gold.id, description: `50% of ${paid}`, basisAmount: a.amount, basisCurrency: c.currency, rateBp: 5000, amount: Math.round(basis / 2), earnedOn: r.receivedOn }));
    } else if (toMsl.includes(c.clientId!)) {
      const e = await earn({ partner: msl, kind: 'commission_share', clientId: c.clientId, sourceType: 'receipt_allocation', sourceId: a.id, ruleId: share.id, description: `40% of ${paid}`, basisAmount: a.amount, basisCurrency: c.currency, rateBp: 4000, amount: Math.round((basis * 4) / 10), earnedOn: r.receivedOn });
      made.push(e);
      made.push(await earn({ partner: lge, kind: 'override', clientId: c.clientId, fromPartnerId: msl.id, relatedEarningId: e.id, sourceType: 'receipt_allocation', sourceId: a.id, ruleId: null, description: '5% override on Multan Study Link: commission share', basisAmount: basis, basisCurrency: base, rateBp: 500, amount: Math.round(basis / 20), earnedOn: r.receivedOn }));
    }
  }

  /* ---------------- An advance, and a payout that took some of it back ---------------- */
  let payoutCount = 0;
  const lgeOwed = made.filter((e) => e.partnerId === lge.id && e.earnedOn <= day(-10));
  const [adv] = await db.transaction(async (tx) => {
    const rows = await tx.insert(partnerAdvances).values({ tenantId, number: `ADV-${year}-0001`, partnerId: lge.id, amount: 50_000_00, currency: base, givenOn: day(-90), accountId: bank, fxRate: '1', reason: 'Office set-up for the new Faisalabad branch', createdBy: by }).returning();
    await postEntry(tx, { tenantId, date: day(-90), memo: `ADV-${year}-0001: advance to ${lge.name}`, currency: base, fxRate: 1, sourceType: 'partner_advance', sourceId: rows[0]!.id, createdBy: by, lines: [{ account: 'partner_advances', debit: 50_000_00 }, { account: { id: bank }, credit: 50_000_00 }] });
    return rows;
  });
  if (lgeOwed.length) {
    const gross = lgeOwed.reduce((s, e) => s + e.amount, 0);
    const withholding = Math.round(gross / 10);
    const recovered = Math.min(20_000_00, Math.floor((gross - withholding) / 2));
    const net = gross - withholding - recovered;
    await db.transaction(async (tx) => {
      const [p] = await tx
        .insert(payouts)
        .values({ tenantId, number: `PO-${year}-0001`, partnerId: lge.id, currency: base, periodLabel: 'Fall intake commissions', status: 'paid', gross, withholdingBp: 1000, withholding, advanceRecovered: recovered, net, approvedBy: consultant?.userId ?? by, approvedAt: new Date(Date.now() - 4 * 86_400_000), paidOn: day(-3), accountId: bank, method: 'bank_transfer', reference: 'IBFT-220931', fxRate: '1', paidBy: by, createdBy: by })
        .returning();
      await tx.update(partnerEarnings).set({ status: 'paid', payoutId: p!.id }).where(inArray(partnerEarnings.id, lgeOwed.map((e) => e.id)));
      await tx.execute(sql`insert into advance_recoveries (tenant_id, advance_id, payout_id, amount) values (${tenantId}, ${adv!.id}, ${p!.id}, ${recovered})`);
      await tx.update(partnerAdvances).set({ recovered }).where(eq(partnerAdvances.id, adv!.id));
      await postEntry(tx, {
        tenantId,
        date: day(-3),
        memo: `PO-${year}-0001: payout to ${lge.name} (Fall intake commissions), ref IBFT-220931`,
        currency: base,
        fxRate: 1,
        sourceType: 'payout',
        sourceId: p!.id,
        createdBy: by,
        lines: [
          { account: 'partner_payable', debit: gross },
          { account: 'withholding_payable', credit: withholding },
          { account: 'partner_advances', credit: recovered },
          { account: { id: bank }, credit: net },
        ],
      });
    });
    payoutCount++;
  }

  /* ---------------- A clash, messages, an announcement ---------------- */
  const [someone] = await db
    .select({ id: clients.id, fullName: clients.fullName, email: clients.email, phone: clients.phone, partnerId: clients.partnerId })
    .from(clients)
    .where(and(eq(clients.tenantId, tenantId), sql`${clients.partnerId} is null`))
    .orderBy(asc(clients.createdAt))
    .limit(1);
  if (someone) {
    await db.insert(attributionConflicts).values({
      tenantId,
      clientId: someone.id,
      currentPartnerId: null,
      claimantPartnerId: kp.id,
      matchedOn: ['phone'],
      submitted: { fullName: someone.fullName, email: `${someone.email.split('@')[0]}.kp@gmail.com`, phone: someone.phone, passportNumber: null, notes: 'Walked into our Karachi office last month.' },
    });
  }
  await db.insert(partnerMessages).values([
    { tenantId, partnerId: lge.id, authorId: lgeOwner, fromPartner: true, body: 'Assalam o alaikum - can you confirm when the September CAS letters will be issued? Two of our students are waiting to book biometrics.', createdAt: new Date(Date.now() - 2 * 86_400_000) },
    { tenantId, partnerId: lge.id, authorId: consultant?.userId ?? by, fromPartner: false, body: 'Wa alaikum assalam. The universities have confirmed this week; we will upload them to each student’s file as they arrive.', createdAt: new Date(Date.now() - 86_400_000) },
  ]);
  await db.insert(announcements).values({ tenantId, title: 'January intakes are open', body: 'Six of our UK partner universities have opened January intakes. Deposits are due by 30 November; the updated price list is in Resources.', audience: 'partners', pinned: true, createdBy: by });

  return { partners: 4, earnings: made.length, payouts: payoutCount };
}

/** A one-page PDF with a line of text. */
function demoPdf(title: string): Buffer {
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

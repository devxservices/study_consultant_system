import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { STAGES, type Stage } from '@crm/shared';
import type { Db } from '../connection';
import {
  cases,
  commissionAgreements,
  commissionClaims,
  commissionRules,
  commissionSettings,
  commissionSplits,
  financeSettings,
  commissions,
  consultants,
  institutionContacts,
  institutionReceipts,
  institutions,
  receiptAllocations,
  users,
} from '../schema';
import { postEntry, systemAccountId, systemAccountIds } from '../../finance/journal';
import { withDocumentNumber } from '../../common/db-helpers';

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
/** When an intake starts: "Fall 2026" is mid-September, "Spring 2027" is February. */
function intakeStart(intake: string | null): string | null {
  const m = /^(fall|autumn|spring|winter|summer|january|february|september)\s+(\d{4})$/i.exec(intake?.trim() ?? '');
  if (!m) return null;
  const month: Record<string, string> = { fall: '09-14', autumn: '09-14', september: '09-14', spring: '02-02', february: '02-02', winter: '01-12', january: '01-12', summer: '06-01' };
  return `${m[2]}-${month[m[1]!.toLowerCase()]}`;
}
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** First-year tuition by the currency the institution charges in (minor units). */
const TUITION: Record<string, number> = { GBP: 16_500_00, CAD: 28_000_00, AUD: 38_500_00, USD: 32_000_00, EUR: 12_000_00, NZD: 34_000_00 };
/** Rates to PKR on the demo's books. */
const TO_PKR: Record<string, number> = { GBP: 355, CAD: 205, AUD: 185, USD: 280, EUR: 300, NZD: 168, PKR: 1 };

const RULE_STYLES = [
  { name: 'Undergraduate and postgraduate', ratePercent: 15, years: 'first_year', yearCount: 1, tiers: [{ fromStudents: 5, ratePercent: 17.5 }], bonusStudents: null, bonusAmount: null, retentionDays: 90 },
  { name: 'All taught programmes', ratePercent: 12, years: 'each_year', yearCount: 3, tiers: [], bonusStudents: null, bonusAmount: null, retentionDays: 60 },
  { name: 'Standard rate', ratePercent: 20, years: 'first_year', yearCount: 1, tiers: [], bonusStudents: 3, bonusAmount: 1_500_00, retentionDays: 0 },
] as const;

const CONTACTS = [
  { name: 'Sarah Whitfield', role: 'International partnerships manager' },
  { name: 'Daniel Okafor', role: 'Agent relations officer' },
  { name: 'Mei Lin', role: 'Regional manager, South Asia' },
];

/**
 * Demo data for commissions: an agreement with each university the
 * applications already name, tuition on those applications, commission
 * expected on them and earned on those whose course has started, a claim
 * sent to one university and part paid net of bank charges and with its
 * exchange difference, and the consultant's share of each. Everything posts
 * to the journal as the app would. Fills only a
 * consultancy with no agreements yet, so it is safe to re-run.
 */
export async function seedCommissions(db: Db, tenantId: string): Promise<{ agreements: number; commissions: number; claims: number; receipts: number }> {
  const none = { agreements: 0, commissions: 0, claims: 0, receipts: 0 };
  const [has] = await db.select({ n: sql<number>`count(*)::int` }).from(commissionAgreements).where(eq(commissionAgreements.tenantId, tenantId));
  if ((has?.n ?? 0) > 0) return none;
  let insts = await db.select().from(institutions).where(eq(institutions.tenantId, tenantId)).orderBy(asc(institutions.name)).limit(8);
  if (insts.length === 0) {
    // A database seeded after migrating has no catalogue yet: migration 0011
    // builds it from applications that existed then. Do the same from today's.
    await db.execute(sql`
      insert into institutions (tenant_id, name, country, currency, notes)
      select distinct on (lower(trim(c.target_university)))
        c.tenant_id, trim(c.target_university), c.target_country,
        coalesce(
          (select co.currency from countries co where co.tenant_id = c.tenant_id and lower(co.name) = lower(c.target_country) limit 1),
          case lower(c.target_country)
            when 'united kingdom' then 'GBP' when 'uk' then 'GBP' when 'canada' then 'CAD' when 'australia' then 'AUD'
            when 'germany' then 'EUR' when 'ireland' then 'EUR' else 'USD' end),
        'Added from the applications already on file.'
      from cases c
      where c.tenant_id = ${tenantId} and c.target_university is not null and length(trim(c.target_university)) >= 2
      order by lower(trim(c.target_university)), c.created_at
      on conflict do nothing`);
    await db.execute(sql`
      update cases c set institution_id = i.id from institutions i
      where c.tenant_id = ${tenantId} and i.tenant_id = c.tenant_id
        and lower(i.name) = lower(trim(c.target_university)) and c.institution_id is null`);
    insts = await db.select().from(institutions).where(eq(institutions.tenantId, tenantId)).orderBy(asc(institutions.name)).limit(8);
  }
  if (insts.length === 0) return none;

  await systemAccountIds(db, tenantId);
  const bank = await systemAccountId(db, tenantId, 'bank');
  const [settings] = await db.select({ base: financeSettings.baseCurrency }).from(financeSettings).where(eq(financeSettings.tenantId, tenantId)).limit(1);
  const base = settings?.base ?? 'PKR';
  /** The demo's rate from a currency to the books' currency; null when the demo has no rate for it. */
  const rateOf = (currency: string): number | null => (currency === base ? 1 : TO_PKR[currency] && TO_PKR[base] ? TO_PKR[currency]! / TO_PKR[base]! : null);
  const [manager] = await db.select({ id: users.id }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.role, 'manager'))).limit(1);
  const by = manager?.id ?? null;

  // Consultants keep 10% of what their students earn.
  await db.insert(commissionSettings).values({ tenantId, consultantShareBp: 1000 }).onConflictDoUpdate({ target: commissionSettings.tenantId, set: { consultantShareBp: 1000 } });

  /* ---------------- Agreements, one per institution ---------------- */
  const agreementOf = new Map<string, { id: string; ruleId: string; style: (typeof RULE_STYLES)[number]; claimAfterDays: number; paymentTermsDays: number; currency: string }>();
  for (const [i, inst] of insts.entries()) {
    const style = RULE_STYLES[i % RULE_STYLES.length]!;
    const contact = CONTACTS[i % CONTACTS.length]!;
    const domain = inst.name.toLowerCase().replace(/[^a-z]+/g, '').slice(0, 18) || 'university';
    await db.insert(institutionContacts).values({ tenantId, institutionId: inst.id, name: contact.name, role: contact.role, email: `partnerships@${domain}.ac.uk`, primary: true, position: 0 });
    await db.update(institutions).set({ website: inst.website ?? `https://www.${domain}.ac.uk`, updatedAt: new Date() }).where(eq(institutions.id, inst.id));
    // Claimable two weeks after the course starts (the census date), paid within 30 or 45 days of the claim.
    const terms = { claimAfterDays: 14, paymentTermsDays: i % 2 === 0 ? 45 : 30 };
    const [agreement] = await db
      .insert(commissionAgreements)
      .values({
        tenantId,
        institutionId: inst.id,
        title: `${new Date().getFullYear()} recruitment agreement`,
        reference: `AGR-${String(i + 1).padStart(3, '0')}`,
        validFrom: day(-300),
        validTo: day(430),
        currency: inst.currency,
        ...terms,
        notes: 'Commission on tuition net of scholarships, paid after the census date.',
        createdBy: by,
      })
      .returning();
    const [rule] = await db
      .insert(commissionRules)
      .values({
        tenantId,
        agreementId: agreement!.id,
        position: 0,
        name: style.name,
        basis: 'percent',
        rateBp: Math.round(style.ratePercent * 100),
        years: style.years,
        yearCount: style.yearCount,
        tiers: [...style.tiers],
        bonusStudents: style.bonusStudents,
        bonusAmount: style.bonusAmount,
        retentionDays: style.retentionDays,
        triggerStage: 'fee_payment',
      })
      .returning();
    agreementOf.set(inst.id, { id: agreement!.id, ruleId: rule!.id, style, ...terms, currency: inst.currency });
  }

  /* ---------------- Tuition on the applications ---------------- */
  const apps = await db
    .select({ c: cases, consultantUserId: consultants.userId })
    .from(cases)
    .leftJoin(consultants, eq(consultants.id, cases.consultantId))
    .where(and(eq(cases.tenantId, tenantId), isNotNull(cases.institutionId), inArray(cases.institutionId, insts.map((x) => x.id))));
  for (const [i, a] of apps.entries()) {
    if (a.c.tuitionFee !== null) continue;
    const currency = insts.find((x) => x.id === a.c.institutionId)!.currency;
    const tuition = (TUITION[currency] ?? 15_000_00) + (i % 4) * 500_00;
    const scholarship = i % 5 === 0 ? 2_000_00 : null;
    const courseStart = a.c.courseStart ?? intakeStart(a.c.intake) ?? day(60 + (i % 4) * 30);
    await db.update(cases).set({ tuitionFee: tuition, tuitionCurrency: currency, scholarship, courseStart }).where(eq(cases.id, a.c.id));
    a.c.tuitionFee = tuition;
    a.c.tuitionCurrency = currency;
    a.c.scholarship = scholarship;
    a.c.courseStart = courseStart;
  }

  /* ---------------- Commission on those past the deposit ---------------- */
  /** The census date, a week into the course - or today, if that is still to come. */
  const enrolledOn = (start: string | null) => { const d = start ? addDays(start, 7) : day(-1); return d <= day(0) ? d : day(0); };
  const reached = (s: string) => STAGES.indexOf(s as Stage) >= STAGES.indexOf('fee_payment');
  type Made = { id: string; number: string; institutionId: string; amount: number; currency: string; status: string; clientId: string; consultantUserId: string | null };
  const made: Made[] = [];
  for (const a of apps) {
    const c = a.c;
    if (!reached(c.currentStage) || c.status === 'withdrawn' || c.status === 'rejected') continue;
    const ag = agreementOf.get(c.institutionId!)!;
    const net = Math.max(0, (c.tuitionFee ?? 0) - (c.scholarship ?? 0));
    const rateBp = Math.round(ag.style.ratePercent * 100);
    // Earned once the student is on the course: their visa came through and the course has started.
    const onCourse = c.status === 'approved' || c.currentStage === 'closed' || c.currentStage === 'visa_decision';
    const enrolled = onCourse && Boolean(c.courseStart && c.courseStart <= day(0));
    const years = ag.style.years === 'each_year' ? ag.style.yearCount : 1;
    for (let year = 1; year <= years; year++) {
      const start = c.courseStart ? `${Number(c.courseStart.slice(0, 4)) + year - 1}${c.courseStart.slice(4)}` : null;
      const claimableOn = start ? addDays(start, ag.claimAfterDays) : null;
      // Only the first year of an enrolled student is earned; later years wait for them to re-enrol.
      const confirmed = enrolled && year === 1;
      const amount = Math.round((net * rateBp) / 10_000);
      if (amount <= 0) continue;
      const row = await withDocumentNumber(db, commissions, tenantId, 'COM', async (number) => {
        const [r] = await db
          .insert(commissions)
          .values({
            tenantId,
            number,
            kind: 'student',
            caseId: c.id,
            clientId: c.clientId,
            institutionId: c.institutionId!,
            agreementId: ag.id,
            ruleId: ag.ruleId,
            ruleSnapshot: { name: ag.style.name, basis: 'percent', rateBp, fixedAmount: 0, years: ag.style.years, yearCount: ag.style.yearCount, tiers: ag.style.tiers, retentionDays: ag.style.retentionDays, agreementVersion: 1 },
            yearNo: year,
            intake: c.intake,
            tuition: net,
            rateBp,
            amount,
            currency: ag.currency,
            fxRate: confirmed && rateOf(ag.currency) !== null ? String(rateOf(ag.currency)) : null,
            status: confirmed ? 'confirmed' : 'expected',
            claimableOn,
            expectedOn: claimableOn ? addDays(claimableOn, ag.paymentTermsDays) : null,
            retentionUntil: confirmed && ag.style.retentionDays && start ? addDays(start, ag.style.retentionDays) : null,
            confirmedAt: confirmed ? new Date(`${enrolledOn(start)}T09:00:00Z`) : null,
            createdBy: by,
          })
          .onConflictDoNothing()
          .returning();
        return r ?? null;
      });
      if (!row) continue;
      if (confirmed) {
        await db.transaction((tx) =>
          postEntry(tx, {
            tenantId,
            date: enrolledOn(start),
            memo: `Commission ${row.number}, year ${year}`,
            currency: ag.currency,
            fxRate: rateOf(ag.currency),
            sourceType: 'commission',
            sourceId: row.id,
            createdBy: by,
            lines: [
              { account: 'commission_receivable', debit: amount, clientId: c.clientId },
              { account: 'commission_income', credit: amount },
            ],
          }),
        );
      }
      if (a.consultantUserId) await db.insert(commissionSplits).values({ tenantId, commissionId: row.id, userId: a.consultantUserId, shareBp: 1000 }).onConflictDoNothing();
      made.push({ id: row.id, number: row.number, institutionId: row.institutionId, amount, currency: ag.currency, status: row.status, clientId: c.clientId, consultantUserId: a.consultantUserId });
    }
  }

  /* ---------------- A claim, sent, and part paid ---------------- */
  let claimCount = 0;
  let receiptCount = 0;
  const confirmedByInst = new Map<string, Made[]>();
  for (const m of made.filter((x) => x.status === 'confirmed')) confirmedByInst.set(m.institutionId, [...(confirmedByInst.get(m.institutionId) ?? []), m]);
  const [first] = [...confirmedByInst.entries()].sort((a, b) => b[1].length - a[1].length);
  if (first) {
    const [institutionId, items] = first;
    const currency = items[0]!.currency;
    const inst = insts.find((x) => x.id === institutionId)!;
    const claim = await withDocumentNumber(db, commissionClaims, tenantId, 'CLM', async (number) => {
      const [r] = await db
        .insert(commissionClaims)
        .values({ tenantId, number, institutionId, currency, periodLabel: 'Fall 2026 intake', status: 'submitted', submittedOn: day(-4), dueOn: addDays(day(-4), agreementOf.get(institutionId)!.paymentTermsDays), createdBy: by })
        .returning();
      return r!;
    });
    claimCount++;
    await db.update(commissions).set({ status: 'claimed', claimId: claim.id }).where(inArray(commissions.id, items.map((x) => x.id)));

    // The university has paid, less its bank's charges: the first commission in full, or part of the only one.
    const paid = items[0]!;
    const sent = items.length > 1 ? paid.amount : Math.round(paid.amount * 0.6);
    const charges = 25_00;
    const booked = rateOf(currency);
    const rate = booked === null ? null : currency === base ? 1 : Math.round(booked * 1.01 * 10_000) / 10_000;
    const [receipts] = await db.select({ n: sql<number>`count(*)::int` }).from(institutionReceipts).where(eq(institutionReceipts.tenantId, tenantId));
    const receiptNumber = `CRX-${new Date().getFullYear()}-${String((receipts?.n ?? 0) + 1).padStart(4, '0')}`;
    await db.transaction(async (tx) => {
      const [receipt] = await tx
        .insert(institutionReceipts)
        .values({
          tenantId,
          number: receiptNumber,
          institutionId,
          receivedOn: day(-1),
          currency,
          amount: sent,
          bankCharges: charges,
          fxRate: rate === null ? null : String(rate),
          accountId: bank,
          method: 'bank_transfer',
          reference: `${inst.name.split(' ')[0]!.toUpperCase()}-REMIT-4471`,
          claimId: claim.id,
          createdBy: by,
        })
        .returning();
      const fxDifference = rate !== null && booked !== null ? Math.round(sent * (rate - booked)) : 0;
      await tx.insert(receiptAllocations).values({ tenantId, receiptId: receipt!.id, commissionId: paid.id, amount: sent, fxDifference });
      await postEntry(tx, {
        tenantId,
        date: day(-1),
        memo: `${receipt!.number}: ${inst.name}`,
        currency,
        fxRate: rate,
        sourceType: 'commission_receipt',
        sourceId: receipt!.id,
        createdBy: by,
        lines: [
          { account: { id: bank }, debit: sent - charges },
          { account: 'bank_charges', debit: charges },
          { account: 'commission_receivable', credit: sent },
        ],
      });
      if (fxDifference !== 0) {
        const gain = fxDifference > 0;
        const n = Math.abs(fxDifference);
        await postEntry(tx, {
          tenantId,
          date: day(-1),
          memo: `${receipt!.number}: exchange difference on ${inst.name}`,
          currency: base,
          fxRate: 1,
          sourceType: 'commission_receipt',
          sourceId: receipt!.id,
          createdBy: by,
          lines: [
            { account: gain ? 'commission_receivable' : 'fx_differences', debit: n },
            { account: gain ? 'fx_differences' : 'commission_receivable', credit: n },
          ],
        });
      }
    });
    receiptCount++;
  }

  return { agreements: agreementOf.size, commissions: made.length, claims: claimCount, receipts: receiptCount };
}

import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../connection';
import { docFolders, documents, folderTemplates, requirementSets } from '../schema';

/**
 * Demo data for the documents drive: checklists per destination, a
 * country-specific folder template, the agency's own folders, and expiry
 * dates on passports and test results so the Expiring view and its reminders
 * have something to show. Fills only what is empty, so it is safe to re-run.
 */
export async function seedDrive(db: Db, tenantId: string): Promise<{ checklists: number; expiries: number }> {
  let checklists = 0;
  const [{ n }] = (await db
    .select({ n: sql<number>`count(*)::int` })
    .from(requirementSets)
    .where(and(eq(requirementSets.tenantId, tenantId), sql`${requirementSets.country} is not null`))) as [{ n: number }];
  if (n === 0) {
    const sets = [
      {
        name: 'UK Student visa',
        country: 'United Kingdom',
        items: ['passport', 'transcript', 'degree_certificate', 'language_test', 'bank_statement', 'sop', 'recommendation_letter', 'cv'],
        optional: ['experience_letter'],
      },
      {
        name: 'Canada Study permit',
        country: 'Canada',
        items: ['passport', 'photograph', 'transcript', 'degree_certificate', 'language_test', 'bank_statement', 'sponsor_affidavit', 'sop', 'medical_report'],
        optional: ['police_clearance'],
      },
      {
        name: 'Australia Subclass 500',
        country: 'Australia',
        items: ['passport', 'transcript', 'language_test', 'bank_statement', 'sop', 'medical_report'],
        optional: ['experience_letter', 'cv'],
      },
      {
        name: 'USA F-1',
        country: 'United States',
        items: ['passport', 'transcript', 'language_test', 'bank_statement', 'sponsor_affidavit', 'sop', 'recommendation_letter', 'i20_cas', 'visa_form'],
        optional: ['cv'],
      },
      {
        name: 'Germany National visa',
        country: 'Germany',
        items: ['passport', 'photograph', 'transcript', 'degree_certificate', 'language_test', 'bank_statement', 'cv', 'sop'],
        optional: [],
      },
    ];
    await db.insert(requirementSets).values(
      sets.map((s) => ({
        tenantId,
        name: s.name,
        country: s.country,
        items: [
          ...s.items.map((typeKey) => ({ typeKey, required: true })),
          ...s.optional.map((typeKey) => ({ typeKey, required: false })),
        ],
      })),
    );
    checklists = sets.length;
  }

  const [canadaTemplate] = await db
    .select({ id: folderTemplates.id })
    .from(folderTemplates)
    .where(and(eq(folderTemplates.tenantId, tenantId), eq(folderTemplates.country, 'Canada')))
    .limit(1);
  if (!canadaTemplate) {
    await db.insert(folderTemplates).values({
      tenantId,
      name: 'Canada study permit',
      country: 'Canada',
      folders: [
        { key: 'passport', name: 'Passport and ID' },
        { key: 'academic', name: 'Academic' },
        { key: 'language', name: 'IELTS / PTE' },
        { key: 'financial', name: 'Proof of funds (GIC, bank)' },
        { key: 'application', name: 'SOP, LOR, CV' },
        { key: 'offers', name: 'LOA and PAL' },
        { key: 'visa', name: 'Study permit' },
        { key: 'other', name: 'Other' },
      ],
    });
  }

  const [agency] = await db
    .select({ id: docFolders.id })
    .from(docFolders)
    .where(and(eq(docFolders.tenantId, tenantId), isNull(docFolders.clientId)))
    .limit(1);
  if (!agency) {
    await db.insert(docFolders).values([
      { tenantId, name: 'Templates and forms', color: 'blue' },
      { tenantId, name: 'Marketing material', color: 'green', sharedWithPartners: true },
      { tenantId, name: 'University agreements', color: 'amber', restricted: true },
    ]);
  }

  // Passports and test results with dates that run out - some soon.
  const undated = await db
    .select({ id: documents.id, typeKey: documents.typeKey })
    .from(documents)
    .where(
      and(
        eq(documents.tenantId, tenantId),
        isNull(documents.expiresOn),
        isNull(documents.deletedAt),
        sql`${documents.typeKey} in ('passport', 'language_test', 'bank_statement')`,
      ),
    );
  let expiries = 0;
  for (const [i, d] of undated.entries()) {
    const days = d.typeKey === 'passport' ? [15, 70, 400, 1200][i % 4]! : d.typeKey === 'language_test' ? [25, 200, 500][i % 3]! : [-5, 40, 80][i % 3]!;
    await db
      .update(documents)
      .set({ expiresOn: new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10) })
      .where(eq(documents.id, d.id));
    expiries++;
  }
  return { checklists, expiries };
}

import {
  DOCUMENT_META,
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_FOLDER,
  EXPIRING_TYPES,
  EXTRA_SYSTEM_TYPES,
  STAGE_DEFINITIONS,
  SYSTEM_FOLDERS,
} from '@crm/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/connection';
import { documentTypes, folderTemplates, requirementSets, staffRoles } from '../db/schema';
import { defaultRoleRows } from '../team/default-roles';
import { seedStandardWorkflow } from '../workflows/stage-rows';
import { seedLedger } from '../finance/journal';

type Tx = Pick<Db, 'insert' | 'select' | 'update'>;

/**
 * Everything a consultancy starts with: the built-in roles, document types,
 * a folder template and a general checklist - and, as the modules add them,
 * a standard workflow and a chart of accounts. Called inside the onboarding
 * transaction, by the seeds and by the test harness; each insert skips what
 * already exists, so calling it twice changes nothing.
 *
 * Migrations backfill the same rows for consultancies that already existed.
 */
export async function seedTenantDefaults(db: Tx, tenantId: string): Promise<void> {
  await db.insert(staffRoles).values(defaultRoleRows(tenantId)).onConflictDoNothing();

  await db
    .insert(documentTypes)
    .values([
      ...DOCUMENT_TYPES.map((key) => ({
        tenantId,
        key,
        label: DOCUMENT_META[key].label,
        hint: DOCUMENT_META[key].hint,
        folderKey: DOCUMENT_TYPE_FOLDER[key],
        hasExpiry: EXPIRING_TYPES.includes(key),
        system: true,
      })),
      ...EXTRA_SYSTEM_TYPES.map((t) => ({
        tenantId,
        key: t.key,
        label: t.label,
        hint: t.hint,
        folderKey: t.folder,
        hasExpiry: EXPIRING_TYPES.includes(t.key),
        system: true,
      })),
    ])
    .onConflictDoNothing();

  const [hasTemplate] = await db
    .select({ id: folderTemplates.id })
    .from(folderTemplates)
    .where(eq(folderTemplates.tenantId, tenantId))
    .limit(1);
  if (!hasTemplate) {
    await db.insert(folderTemplates).values({
      tenantId,
      name: 'Standard student folders',
      folders: SYSTEM_FOLDERS.map((f) => ({ key: f.key, name: f.name })),
      isDefault: true,
    });
  }

  const [hasChecklist] = await db
    .select({ id: requirementSets.id })
    .from(requirementSets)
    .where(eq(requirementSets.tenantId, tenantId))
    .limit(1);
  if (!hasChecklist) {
    await db.insert(requirementSets).values({
      tenantId,
      name: 'General checklist',
      items: STAGE_DEFINITIONS.documents_collection.requiredDocuments.map((k) => ({ typeKey: k, required: true })),
    });
  }

  await seedStandardWorkflow(db, tenantId);
  await seedLedger(db, tenantId);
}


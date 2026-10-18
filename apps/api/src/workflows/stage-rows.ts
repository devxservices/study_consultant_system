import { STANDARD_WORKFLOW_STAGES, type Stage, type WorkflowStage, type WorkflowStageView } from '@crm/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/connection';
import { workflowStages, workflowTemplates, workflowVersions } from '../db/schema';

export type StageRow = typeof workflowStages.$inferSelect;

/** A validated stage as the row that stores it. */
export function stageInsert(s: WorkflowStage, tenantId: string, versionId: string, position: number): typeof workflowStages.$inferInsert {
  return {
    tenantId,
    versionId,
    position,
    key: s.key,
    name: s.name,
    clientLabel: s.clientLabel,
    clientDescription: s.clientDescription,
    category: s.category,
    color: s.color,
    slaDays: s.slaDays,
    requiredDocuments: s.requiredDocuments,
    autoAdvance: s.autoAdvance,
    approvalRequired: s.approvalRequired,
    movableBy: s.movableBy,
    conditions: s.conditions,
    tasks: s.tasks,
    fees: s.fees,
    messages: s.messages,
    notifyStudent: s.notifyStudent,
  };
}

export function toStageView(r: StageRow): WorkflowStageView {
  return {
    id: r.id,
    position: r.position,
    key: r.key,
    name: r.name,
    clientLabel: r.clientLabel,
    clientDescription: r.clientDescription,
    category: r.category as Stage,
    color: r.color as WorkflowStageView['color'],
    slaDays: r.slaDays,
    requiredDocuments: r.requiredDocuments,
    autoAdvance: r.autoAdvance,
    approvalRequired: r.approvalRequired,
    movableBy: r.movableBy as WorkflowStageView['movableBy'],
    conditions: r.conditions,
    tasks: r.tasks,
    fees: r.fees,
    messages: r.messages,
    notifyStudent: r.notifyStudent,
  };
}

type Tx = Pick<Db, 'insert' | 'select' | 'update'>;

/**
 * The Standard workflow - today's ten stages - for a consultancy that has
 * none yet. Stages go into a draft that is then published, because a
 * published version's stages are frozen by a trigger. Returns its template id.
 */
export async function seedStandardWorkflow(db: Tx, tenantId: string): Promise<string> {
  const [existing] = await db
    .select({ id: workflowTemplates.id })
    .from(workflowTemplates)
    .where(and(eq(workflowTemplates.tenantId, tenantId), eq(workflowTemplates.isDefault, true)))
    .limit(1);
  if (existing) return existing.id;

  const [template] = await db
    .insert(workflowTemplates)
    .values({
      tenantId,
      name: 'Standard',
      description: 'The ten stages every application has used so far. Applications use it when no other workflow fits.',
      isDefault: true,
    })
    .returning({ id: workflowTemplates.id });
  const [version] = await db
    .insert(workflowVersions)
    .values({ tenantId, templateId: template!.id, version: 1, status: 'draft', notes: 'The ten standard stages.' })
    .returning({ id: workflowVersions.id });
  await db.insert(workflowStages).values(STANDARD_WORKFLOW_STAGES.map((s, i) => stageInsert(s, tenantId, version!.id, i)));
  await db
    .update(workflowVersions)
    .set({ status: 'published', publishedAt: new Date() })
    .where(eq(workflowVersions.id, version!.id));
  return template!.id;
}

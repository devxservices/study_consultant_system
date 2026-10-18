import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  normaliseCountry,
  saveWorkflowDraftSchema,
  stageApplies,
  type AuthUser,
  type BoardColumn,
  type BoardQuery,
  type BoardView,
  type CaseStageView,
  type CaseWorkflowView,
  type ConditionFacts,
  type CreateWorkflowInput,
  type PublishWorkflowInput,
  type SaveWorkflowDraftInput,
  type WorkflowDetailView,
  type WorkflowPerformanceView,
  type WorkflowStage,
  type WorkflowSummaryView,
  type WorkflowTemplateInput,
  type WorkflowVersionStatus,
  type Stage,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import {
  caseStageEvents,
  cases,
  clients,
  consultants,
  documentTypes,
  users,
  workflowStages,
  workflowTemplates,
  workflowVersions,
} from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { seesAll } from '../auth/permissions';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { NIL_UUID, iso, isUniqueViolation } from '../common/db-helpers';
import { qualified } from '../documents/drive-sql';
import { seedStandardWorkflow, stageInsert, toStageView, type StageRow } from './stage-rows';

const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase();

/** Published versions never change, so their stages are kept once read. */
const CACHE_LIMIT = 500;

/**
 * Workflows: the templates, their versions and stages, which one an
 * application runs on, and the views built on them - the board and the
 * per-stage performance.
 */
@Injectable()
export class WorkflowsService {
  private readonly stageCache = new Map<string, StageRow[]>();

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Lookups for the engine                                            */
  /* ---------------------------------------------------------------- */

  /** A version's stages in order. Cached for published versions - they are frozen. */
  async stagesOf(versionId: string): Promise<StageRow[]> {
    const hit = this.stageCache.get(versionId);
    if (hit) return hit;
    const [[version], rows] = await Promise.all([
      this.db.select({ status: workflowVersions.status }).from(workflowVersions).where(eq(workflowVersions.id, versionId)).limit(1),
      this.db.select().from(workflowStages).where(eq(workflowStages.versionId, versionId)).orderBy(asc(workflowStages.position)),
    ]);
    if (version && version.status !== 'draft') {
      if (this.stageCache.size >= CACHE_LIMIT) this.stageCache.delete(this.stageCache.keys().next().value!);
      this.stageCache.set(versionId, rows);
    }
    return rows;
  }

  /**
   * Which workflow a new application runs on: the one asked for, or the
   * consultancy's most specific match - every field a workflow names must
   * match, and naming more wins (country, then level, then visa type). The
   * Standard workflow is the fallback.
   */
  async versionForNewCase(
    tenantId: string,
    facts: { country: string | null; studyLevel: string | null; visaType: string | null },
    templateId?: string,
  ): Promise<{ versionId: string; templateId: string }> {
    const rows = await this.db
      .select({
        templateId: workflowTemplates.id,
        name: workflowTemplates.name,
        country: workflowTemplates.country,
        studyLevel: workflowTemplates.studyLevel,
        visaType: workflowTemplates.visaType,
        isDefault: workflowTemplates.isDefault,
        versionId: workflowVersions.id,
      })
      .from(workflowTemplates)
      .innerJoin(workflowVersions, and(eq(workflowVersions.templateId, workflowTemplates.id), eq(workflowVersions.status, 'published')))
      .where(and(eq(workflowTemplates.tenantId, tenantId), isNull(workflowTemplates.archivedAt)));

    if (templateId) {
      const chosen = rows.find((r) => r.templateId === templateId);
      if (!chosen) {
        throw new BadRequestException({
          message: 'That workflow cannot take new applications: it is archived or has never been published.',
          fieldErrors: { workflowId: 'Choose another workflow' },
        });
      }
      return { versionId: chosen.versionId, templateId: chosen.templateId };
    }

    let best: { row: (typeof rows)[number]; score: number } | null = null;
    for (const r of rows) {
      let score = 0;
      if (r.country) {
        if (normaliseCountry(r.country) !== normaliseCountry(facts.country)) continue;
        score += 4;
      }
      if (r.studyLevel) {
        if (norm(r.studyLevel) !== norm(facts.studyLevel)) continue;
        score += 2;
      }
      if (r.visaType) {
        if (norm(r.visaType) !== norm(facts.visaType)) continue;
        score += 1;
      }
      if (r.isDefault) score -= 1;
      if (!best || score > best.score || (score === best.score && r.name.localeCompare(best.row.name) < 0)) best = { row: r, score };
    }
    if (best) return { versionId: best.row.versionId, templateId: best.row.templateId };

    // A consultancy made before workflows existed and missed by the backfill.
    await seedStandardWorkflow(this.db, tenantId);
    return this.versionForNewCase(tenantId, facts);
  }

  /** The workflow view of one application: its stages, where it is, any sign-off. */
  async caseWorkflow(k: {
    workflowVersionId: string | null;
    currentStageKey: string | null;
    currentStage: string;
    stageApprovedAt: Date | string | null;
    stageApprovedBy: string | null;
    tenantId: string;
  }, facts: ConditionFacts): Promise<CaseWorkflowView | null> {
    if (!k.workflowVersionId) return null;
    const [[meta], stages, [approver]] = await Promise.all([
      this.db
        .select({
          templateId: workflowTemplates.id,
          templateName: workflowTemplates.name,
          version: workflowVersions.version,
          newerId: sql<string | null>`(select nv.id from workflow_versions nv where nv.template_id = ${workflowTemplates.id} and nv.status = 'published' and nv.id <> ${k.workflowVersionId}::uuid limit 1)`,
          newerVersion: sql<number | null>`(select nv.version from workflow_versions nv where nv.template_id = ${workflowTemplates.id} and nv.status = 'published' and nv.id <> ${k.workflowVersionId}::uuid limit 1)`,
        })
        .from(workflowVersions)
        .innerJoin(workflowTemplates, eq(workflowTemplates.id, workflowVersions.templateId))
        .where(eq(workflowVersions.id, k.workflowVersionId))
        .limit(1),
      this.stagesOf(k.workflowVersionId),
      k.stageApprovedBy
        ? this.db.select({ name: users.fullName }).from(users).where(eq(users.id, k.stageApprovedBy)).limit(1)
        : Promise.resolve([] as { name: string }[]),
    ]);
    if (!meta) return null;
    const currentKey = k.currentStageKey ?? stages.find((s) => s.category === k.currentStage)?.key ?? stages[0]?.key ?? '';
    const current = stages.find((s) => s.key === currentKey);
    return {
      templateId: meta.templateId,
      templateName: meta.templateName,
      versionId: k.workflowVersionId,
      version: meta.version,
      newerVersion: meta.newerId && meta.newerVersion !== null && meta.newerVersion > meta.version ? { id: meta.newerId, version: meta.newerVersion } : null,
      stages: stages.map((s) => toCaseStage(s, s.key === currentKey || stageApplies(s, facts))),
      currentStageKey: currentKey,
      approval: {
        required: current?.approvalRequired ?? false,
        approvedAt: k.stageApprovedAt ? iso(k.stageApprovedAt) : null,
        approvedByName: approver?.name ?? null,
      },
    };
  }

  /* ---------------------------------------------------------------- */
  /* Templates                                                         */
  /* ---------------------------------------------------------------- */

  async list(actor: AuthUser, includeArchived = false): Promise<WorkflowSummaryView[]> {
    const tenantId = tenantOf(actor);
    const templates = await this.db
      .select()
      .from(workflowTemplates)
      .where(and(eq(workflowTemplates.tenantId, tenantId), includeArchived ? undefined : isNull(workflowTemplates.archivedAt)))
      .orderBy(desc(workflowTemplates.isDefault), asc(workflowTemplates.name));
    if (templates.length === 0) return [];
    const ids = templates.map((t) => t.id);
    const [versions, counts] = await Promise.all([
      this.db
        .select({
          id: workflowVersions.id,
          templateId: workflowVersions.templateId,
          version: workflowVersions.version,
          status: workflowVersions.status,
          publishedAt: workflowVersions.publishedAt,
          updatedAt: workflowVersions.updatedAt,
          // Qualified by hand: a single-table select renders bare column names,
          // which inside the subquery would mean the stage's own id.
          stageCount: sql<number>`(select count(*)::int from workflow_stages ws where ws.version_id = ${qualified('workflow_versions', 'id')})`,
        })
        .from(workflowVersions)
        .where(and(inArray(workflowVersions.templateId, ids), inArray(workflowVersions.status, ['published', 'draft']))),
      this.caseCounts(tenantId, ids),
    ]);
    return templates.map((t) => summarise(t, versions.filter((v) => v.templateId === t.id), counts.get(t.id)));
  }

  async detail(actor: AuthUser, id: string): Promise<WorkflowDetailView> {
    const template = await this.findTemplate(actor, id);
    const [versions, counts] = await Promise.all([
      this.db
        .select({
          id: workflowVersions.id,
          version: workflowVersions.version,
          status: workflowVersions.status,
          notes: workflowVersions.notes,
          publishedAt: workflowVersions.publishedAt,
          updatedAt: workflowVersions.updatedAt,
          publishedByName: users.fullName,
          caseCount: sql<number>`(select count(*)::int from cases c where c.workflow_version_id = ${workflowVersions.id})`,
          activeCaseCount: sql<number>`(select count(*)::int from cases c where c.workflow_version_id = ${workflowVersions.id} and c.status = 'active' and c.current_stage <> 'closed')`,
          stageCount: sql<number>`(select count(*)::int from workflow_stages ws where ws.version_id = ${workflowVersions.id})`,
        })
        .from(workflowVersions)
        .leftJoin(users, eq(users.id, workflowVersions.publishedBy))
        .where(eq(workflowVersions.templateId, id))
        .orderBy(desc(workflowVersions.version)),
      this.caseCounts(template.tenantId, [id]),
    ]);
    const current = versions.find((v) => v.status === 'published');
    const draft = versions.find((v) => v.status === 'draft');
    const [currentStages, draftStages] = await Promise.all([
      current ? this.stagesOf(current.id) : Promise.resolve(null),
      draft ? this.stagesOf(draft.id) : Promise.resolve(null),
    ]);
    return {
      ...summarise(template, versions.filter((v) => v.status !== 'retired'), counts.get(id)),
      versions: versions.map((v) => ({
        id: v.id,
        version: v.version,
        status: v.status as WorkflowVersionStatus,
        notes: v.notes,
        publishedAt: v.publishedAt ? iso(v.publishedAt) : null,
        publishedByName: v.publishedByName,
        caseCount: v.caseCount,
        activeCaseCount: v.activeCaseCount,
      })),
      currentStages: currentStages?.map(toStageView) ?? null,
      draftStages: draftStages?.map(toStageView) ?? null,
      draftNotes: draft?.notes ?? null,
    };
  }

  /** One version's stages, for looking back at what an older version was. */
  async versionStages(actor: AuthUser, versionId: string) {
    const [v] = await this.db
      .select({ id: workflowVersions.id, templateId: workflowVersions.templateId, version: workflowVersions.version, status: workflowVersions.status })
      .from(workflowVersions)
      .where(and(eq(workflowVersions.id, versionId), eq(workflowVersions.tenantId, tenantOf(actor))))
      .limit(1);
    if (!v) throw new NotFoundException('Version not found.');
    return { ...v, stages: (await this.stagesOf(v.id)).map(toStageView) };
  }

  async create(actor: AuthUser, input: CreateWorkflowInput): Promise<WorkflowDetailView> {
    const tenantId = tenantOf(actor);
    const source = input.copyFromId
      ? await this.currentOrDraftStages(actor, input.copyFromId)
      : await this.defaultStages(tenantId);
    const id = await this.db.transaction(async (tx) => {
      let template;
      try {
        [template] = await tx
          .insert(workflowTemplates)
          .values({
            tenantId,
            name: input.name,
            description: input.description ?? null,
            country: input.country ?? null,
            studyLevel: input.studyLevel ?? null,
            visaType: input.visaType ?? null,
            createdBy: actor.id,
          })
          .returning({ id: workflowTemplates.id });
      } catch (err) {
        if (isUniqueViolation(err)) throw nameTaken();
        throw err;
      }
      const [version] = await tx
        .insert(workflowVersions)
        .values({ tenantId, templateId: template!.id, version: 1, status: 'draft', createdBy: actor.id })
        .returning({ id: workflowVersions.id });
      await tx.insert(workflowStages).values(source.map((s, i) => stageInsert(s, tenantId, version!.id, i)));
      return template!.id;
    });
    await this.audit.record(actor, {
      action: input.copyFromId ? 'workflow.cloned' : 'workflow.saved',
      entityType: 'workflow',
      entityId: id,
      metadata: { name: input.name, country: input.country ?? null, copiedFrom: input.copyFromId ?? null },
    });
    return this.detail(actor, id);
  }

  async update(actor: AuthUser, id: string, input: WorkflowTemplateInput): Promise<WorkflowDetailView> {
    const template = await this.findTemplate(actor, id);
    if (template.isDefault && (input.country || input.studyLevel || input.visaType)) {
      throw new BadRequestException('The Standard workflow is the fallback for every application, so it cannot be aimed at one country, level or visa type. Make a new workflow for that.');
    }
    try {
      await this.db
        .update(workflowTemplates)
        .set({
          name: input.name,
          description: input.description ?? null,
          country: input.country ?? null,
          studyLevel: input.studyLevel ?? null,
          visaType: input.visaType ?? null,
          updatedAt: new Date(),
        })
        .where(eq(workflowTemplates.id, id));
    } catch (err) {
      if (isUniqueViolation(err)) throw nameTaken();
      throw err;
    }
    await this.audit.record(actor, { action: 'workflow.saved', entityType: 'workflow', entityId: id, metadata: { name: input.name, details: true } });
    return this.detail(actor, id);
  }

  async setArchived(actor: AuthUser, id: string, archived: boolean): Promise<WorkflowDetailView> {
    const template = await this.findTemplate(actor, id);
    if (template.isDefault && archived) {
      throw new BadRequestException('The Standard workflow is the fallback for every application and cannot be archived.');
    }
    await this.db
      .update(workflowTemplates)
      .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
      .where(eq(workflowTemplates.id, id));
    await this.audit.record(actor, {
      action: archived ? 'workflow.archived' : 'workflow.saved',
      entityType: 'workflow',
      entityId: id,
      metadata: { name: template.name, archived },
    });
    return this.detail(actor, id);
  }

  /* ---------------------------------------------------------------- */
  /* Drafts and publishing                                             */
  /* ---------------------------------------------------------------- */

  async saveDraft(actor: AuthUser, id: string, input: SaveWorkflowDraftInput): Promise<WorkflowDetailView> {
    const template = await this.findTemplate(actor, id);
    const parsed = saveWorkflowDraftSchema.parse(input);
    await this.assertDocumentTypes(template.tenantId, parsed.stages);

    await this.db.transaction(async (tx) => {
      let [draft] = await tx
        .select({ id: workflowVersions.id })
        .from(workflowVersions)
        .where(and(eq(workflowVersions.templateId, id), eq(workflowVersions.status, 'draft')))
        .limit(1);
      if (!draft) {
        const [{ max }] = (await tx
          .select({ max: sql<number>`coalesce(max(${workflowVersions.version}), 0)::int` })
          .from(workflowVersions)
          .where(eq(workflowVersions.templateId, id))) as [{ max: number }];
        [draft] = await tx
          .insert(workflowVersions)
          .values({ tenantId: template.tenantId, templateId: id, version: max + 1, status: 'draft', createdBy: actor.id })
          .returning({ id: workflowVersions.id });
      }
      await tx.delete(workflowStages).where(eq(workflowStages.versionId, draft!.id));
      await tx.insert(workflowStages).values(parsed.stages.map((s, i) => stageInsert(s, template.tenantId, draft!.id, i)));
      await tx
        .update(workflowVersions)
        .set({ notes: parsed.notes ?? null, updatedAt: new Date() })
        .where(eq(workflowVersions.id, draft!.id));
      await tx.update(workflowTemplates).set({ updatedAt: new Date() }).where(eq(workflowTemplates.id, id));
    });
    await this.audit.record(actor, {
      action: 'workflow.saved',
      entityType: 'workflow',
      entityId: id,
      metadata: { name: template.name, draft: true, stages: parsed.stages.length },
    });
    return this.detail(actor, id);
  }

  async discardDraft(actor: AuthUser, id: string): Promise<WorkflowDetailView> {
    const template = await this.findTemplate(actor, id);
    const [published] = await this.db
      .select({ id: workflowVersions.id })
      .from(workflowVersions)
      .where(and(eq(workflowVersions.templateId, id), ne(workflowVersions.status, 'draft')))
      .limit(1);
    if (!published) {
      throw new BadRequestException('This workflow has never been published, so its draft is all there is. Archive the workflow instead.');
    }
    await this.db.delete(workflowVersions).where(and(eq(workflowVersions.templateId, id), eq(workflowVersions.status, 'draft')));
    await this.audit.record(actor, { action: 'workflow.saved', entityType: 'workflow', entityId: id, metadata: { name: template.name, draftDiscarded: true } });
    return this.detail(actor, id);
  }

  /**
   * The draft becomes the next version. Applications already running keep
   * the version they are on unless asked to move: a published version is a
   * promise about what an application will go through.
   */
  async publish(
    actor: AuthUser,
    id: string,
    input: PublishWorkflowInput,
    upgrade: (fromVersionIds: string[], toVersionId: string) => Promise<number>,
  ): Promise<WorkflowDetailView & { upgraded: number }> {
    const template = await this.findTemplate(actor, id);
    const [draft] = await this.db
      .select()
      .from(workflowVersions)
      .where(and(eq(workflowVersions.templateId, id), eq(workflowVersions.status, 'draft')))
      .limit(1);
    if (!draft) throw new BadRequestException('There are no unpublished changes.');
    const stages = await this.stagesOf(draft.id);
    // Saved drafts were valid when saved; the document types may have changed since.
    const check = saveWorkflowDraftSchema.safeParse({ stages: stages.map(toStageView) });
    if (!check.success) throw new BadRequestException(check.error.issues[0]?.message ?? 'The draft is not valid.');
    await this.assertDocumentTypes(template.tenantId, check.data.stages);

    const previous = await this.db
      .select({ id: workflowVersions.id })
      .from(workflowVersions)
      .where(and(eq(workflowVersions.templateId, id), ne(workflowVersions.status, 'draft')));
    await this.db.transaction(async (tx) => {
      await tx
        .update(workflowVersions)
        .set({ status: 'retired', updatedAt: new Date() })
        .where(and(eq(workflowVersions.templateId, id), eq(workflowVersions.status, 'published')));
      await tx
        .update(workflowVersions)
        .set({ status: 'published', publishedAt: new Date(), publishedBy: actor.id, notes: input.notes ?? draft.notes, updatedAt: new Date() })
        .where(eq(workflowVersions.id, draft.id));
      await tx.update(workflowTemplates).set({ updatedAt: new Date() }).where(eq(workflowTemplates.id, id));
    });
    // Its stages are frozen from now on; read them fresh into the cache.
    this.stageCache.delete(draft.id);

    const upgraded = input.upgradeActive && previous.length ? await upgrade(previous.map((p) => p.id), draft.id) : 0;
    await this.audit.record(actor, {
      action: 'workflow.published',
      entityType: 'workflow',
      entityId: id,
      metadata: { name: template.name, version: draft.version, stages: stages.length, upgraded },
    });
    return { ...(await this.detail(actor, id)), upgraded };
  }

  /* ---------------------------------------------------------------- */
  /* Board and performance                                             */
  /* ---------------------------------------------------------------- */

  /** Applications a person may see, in SQL - the same rule as opening one. */
  caseScope(actor: AuthUser): SQL | undefined {
    const tenant = eq(cases.tenantId, tenantOf(actor));
    if (actor.role === 'manager' || seesAll(actor)) return tenant;
    if (actor.role === 'consultant') {
      const me = actor.consultantId ?? NIL_UUID;
      return and(tenant, or(eq(cases.consultantId, me), eq(clients.assignedConsultantId, me)));
    }
    return sql`false`;
  }

  async board(actor: AuthUser, query: BoardQuery): Promise<BoardView> {
    const tenantId = tenantOf(actor);
    const workflows = await this.db
      .select({
        id: workflowTemplates.id,
        name: workflowTemplates.name,
        country: workflowTemplates.country,
        isDefault: workflowTemplates.isDefault,
        versionId: workflowVersions.id,
        version: workflowVersions.version,
      })
      .from(workflowTemplates)
      .innerJoin(workflowVersions, and(eq(workflowVersions.templateId, workflowTemplates.id), eq(workflowVersions.status, 'published')))
      .where(and(eq(workflowTemplates.tenantId, tenantId), isNull(workflowTemplates.archivedAt)))
      .orderBy(desc(workflowTemplates.isDefault), asc(workflowTemplates.name));

    const activeByTemplate = await this.db
      .select({ templateId: workflowVersions.templateId, n: sql<number>`count(*)::int` })
      .from(cases)
      .innerJoin(clients, eq(clients.id, cases.clientId))
      .innerJoin(workflowVersions, eq(workflowVersions.id, cases.workflowVersionId))
      .where(and(this.caseScope(actor), eq(cases.status, 'active')))
      .groupBy(workflowVersions.templateId);
    const active = new Map(activeByTemplate.map((r) => [r.templateId, r.n]));

    let chosen = query.templateId ? workflows.find((w) => w.id === query.templateId) : undefined;
    if (query.templateId && !chosen) throw new NotFoundException('Workflow not found.');
    if (!chosen && query.country) {
      chosen =
        workflows.find((w) => w.country && normaliseCountry(w.country) === normaliseCountry(query.country)) ??
        workflows.find((w) => w.isDefault);
    }
    chosen ??= workflows.find((w) => w.isDefault) ?? workflows[0];
    if (!chosen) throw new NotFoundException('No workflow to show.');

    const stages = await this.stagesOf(chosen.versionId);
    const versionIds = this.db
      .select({ id: workflowVersions.id })
      .from(workflowVersions)
      .where(eq(workflowVersions.templateId, chosen.id));
    const overdueSql = sql<boolean>`${cases.stageEnteredAt} < now() - (coalesce(${cases.stageSlaDays}, 14) * interval '1 day')`;
    const where = and(
      this.caseScope(actor),
      eq(cases.status, 'active'),
      inArray(cases.workflowVersionId, versionIds),
      query.country ? ilike(cases.targetCountry, query.country) : undefined,
      query.consultantId ? eq(cases.consultantId, query.consultantId) : undefined,
      query.q ? or(ilike(clients.fullName, `%${query.q}%`), ilike(cases.reference, `%${query.q}%`)) : undefined,
    );

    const ranked = this.db
      .select({
        id: sql<string>`${cases.id}`.as('ranked_id'),
        rn: sql<number>`row_number() over (partition by ${cases.currentStageKey} order by ${cases.stageEnteredAt} asc)`.as('rn'),
      })
      .from(cases)
      .innerJoin(clients, eq(clients.id, cases.clientId))
      .where(where)
      .as('ranked');

    const [totals, cards] = await Promise.all([
      this.db
        .select({
          key: cases.currentStageKey,
          versionId: cases.workflowVersionId,
          total: sql<number>`count(*)::int`,
          overdue: sql<number>`count(*) filter (where ${overdueSql})::int`,
        })
        .from(cases)
        .innerJoin(clients, eq(clients.id, cases.clientId))
        .where(where)
        .groupBy(cases.currentStageKey, cases.workflowVersionId),
      this.db
        .select({
          id: cases.id,
          reference: cases.reference,
          clientId: cases.clientId,
          clientName: clients.fullName,
          consultantName: users.fullName,
          targetCountry: cases.targetCountry,
          targetUniversity: cases.targetUniversity,
          intake: cases.intake,
          stageKey: cases.currentStageKey,
          stageEnteredAt: cases.stageEnteredAt,
          slaDays: cases.stageSlaDays,
          approvedAt: cases.stageApprovedAt,
          versionId: cases.workflowVersionId,
        })
        .from(cases)
        .innerJoin(ranked, eq(ranked.id, cases.id))
        .innerJoin(clients, eq(clients.id, cases.clientId))
        .leftJoin(consultants, eq(consultants.id, cases.consultantId))
        .leftJoin(users, eq(users.id, consultants.userId))
        .where(lte(ranked.rn, query.perColumn))
        .orderBy(asc(cases.stageEnteredAt)),
    ]);

    // An application on an older version sits in the column with the same
    // key, or failing that the first one of its category.
    const byKey = new Map(stages.map((s) => [s.key, s]));
    const columns: BoardColumn[] = stages.map((s) => ({
      key: s.key,
      name: s.name,
      category: s.category as Stage,
      color: s.color as BoardColumn['color'],
      slaDays: s.slaDays,
      approvalRequired: s.approvalRequired,
      movableBy: s.movableBy as BoardColumn['movableBy'],
      total: 0,
      overdue: 0,
      cards: [],
    }));
    const columnFor = async (key: string | null, versionId: string | null) => {
      if (key && byKey.has(key)) return columns.find((c) => c.key === key)!;
      if (!versionId) return columns[0]!;
      const theirs = (await this.stagesOf(versionId)).find((s) => s.key === key);
      return columns.find((c) => c.category === theirs?.category) ?? columns[0]!;
    };
    for (const t of totals) {
      const column = await columnFor(t.key, t.versionId);
      column.total += t.total;
      column.overdue += t.overdue;
    }
    for (const c of cards) {
      const column = await columnFor(c.stageKey, c.versionId);
      const days = Math.max(0, Math.floor((Date.now() - new Date(c.stageEnteredAt).getTime()) / 86_400_000));
      const sla = c.slaDays ?? column.slaDays;
      const stage = byKey.get(c.stageKey ?? '');
      column.cards.push({
        id: c.id,
        reference: c.reference,
        clientId: c.clientId,
        clientName: c.clientName,
        consultantName: c.consultantName,
        targetCountry: c.targetCountry,
        targetUniversity: c.targetUniversity,
        intake: c.intake,
        stageKey: c.stageKey ?? column.key,
        daysInStage: days,
        slaDays: sla,
        overdue: days > sla,
        awaitingApproval: Boolean(stage?.approvalRequired && !c.approvedAt),
        versionBehind: c.versionId !== chosen.versionId,
      });
    }

    return {
      workflow: { id: chosen.id, name: chosen.name, versionId: chosen.versionId, version: chosen.version, country: chosen.country },
      columns,
      workflows: workflows.map((w) => ({ id: w.id, name: w.name, country: w.country, activeCases: active.get(w.id) ?? 0 })),
    };
  }

  async performance(actor: AuthUser, id: string): Promise<WorkflowPerformanceView> {
    const template = await this.findTemplate(actor, id);
    const [current] = await this.db
      .select({ id: workflowVersions.id })
      .from(workflowVersions)
      .where(and(eq(workflowVersions.templateId, id), inArray(workflowVersions.status, ['published'])))
      .limit(1);
    const [fallback] = current
      ? [current]
      : await this.db
          .select({ id: workflowVersions.id })
          .from(workflowVersions)
          .where(eq(workflowVersions.templateId, id))
          .orderBy(desc(workflowVersions.version))
          .limit(1);
    const stages = fallback ? await this.stagesOf(fallback.id) : [];
    const versionIds = this.db.select({ id: workflowVersions.id }).from(workflowVersions).where(eq(workflowVersions.templateId, template.id));
    const scoped = and(this.caseScope(actor), inArray(cases.workflowVersionId, versionIds));
    const days = sql`extract(epoch from (${caseStageEvents.completedAt} - ${caseStageEvents.enteredAt})) / 86400.0`;

    const [live, visits, totals] = await Promise.all([
      this.db
        .select({
          key: cases.currentStageKey,
          active: sql<number>`count(*)::int`,
          overdue: sql<number>`count(*) filter (where ${cases.stageEnteredAt} < now() - (coalesce(${cases.stageSlaDays}, 14) * interval '1 day'))::int`,
        })
        .from(cases)
        .innerJoin(clients, eq(clients.id, cases.clientId))
        .where(and(scoped, eq(cases.status, 'active')))
        .groupBy(cases.currentStageKey),
      this.db
        .select({
          key: caseStageEvents.stageKey,
          reached: sql<number>`count(distinct ${caseStageEvents.caseId})::int`,
          completed: sql<number>`count(${caseStageEvents.completedAt})::int`,
          median: sql<number | null>`percentile_cont(0.5) within group (order by ${days}) filter (where ${caseStageEvents.completedAt} is not null)`,
          average: sql<number | null>`avg(${days}) filter (where ${caseStageEvents.completedAt} is not null)`,
          breaches: sql<number>`count(*) filter (where ${caseStageEvents.completedAt} is not null and ${caseStageEvents.completedAt} - ${caseStageEvents.enteredAt} > (${workflowStages.slaDays} * interval '1 day'))::int`,
        })
        .from(caseStageEvents)
        .innerJoin(cases, eq(cases.id, caseStageEvents.caseId))
        .innerJoin(clients, eq(clients.id, cases.clientId))
        .leftJoin(
          workflowStages,
          and(eq(workflowStages.versionId, caseStageEvents.workflowVersionId), eq(workflowStages.key, caseStageEvents.stageKey)),
        )
        .where(and(scoped, isNotNull(caseStageEvents.stageKey)))
        .groupBy(caseStageEvents.stageKey),
      this.db
        .select({
          started: sql<number>`count(*)::int`,
          closed: sql<number>`count(*) filter (where ${cases.currentStage} = 'closed' or ${cases.status} in ('approved', 'rejected', 'withdrawn'))::int`,
        })
        .from(cases)
        .innerJoin(clients, eq(clients.id, cases.clientId))
        .where(scoped),
    ]);
    const liveBy = new Map(live.map((r) => [r.key, r]));
    const visitsBy = new Map(visits.map((r) => [r.key, r]));
    const round = (n: number | null | undefined) => (n === null || n === undefined ? null : Math.round(Number(n) * 10) / 10);
    const out = stages.map((s) => {
      const l = liveBy.get(s.key);
      const v = visitsBy.get(s.key);
      return {
        key: s.key,
        name: s.name,
        category: s.category as Stage,
        slaDays: s.slaDays,
        active: l?.active ?? 0,
        overdue: l?.overdue ?? 0,
        reached: v?.reached ?? 0,
        medianDays: round(v?.median),
        averageDays: round(v?.average),
        breachRate: v && v.completed > 0 ? Math.round((v.breaches / v.completed) * 100) / 100 : null,
      };
    });
    return {
      workflowId: id,
      stages: out,
      totals: {
        active: out.reduce((a, s) => a + s.active, 0),
        overdue: out.reduce((a, s) => a + s.overdue, 0),
        started: totals[0]?.started ?? 0,
        closed: totals[0]?.closed ?? 0,
      },
    };
  }

  /* ---------------------------------------------------------------- */
  /* Helpers                                                           */
  /* ---------------------------------------------------------------- */

  async findTemplate(actor: AuthUser, id: string) {
    const [t] = await this.db
      .select()
      .from(workflowTemplates)
      .where(and(eq(workflowTemplates.id, id), eq(workflowTemplates.tenantId, tenantOf(actor))))
      .limit(1);
    if (!t) throw new NotFoundException('Workflow not found.');
    return t;
  }

  private async caseCounts(tenantId: string, templateIds: string[]) {
    const rows = await this.db
      .select({
        templateId: workflowVersions.templateId,
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${cases.status} = 'active' and ${cases.currentStage} <> 'closed')::int`,
      })
      .from(cases)
      .innerJoin(workflowVersions, eq(workflowVersions.id, cases.workflowVersionId))
      .where(and(eq(cases.tenantId, tenantId), inArray(workflowVersions.templateId, templateIds)))
      .groupBy(workflowVersions.templateId);
    return new Map(rows.map((r) => [r.templateId, r]));
  }

  private async currentOrDraftStages(actor: AuthUser, templateId: string): Promise<WorkflowStage[]> {
    await this.findTemplate(actor, templateId);
    const [v] = await this.db
      .select({ id: workflowVersions.id })
      .from(workflowVersions)
      .where(and(eq(workflowVersions.templateId, templateId), inArray(workflowVersions.status, ['published', 'draft'])))
      .orderBy(sql`case when ${workflowVersions.status} = 'published' then 0 else 1 end`)
      .limit(1);
    if (!v) throw new BadRequestException('That workflow has nothing to copy.');
    return (await this.stagesOf(v.id)).map(toStageView);
  }

  private async defaultStages(tenantId: string): Promise<WorkflowStage[]> {
    const [v] = await this.db
      .select({ id: workflowVersions.id })
      .from(workflowVersions)
      .innerJoin(workflowTemplates, eq(workflowTemplates.id, workflowVersions.templateId))
      .where(and(eq(workflowTemplates.tenantId, tenantId), eq(workflowTemplates.isDefault, true), eq(workflowVersions.status, 'published')))
      .limit(1);
    if (!v) {
      await seedStandardWorkflow(this.db, tenantId);
      return this.defaultStages(tenantId);
    }
    return (await this.stagesOf(v.id)).map(toStageView);
  }

  /** Every required document must be a type this consultancy has. */
  private async assertDocumentTypes(tenantId: string, stages: WorkflowStage[]): Promise<void> {
    const wanted = [...new Set(stages.flatMap((s) => s.requiredDocuments))];
    if (wanted.length === 0) return;
    const known = await this.db
      .select({ key: documentTypes.key })
      .from(documentTypes)
      .where(and(eq(documentTypes.tenantId, tenantId), inArray(documentTypes.key, wanted)));
    const have = new Set(known.map((k) => k.key));
    const missing = wanted.filter((k) => !have.has(k));
    if (missing.length) {
      throw new BadRequestException(`Unknown document type${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Add ${missing.length > 1 ? 'them' : 'it'} under Document settings first.`);
    }
  }
}

function nameTaken() {
  return new BadRequestException({
    message: 'There is already a workflow with that name.',
    fieldErrors: { name: 'Choose another name' },
  });
}

function toCaseStage(s: StageRow, applies: boolean): CaseStageView {
  return {
    key: s.key,
    name: s.name,
    clientLabel: s.clientLabel,
    clientDescription: s.clientDescription,
    category: s.category as Stage,
    color: s.color as CaseStageView['color'],
    slaDays: s.slaDays,
    requiredDocuments: s.requiredDocuments,
    approvalRequired: s.approvalRequired,
    movableBy: s.movableBy as CaseStageView['movableBy'],
    autoAdvance: s.autoAdvance,
    applies,
  };
}

function summarise(
  t: typeof workflowTemplates.$inferSelect,
  versions: { id: string; version: number; status: string; publishedAt: Date | null; updatedAt: Date; stageCount: number }[],
  counts: { total: number; active: number } | undefined,
): WorkflowSummaryView {
  const current = versions.find((v) => v.status === 'published');
  const draft = versions.find((v) => v.status === 'draft');
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    country: t.country,
    studyLevel: t.studyLevel,
    visaType: t.visaType,
    isDefault: t.isDefault,
    archived: Boolean(t.archivedAt),
    current: current
      ? { versionId: current.id, version: current.version, publishedAt: iso(current.publishedAt ?? current.updatedAt), stageCount: current.stageCount }
      : null,
    draft: draft ? { versionId: draft.id, updatedAt: iso(draft.updatedAt) } : null,
    activeCases: counts?.active ?? 0,
    totalCases: counts?.total ?? 0,
    updatedAt: iso(t.updatedAt),
  };
}

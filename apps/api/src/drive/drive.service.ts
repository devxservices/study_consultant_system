import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { alias } from 'drizzle-orm/pg-core';
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  DOCUMENT_TYPES,
  hasPermission,
  typeLabel,
  type AuthUser,
  type BulkInput,
  type CopyDocumentInput,
  type DocumentStatus,
  type DocumentTypeInput,
  type DocumentTypeView,
  type DriveCrumb,
  type DriveDocumentView,
  type DriveListQuery,
  type DriveListing,
  type DriveStudentView,
  type FolderTemplateInput,
  type FolderTemplateView,
  type GrantInput,
  type GrantView,
  type Paginated,
  type RequirementSetInput,
  type RequirementSetView,
  type StarInput,
  type StudentsQuery,
  type UpdateDocumentInput,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import {
  cases,
  clients,
  consultants,
  docFolders,
  documentTypes,
  documents,
  driveStars,
  folderTemplates,
  requirementSets,
  resourceGrants,
  users,
} from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { DocumentsService, canTrash, type DocRow } from '../documents/documents.service';
import { FoldersService } from '../documents/folders.service';
import { documentScope, studentScope } from '../documents/drive-sql';
import { STORAGE, type StorageDriver } from '../storage/storage.driver';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { NIL_UUID, iso, isoOrNull, isUniqueViolation, page, today } from '../common/db-helpers';
import { ChecklistService } from './checklist.service';

const reviewer = alias(users, 'reviewer');

/**
 * The drive: browsing, searching and organising documents the way people
 * expect from Google Drive - a folder per student, the agency's own area,
 * and cross-cutting views over everything they may see.
 */
@Injectable()
export class DriveService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: StorageDriver,
    private readonly audit: AuditService,
    private readonly documents: DocumentsService,
    private readonly folders: FoldersService,
    private readonly checklists: ChecklistService,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Browsing                                                          */
  /* ---------------------------------------------------------------- */

  async list(actor: AuthUser, query: DriveListQuery): Promise<DriveListing> {
    const tenantId = tenantOf(actor);
    const breadcrumb: DriveCrumb[] = [{ id: null, name: actor.role === 'client' ? 'My documents' : 'Drive', kind: 'root' }];
    const conditions: (SQL | undefined)[] = [];
    let folder = null as Awaited<ReturnType<FoldersService['find']>> | null;
    let folders: DriveListing['folders'] = [];
    const filtered = Boolean(
      query.q || query.type || query.status || query.country || query.caseId || query.uploaderId || query.uploaderRole || query.tag || query.from || query.to,
    );

    if (query.folderId) {
      folder = await this.folders.find(actor, query.folderId);
      const above = await this.folders.ancestors(folder);
      if (folder.clientId) {
        breadcrumb.push(...(await this.studentCrumbs(actor, folder.clientId)));
      } else {
        breadcrumb.push({ id: null, name: 'Agency', kind: 'agency' });
      }
      for (const a of above) breadcrumb.push({ id: a.id, name: a.name, kind: 'folder', clientId: a.clientId });
      breadcrumb.push({ id: folder.id, name: folder.name, kind: 'folder', clientId: folder.clientId });
      folders = filtered ? [] : await this.folders.children(actor, { parentId: folder.id });
      conditions.push(
        filtered
          ? sql`(${documents.folderId} = ${folder.id}::uuid or exists (select 1 from doc_folders sf
              where sf.id = ${documents.folderId} and sf.ancestry like ${`${folder.ancestry}${folder.id}/%`}))`
          : eq(documents.folderId, folder.id),
      );
    } else if (query.clientId || actor.role === 'client') {
      const clientId = actor.role === 'client' ? actor.clientId ?? NIL_UUID : query.clientId!;
      if (actor.role !== 'client') breadcrumb.push(...(await this.studentCrumbs(actor, clientId)));
      await this.folders.ensureStudentStructure(tenantId, clientId);
      folders = filtered || query.view ? [] : await this.folders.children(actor, { parentId: null, clientId });
      conditions.push(eq(documents.clientId, clientId));
      // At the top of a student's drive, documents live in their folders.
      if (!filtered && !query.view) conditions.push(isNull(documents.folderId));
    } else if (query.area === 'agency') {
      breadcrumb.push({ id: null, name: 'Agency', kind: 'agency' });
      folders = filtered ? [] : await this.folders.children(actor, { parentId: null, agency: true });
      conditions.push(isNull(documents.clientId));
      if (!filtered) conditions.push(isNull(documents.folderId));
    }

    const view = query.view ?? (query.folderId || query.clientId || query.area || actor.role === 'client' ? undefined : 'all');
    switch (view) {
      case 'starred':
        breadcrumb.push({ id: null, name: 'Starred', kind: 'root' });
        folders = await this.folders.starredFolders(actor);
        conditions.push(sql`exists (select 1 from drive_stars s where s.user_id = ${actor.id}::uuid and s.item_type = 'document' and s.item_id = ${documents.id})`);
        break;
      case 'recent':
        breadcrumb.push({ id: null, name: 'Recent', kind: 'root' });
        conditions.push(sql`${documents.uploadedAt} >= now() - interval '30 days'`);
        break;
      case 'trash':
        breadcrumb.push({ id: null, name: 'Trash', kind: 'root' });
        folders = await this.folders.trashedFolders(actor);
        break;
      case 'expiring':
        breadcrumb.push({ id: null, name: 'Expiring', kind: 'root' });
        conditions.push(
          isNotNull(documents.expiresOn),
          sql`${documents.expiresOn} <= current_date + ${query.expiringWithin ?? 90}::int`,
        );
        break;
      case 'review':
        breadcrumb.push({ id: null, name: 'To review', kind: 'root' });
        conditions.push(inArray(documents.status, ['pending', 'under_review']));
        break;
      case 'shared':
        breadcrumb.push({ id: null, name: 'Shared', kind: 'root' });
        conditions.push(sql`exists (select 1 from share_links l where l.document_id = ${documents.id}
          and l.revoked_at is null and l.expires_at > now())`);
        break;
      case 'all':
        breadcrumb.push({ id: null, name: 'All documents', kind: 'root' });
        break;
    }

    conditions.push(isNull(documents.deletedAt), documentScope(actor));
    if (view === 'trash') {
      // The trashed document as it was: its newest version.
      conditions.push(isNotNull(documents.trashedAt), isNull(documents.supersededBy));
    } else {
      conditions.push(isNull(documents.trashedAt), isNull(documents.supersededBy));
    }
    this.applyFilters(conditions, query);

    const where = and(...conditions);
    const [[count], rows] = await Promise.all([
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(documents)
        .leftJoin(clients, eq(clients.id, documents.clientId))
        .leftJoin(cases, eq(cases.id, documents.caseId))
        .innerJoin(users, eq(users.id, documents.uploadedBy))
        .where(where),
      this.selectDocuments(actor)
        .where(where)
        .orderBy(...this.order(query.sort ?? (view === 'expiring' ? 'expiry' : 'newest')))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
    ]);

    const total = count?.n ?? 0;
    return {
      folder: folder ? await this.folders.view(actor, folder.id) : null,
      breadcrumb,
      folders,
      documents: rows.map((r) => this.toView(actor, r)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async document(actor: AuthUser, id: string): Promise<DriveDocumentView> {
    const [row] = await this.selectDocuments(actor)
      .where(and(eq(documents.id, id), isNull(documents.deletedAt), documentScope(actor)))
      .limit(1);
    if (!row) throw new NotFoundException('Document not found.');
    return this.toView(actor, row);
  }

  private async studentCrumbs(actor: AuthUser, clientId: string): Promise<DriveCrumb[]> {
    const [c] = await this.db
      .select({ id: clients.id, name: clients.fullName })
      .from(clients)
      .where(and(eq(clients.id, clientId), studentScope(actor)))
      .limit(1);
    if (!c) throw new NotFoundException('Student not found.');
    return [
      { id: null, name: 'Students', kind: 'students' },
      { id: null, name: c.name, kind: 'student', clientId: c.id },
    ];
  }

  private applyFilters(conditions: (SQL | undefined)[], q: DriveListQuery): void {
    if (q.q) {
      const term = `%${q.q}%`;
      conditions.push(
        or(
          ilike(documents.fileName, term),
          ilike(clients.fullName, term),
          sql`${documents.tags}::text ilike ${term}`,
          sql`exists (select 1 from document_types t where t.tenant_id = ${documents.tenantId}
            and t.key = ${documents.typeKey} and t.label ilike ${term})`,
        ),
      );
    }
    if (q.type) conditions.push(eq(documents.typeKey, q.type));
    if (q.status) conditions.push(eq(documents.status, q.status));
    if (q.caseId) conditions.push(eq(documents.caseId, q.caseId));
    if (q.country) {
      conditions.push(
        or(
          sql`lower(${cases.targetCountry}) = lower(${q.country})`,
          sql`(${documents.caseId} is null and exists (select 1 from cases k
            where k.client_id = ${documents.clientId} and lower(k.target_country) = lower(${q.country})))`,
        ),
      );
    }
    if (q.uploaderId) conditions.push(eq(documents.uploadedBy, q.uploaderId));
    if (q.uploaderRole === 'client') conditions.push(eq(users.role, 'client'));
    if (q.uploaderRole === 'staff') conditions.push(inArray(users.role, ['consultant', 'manager']));
    if (q.uploaderRole === 'partner') conditions.push(eq(users.role, 'partner'));
    if (q.tag) conditions.push(sql`${documents.tags} @> ${JSON.stringify([q.tag])}::jsonb`);
    if (q.from) conditions.push(sql`${documents.uploadedAt} >= ${q.from}::date`);
    if (q.to) conditions.push(sql`${documents.uploadedAt} < ${q.to}::date + 1`);
    if (q.expiringWithin !== undefined && q.view !== 'expiring') {
      conditions.push(isNotNull(documents.expiresOn), sql`${documents.expiresOn} <= current_date + ${q.expiringWithin}::int`);
    }
  }

  private order(sort: DriveListQuery['sort']) {
    switch (sort) {
      case 'name':
        return [asc(sql`lower(${documents.fileName})`), desc(documents.uploadedAt)];
      case 'oldest':
        return [asc(documents.uploadedAt)];
      case 'size':
        return [desc(documents.fileSize), desc(documents.uploadedAt)];
      case 'status':
        return [asc(documents.status), desc(documents.uploadedAt)];
      case 'expiry':
        return [sql`${documents.expiresOn} asc nulls last`, desc(documents.uploadedAt)];
      default:
        return [desc(documents.uploadedAt)];
    }
  }

  private selectDocuments(actor: AuthUser) {
    return this.db
      .select({
        doc: documents,
        clientName: clients.fullName,
        caseReference: cases.reference,
        targetCountry: cases.targetCountry,
        folderName: docFolders.name,
        uploaderName: users.fullName,
        uploaderRole: users.role,
        reviewerName: reviewer.fullName,
        typeName: documentTypes.label,
        versionCount: sql<number>`(select count(*)::int from documents v
          where v.version_group = ${documents.versionGroup} and v.deleted_at is null)`,
        starred: sql<boolean>`exists (select 1 from drive_stars s
          where s.user_id = ${actor.id}::uuid and s.item_type = 'document' and s.item_id = ${documents.id})`,
      })
      .from(documents)
      .leftJoin(clients, eq(clients.id, documents.clientId))
      .leftJoin(cases, eq(cases.id, documents.caseId))
      .leftJoin(docFolders, eq(docFolders.id, documents.folderId))
      .innerJoin(users, eq(users.id, documents.uploadedBy))
      .leftJoin(reviewer, eq(reviewer.id, documents.reviewedBy))
      .leftJoin(documentTypes, and(eq(documentTypes.tenantId, documents.tenantId), eq(documentTypes.key, documents.typeKey)));
  }

  private toView(
    actor: AuthUser,
    r: {
      doc: DocRow;
      clientName: string | null;
      caseReference: string | null;
      targetCountry: string | null;
      folderName: string | null;
      uploaderName: string;
      uploaderRole: string;
      reviewerName: string | null;
      typeName: string | null;
      versionCount: number;
      starred: boolean;
    },
  ): DriveDocumentView {
    const d = r.doc;
    const staff = actor.role === 'manager' || actor.role === 'consultant';
    const daysToExpiry = d.expiresOn ? Math.round((Date.parse(`${d.expiresOn}T00:00:00Z`) - Date.parse(`${today()}T00:00:00Z`)) / 86_400_000) : null;
    return {
      id: d.id,
      fileName: d.fileName,
      clientId: d.clientId,
      clientName: r.clientName,
      caseId: d.caseId,
      caseReference: r.caseReference,
      targetCountry: r.targetCountry,
      folderId: d.folderId,
      folderName: r.folderName,
      typeKey: d.typeKey,
      typeLabel: r.typeName ?? typeLabel(d.typeKey),
      status: d.status as DocumentStatus,
      mimeType: d.mimeType,
      fileSize: d.fileSize,
      uploadedAt: iso(d.uploadedAt),
      uploadedById: d.uploadedBy,
      uploadedByName: r.uploaderName,
      uploadedByRole: r.uploaderRole,
      reviewerComment: d.reviewerComment,
      reviewedAt: isoOrNull(d.reviewedAt),
      reviewedByName: r.reviewerName,
      expiresOn: d.expiresOn,
      issuedOn: d.issuedOn,
      daysToExpiry,
      tags: Array.isArray(d.tags) ? d.tags : [],
      color: d.color,
      starred: Boolean(r.starred),
      version: d.version,
      versionCount: Number(r.versionCount ?? 1),
      versionGroup: d.versionGroup ?? d.id,
      duplicateOfId: d.duplicateOf,
      trashedAt: isoOrNull(d.trashedAt),
      fileUrl: `/api/documents/${d.id}/file`,
      downloadUrl: `/api/documents/${d.id}/download`,
      canTrash: canTrash(actor, { uploadedBy: d.uploadedBy, status: d.status }) && (actor.role === 'client' || hasPermission(actor, 'document.delete')),
      canReview: staff && hasPermission(actor, 'document.verify'),
      canOrganise: staff && hasPermission(actor, 'document.manage'),
    };
  }

  /* ---------------------------------------------------------------- */
  /* Students                                                          */
  /* ---------------------------------------------------------------- */

  async students(actor: AuthUser, query: StudentsQuery): Promise<Paginated<DriveStudentView>> {
    const tenantId = tenantOf(actor);
    const where = and(
      studentScope(actor),
      eq(clients.archived, false),
      query.q ? or(ilike(clients.fullName, `%${query.q}%`), ilike(clients.email, `%${query.q}%`)) : undefined,
    );
    const live = sql`d.client_id = ${clients.id} and d.deleted_at is null and d.trashed_at is null and d.superseded_by is null`;
    const [[count], rows] = await Promise.all([
      this.db.select({ n: sql<number>`count(*)::int` }).from(clients).where(where),
      this.db
        .select({
          clientId: clients.id,
          name: clients.fullName,
          email: clients.email,
          consultantName: users.fullName,
          documentCount: sql<number>`(select count(*)::int from documents d where ${live})`,
          pendingCount: sql<number>`(select count(*)::int from documents d where ${live} and d.status in ('pending', 'under_review'))`,
          lastUploadAt: sql<string | null>`(select max(d.uploaded_at) from documents d where ${live})`,
        })
        .from(clients)
        .leftJoin(consultants, eq(consultants.id, clients.assignedConsultantId))
        .leftJoin(users, eq(users.id, consultants.userId))
        .where(where)
        .orderBy(sql`(select max(d.uploaded_at) from documents d where ${live}) desc nulls last`, asc(clients.fullName))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
    ]);
    const completion = await this.checklists.completionFor(tenantId, rows.map((r) => r.clientId));
    return page(
      rows.map((r) => ({
        ...r,
        documentCount: Number(r.documentCount),
        pendingCount: Number(r.pendingCount),
        lastUploadAt: r.lastUploadAt ? iso(r.lastUploadAt) : null,
        completion: completion.get(r.clientId) ?? null,
      })),
      count?.n ?? 0,
      query.page,
      query.pageSize,
    );
  }

  /* ---------------------------------------------------------------- */
  /* Organising                                                        */
  /* ---------------------------------------------------------------- */

  async updateDocument(actor: AuthUser, id: string, input: UpdateDocumentInput): Promise<DriveDocumentView> {
    const doc = await this.documents.findAccessible(actor, id);
    const changes: Partial<typeof documents.$inferInsert> = {};
    const notes: Record<string, unknown> = {};
    if (input.fileName !== undefined && input.fileName !== doc.fileName) {
      const ext = /\.[a-z0-9]+$/i.exec(doc.fileName)?.[0] ?? '';
      const name = input.fileName.replace(/[\\/:*?"<>|]/g, '').trim();
      changes.fileName = name.toLowerCase().endsWith(ext.toLowerCase()) ? name : `${name}${ext}`;
      notes.renamedFrom = doc.fileName;
    }
    if (input.folderId !== undefined && input.folderId !== doc.folderId) {
      if (input.folderId) {
        const folder = await this.folders.find(actor, input.folderId);
        if (folder.clientId !== doc.clientId) throw new BadRequestException('Documents stay with their student. Copy it instead.');
      }
      changes.folderId = input.folderId;
      notes.movedTo = input.folderId;
    }
    if (input.caseId !== undefined && input.caseId !== doc.caseId) {
      if (input.caseId) {
        const [k] = await this.db
          .select({ id: cases.id })
          .from(cases)
          .where(and(eq(cases.id, input.caseId), eq(cases.clientId, doc.clientId ?? NIL_UUID)))
          .limit(1);
        if (!k) throw new BadRequestException('That application is not this student’s.');
      }
      changes.caseId = input.caseId;
      notes.application = input.caseId;
    }
    if (input.typeKey !== undefined && input.typeKey !== doc.typeKey) {
      const [t] = await this.db
        .select({ key: documentTypes.key })
        .from(documentTypes)
        .where(and(eq(documentTypes.tenantId, doc.tenantId), eq(documentTypes.key, input.typeKey)))
        .limit(1);
      if (!t) throw new BadRequestException({ message: 'That document type does not exist.', fieldErrors: { typeKey: 'Pick a type.' } });
      changes.typeKey = input.typeKey;
      changes.type = (DOCUMENT_TYPES as readonly string[]).includes(input.typeKey)
        ? (input.typeKey as typeof documents.$inferInsert.type)
        : 'other';
      notes.type = { from: doc.typeKey, to: input.typeKey };
    }
    if (input.tags !== undefined) changes.tags = [...new Set(input.tags.map((t) => t.trim()).filter(Boolean))];
    if (input.color !== undefined) changes.color = input.color;
    if (input.expiresOn !== undefined) {
      changes.expiresOn = input.expiresOn;
      changes.expiryNotifiedDays = null;
      notes.expiresOn = input.expiresOn;
    }
    if (input.issuedOn !== undefined) changes.issuedOn = input.issuedOn;
    if (Object.keys(changes).length) {
      await this.db.update(documents).set(changes).where(eq(documents.id, id));
      await this.audit.record(actor, {
        action: 'document.updated',
        entityType: 'document',
        entityId: id,
        caseId: doc.caseId,
        clientId: doc.clientId,
        metadata: { fileName: changes.fileName ?? doc.fileName, ...notes, ...(input.tags ? { tags: changes.tags } : {}) },
      });
    }
    return this.document(actor, id);
  }

  /** A copy into another folder of the same student - its own bytes, its own history. */
  async copyDocument(actor: AuthUser, id: string, input: CopyDocumentInput): Promise<DriveDocumentView> {
    const doc = await this.documents.findAccessible(actor, id);
    const folder = await this.folders.find(actor, input.folderId);
    if (folder.clientId !== doc.clientId) throw new BadRequestException('A copy stays with the same student.');
    const newId = randomUUID();
    const key = `tenants/${doc.tenantId}/${doc.clientId ? `clients/${doc.clientId}` : 'agency'}/${doc.typeKey}/${randomUUID()}`;
    await this.storage.copy(doc.fileKey, key);
    const { id: _ignored, ...rest } = doc;
    void _ignored;
    await this.db.insert(documents).values({
      ...rest,
      id: newId,
      folderId: folder.id,
      fileKey: key,
      versionGroup: newId,
      version: 1,
      supersededBy: null,
      duplicateOf: doc.id,
      uploadedBy: actor.id,
      uploadedAt: new Date(),
      expiryNotifiedDays: null,
    });
    await this.audit.record(actor, {
      action: 'document.copied',
      entityType: 'document',
      entityId: newId,
      caseId: doc.caseId,
      clientId: doc.clientId,
      metadata: { fileName: doc.fileName, from: doc.id, folder: folder.name },
    });
    return this.document(actor, newId);
  }

  async star(actor: AuthUser, input: StarInput): Promise<void> {
    if (input.itemType === 'document') await this.documents.findAccessible(actor, input.itemId);
    else await this.folders.find(actor, input.itemId);
    if (input.starred) {
      await this.db
        .insert(driveStars)
        .values({ tenantId: tenantOf(actor), userId: actor.id, itemType: input.itemType, itemId: input.itemId })
        .onConflictDoNothing();
    } else {
      await this.db
        .delete(driveStars)
        .where(and(eq(driveStars.userId, actor.id), eq(driveStars.itemType, input.itemType), eq(driveStars.itemId, input.itemId)));
    }
  }

  /**
   * One action across many documents. Each is checked and done on its own,
   * so one refusal does not stop the rest; the reply says which failed and why.
   */
  async bulk(actor: AuthUser, input: BulkInput): Promise<{ done: number; failed: { id: string; message: string }[] }> {
    const failed: { id: string; message: string }[] = [];
    let done = 0;
    const need = (p: Parameters<typeof hasPermission>[1]) => {
      if (actor.role !== 'client' && !hasPermission(actor, p)) {
        throw new ForbiddenException({ message: 'You do not have permission to do that.', code: 'PERMISSION_DENIED', permission: p });
      }
    };
    if (input.action === 'move' || input.action === 'tag') need('document.manage');
    if (input.action === 'approve' || input.action === 'under_review') need('document.verify');
    if (input.action === 'trash' || input.action === 'restore') need('document.delete');
    if (input.action === 'move' && !input.folderId) throw new BadRequestException('Choose a folder to move them to.');
    if (input.action === 'tag' && !input.tag) throw new BadRequestException('Type a tag.');

    for (const id of new Set(input.documentIds)) {
      try {
        switch (input.action) {
          case 'trash':
            await this.documents.trash(actor, id);
            break;
          case 'restore':
            await this.documents.restore(actor, id);
            break;
          case 'move':
            await this.updateDocument(actor, id, { folderId: input.folderId });
            break;
          case 'tag': {
            const doc = await this.documents.findAccessible(actor, id);
            await this.updateDocument(actor, id, { tags: [...(doc.tags ?? []), input.tag!] });
            break;
          }
          case 'approve':
            await this.documents.setStatus(actor, id, 'verified');
            break;
          case 'under_review':
            await this.documents.setStatus(actor, id, 'under_review');
            break;
        }
        done++;
      } catch (err) {
        const res = (err as { response?: { message?: string } }).response;
        failed.push({ id, message: res?.message ?? (err as Error).message });
      }
    }
    return { done, failed };
  }

  /* ---------------------------------------------------------------- */
  /* Document types, folder templates, checklists                      */
  /* ---------------------------------------------------------------- */

  async types(actor: AuthUser): Promise<DocumentTypeView[]> {
    const rows = await this.db
      .select()
      .from(documentTypes)
      .where(eq(documentTypes.tenantId, tenantOf(actor)))
      .orderBy(desc(documentTypes.active), asc(sql`lower(${documentTypes.label})`));
    return rows.map((t) => ({
      id: t.id,
      key: t.key,
      label: t.label,
      hint: t.hint,
      folderKey: t.folderKey,
      hasExpiry: t.hasExpiry,
      system: t.system,
      active: t.active,
    }));
  }

  async saveType(actor: AuthUser, input: DocumentTypeInput, id?: string): Promise<DocumentTypeView> {
    const tenantId = tenantOf(actor);
    const values = {
      label: input.label,
      hint: input.hint ?? null,
      folderKey: input.folderKey,
      hasExpiry: input.hasExpiry,
      active: input.key === 'other' ? true : input.active,
      updatedAt: new Date(),
    };
    try {
      if (id) {
        const [row] = await this.db
          .update(documentTypes)
          .set(values)
          .where(and(eq(documentTypes.id, id), eq(documentTypes.tenantId, tenantId)))
          .returning({ id: documentTypes.id });
        if (!row) throw new NotFoundException('Document type not found.');
      } else {
        await this.db.insert(documentTypes).values({ tenantId, key: input.key, ...values });
      }
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new BadRequestException({ message: 'That key is taken.', fieldErrors: { key: 'Pick another key.' } });
      }
      throw err;
    }
    await this.audit.record(actor, { action: 'document_type.saved', entityType: 'settings', metadata: { ...input } });
    return (await this.types(actor)).find((t) => t.key === input.key || t.id === id)!;
  }

  async folderTemplates(actor: AuthUser): Promise<FolderTemplateView[]> {
    const rows = await this.db
      .select()
      .from(folderTemplates)
      .where(eq(folderTemplates.tenantId, tenantOf(actor)))
      .orderBy(desc(folderTemplates.isDefault), asc(folderTemplates.name));
    return rows.map((t) => ({ id: t.id, name: t.name, country: t.country, folders: t.folders, isDefault: t.isDefault }));
  }

  async saveFolderTemplate(actor: AuthUser, input: FolderTemplateInput, id?: string): Promise<FolderTemplateView> {
    const tenantId = tenantOf(actor);
    const keys = input.folders.map((f) => f.key);
    if (new Set(keys).size !== keys.length) throw new BadRequestException('Each folder needs its own key.');
    if (input.isDefault) {
      await this.db.update(folderTemplates).set({ isDefault: false }).where(eq(folderTemplates.tenantId, tenantId));
    }
    const values = { name: input.name, country: input.country || null, folders: input.folders, isDefault: input.isDefault, updatedAt: new Date() };
    let savedId = id;
    if (id) {
      const [row] = await this.db
        .update(folderTemplates)
        .set(values)
        .where(and(eq(folderTemplates.id, id), eq(folderTemplates.tenantId, tenantId)))
        .returning({ id: folderTemplates.id });
      if (!row) throw new NotFoundException('Template not found.');
    } else {
      const [row] = await this.db.insert(folderTemplates).values({ tenantId, ...values }).returning({ id: folderTemplates.id });
      savedId = row!.id;
    }
    await this.audit.record(actor, { action: 'folder_template.saved', entityType: 'settings', entityId: savedId, metadata: { name: input.name, country: input.country ?? null } });
    return (await this.folderTemplates(actor)).find((t) => t.id === savedId)!;
  }

  async deleteFolderTemplate(actor: AuthUser, id: string): Promise<void> {
    const [row] = await this.db
      .delete(folderTemplates)
      .where(and(eq(folderTemplates.id, id), eq(folderTemplates.tenantId, tenantOf(actor))))
      .returning({ name: folderTemplates.name });
    if (!row) throw new NotFoundException('Template not found.');
    await this.audit.record(actor, { action: 'folder_template.saved', entityType: 'settings', entityId: id, metadata: { removed: row.name } });
  }

  async checklistSets(actor: AuthUser): Promise<RequirementSetView[]> {
    const rows = await this.db
      .select()
      .from(requirementSets)
      .where(eq(requirementSets.tenantId, tenantOf(actor)))
      .orderBy(sql`${requirementSets.country} asc nulls first`, asc(requirementSets.name));
    return rows.map((s) => ({
      id: s.id,
      name: s.name,
      country: s.country,
      studyLevel: s.studyLevel,
      visaType: s.visaType,
      items: s.items,
      active: s.active,
    }));
  }

  async saveChecklistSet(actor: AuthUser, input: RequirementSetInput, id?: string): Promise<RequirementSetView> {
    const tenantId = tenantOf(actor);
    const known = new Set((await this.types(actor)).map((t) => t.key));
    const unknown = input.items.filter((i) => !known.has(i.typeKey)).map((i) => i.typeKey);
    if (unknown.length) throw new BadRequestException(`Unknown document types: ${unknown.join(', ')}.`);
    const values = {
      name: input.name,
      country: input.country || null,
      studyLevel: input.studyLevel || null,
      visaType: input.visaType || null,
      items: input.items.map((i) => ({ typeKey: i.typeKey, required: i.required, note: i.note ?? null })),
      active: input.active,
      updatedAt: new Date(),
    };
    let savedId = id;
    if (id) {
      const [row] = await this.db
        .update(requirementSets)
        .set(values)
        .where(and(eq(requirementSets.id, id), eq(requirementSets.tenantId, tenantId)))
        .returning({ id: requirementSets.id });
      if (!row) throw new NotFoundException('Checklist not found.');
    } else {
      const [row] = await this.db.insert(requirementSets).values({ tenantId, ...values }).returning({ id: requirementSets.id });
      savedId = row!.id;
    }
    await this.audit.record(actor, {
      action: 'checklist.saved',
      entityType: 'settings',
      entityId: savedId,
      metadata: { name: input.name, country: values.country, items: values.items.length },
    });
    return (await this.checklistSets(actor)).find((s) => s.id === savedId)!;
  }

  async deleteChecklistSet(actor: AuthUser, id: string): Promise<void> {
    const [row] = await this.db
      .delete(requirementSets)
      .where(and(eq(requirementSets.id, id), eq(requirementSets.tenantId, tenantOf(actor))))
      .returning({ name: requirementSets.name });
    if (!row) throw new NotFoundException('Checklist not found.');
    await this.audit.record(actor, { action: 'checklist.saved', entityType: 'settings', entityId: id, metadata: { removed: row.name } });
  }

  /* ---------------------------------------------------------------- */
  /* Access grants                                                     */
  /* ---------------------------------------------------------------- */

  async grants(actor: AuthUser, filter: { resourceType?: string; resourceId?: string }): Promise<GrantView[]> {
    const tenantId = tenantOf(actor);
    const rows = await this.db
      .select({
        id: resourceGrants.id,
        resourceType: resourceGrants.resourceType,
        resourceId: resourceGrants.resourceId,
        userId: resourceGrants.userId,
        userName: users.fullName,
        access: resourceGrants.access,
        createdAt: resourceGrants.createdAt,
        resourceName: sql<string>`coalesce(
          (select f.name from doc_folders f where f.id = ${resourceGrants.resourceId}),
          (select d.file_name from documents d where d.id = ${resourceGrants.resourceId}), '')`,
      })
      .from(resourceGrants)
      .innerJoin(users, eq(users.id, resourceGrants.userId))
      .where(
        and(
          eq(resourceGrants.tenantId, tenantId),
          filter.resourceType ? eq(resourceGrants.resourceType, filter.resourceType) : undefined,
          filter.resourceId ? eq(resourceGrants.resourceId, filter.resourceId) : undefined,
        ),
      )
      .orderBy(desc(resourceGrants.createdAt));
    return rows.map((r) => ({
      ...r,
      resourceType: r.resourceType as GrantView['resourceType'],
      access: r.access as GrantView['access'],
      createdAt: iso(r.createdAt),
    }));
  }

  /** Grants widen what someone sees, so - like permissions - they are a manager's call. */
  async grant(actor: AuthUser, input: GrantInput): Promise<GrantView> {
    const tenantId = tenantOf(actor);
    if (input.resourceType === 'folder') await this.folders.find(actor, input.resourceId);
    else await this.documents.findAccessible(actor, input.resourceId);
    const [member] = await this.db
      .select({ id: users.id, name: users.fullName })
      .from(users)
      .where(and(eq(users.id, input.userId), eq(users.tenantId, tenantId), eq(users.role, 'consultant')))
      .limit(1);
    if (!member) throw new BadRequestException('Grant access to a member of staff.');
    await this.db
      .insert(resourceGrants)
      .values({ tenantId, ...input, createdBy: actor.id })
      .onConflictDoUpdate({
        target: [resourceGrants.resourceType, resourceGrants.resourceId, resourceGrants.userId],
        set: { access: input.access },
      });
    await this.audit.record(actor, {
      action: 'grant.added',
      entityType: 'grant',
      entityId: input.resourceId,
      metadata: { resourceType: input.resourceType, memberId: member.id, memberName: member.name, access: input.access },
    });
    return (await this.grants(actor, { resourceId: input.resourceId })).find((g) => g.userId === input.userId)!;
  }

  async revokeGrant(actor: AuthUser, id: string): Promise<void> {
    const [row] = await this.db
      .delete(resourceGrants)
      .where(and(eq(resourceGrants.id, id), eq(resourceGrants.tenantId, tenantOf(actor))))
      .returning();
    if (!row) throw new NotFoundException('Grant not found.');
    await this.audit.record(actor, {
      action: 'grant.removed',
      entityType: 'grant',
      entityId: row.resourceId,
      metadata: { resourceType: row.resourceType, memberId: row.userId },
    });
  }
}


import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { createHash, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  DOCUMENT_TYPES,
  MAX_DOCUMENTS_PER_CASE,
  classifyFileName,
  hasPermission,
  renameForDownload,
  typeLabel,
  type AuthUser,
  type CommentDocumentInput,
  type DocumentComment,
  type DocumentStatus,
  type DocumentType,
  type DocumentVersionView,
  type DocumentView,
  type ListDocumentsQuery,
  type Paginated,
  type RejectDocumentInput,
  type UploadDocumentInput,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import {
  cases,
  clients,
  consultants,
  documentComments,
  documentTypes,
  documents,
  users,
} from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CasesService } from '../cases/cases.service';
import { AutomationService } from '../workflows/automation.service';
import { EntitlementsService } from '../tenancy/entitlements.service';
import { STORAGE, type StorageDriver } from '../storage/storage.driver';
import { VirusScanner } from '../storage/virus-scan';
import { validateUpload, type ValidatedFile } from './file-validation';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { seesAll } from '../auth/permissions';
import { NIL_UUID, iso, isoOrNull, page } from '../common/db-helpers';
import { documentScope } from './drive-sql';
import { FoldersService } from './folders.service';
import { DriveSettingsService } from './drive-settings.service';

const SIGNED_URL_TTL = 300;

/** Where a new document goes, and what it is. Everything but the client is optional. */
export interface StoreInput {
  clientId: string | null;
  caseId?: string | null;
  folderId?: string | null;
  typeKey?: string | null;
  replacesId?: string | null;
  expiresOn?: string | null;
  issuedOn?: string | null;
}

export type DocRow = typeof documents.$inferSelect;

/**
 * Documents: storing them, reviewing them, versions, the trash, and reading
 * them back. The drive (drive/) builds folders, sharing and bulk work on top
 * of this; the student's portal and the case page use it directly.
 *
 * Who may see a document is decided in one place, documentScope (drive-sql),
 * for every query here.
 */
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: StorageDriver,
    private readonly scanner: VirusScanner,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly cases: CasesService,
    private readonly folders: FoldersService,
    private readonly settings: DriveSettingsService,
    private readonly entitlements: EntitlementsService,
    private readonly automation: AutomationService,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Accepting a file                                                  */
  /* ---------------------------------------------------------------- */

  /**
   * Checks a file against the consultancy's own rules (types, size), by its
   * leading bytes, then scans it for viruses when a scanner is configured.
   */
  async accept(
    actor: AuthUser,
    file: { buffer: Buffer; originalname: string; size: number },
  ): Promise<ValidatedFile> {
    const rules = await this.settings.uploadRules(tenantOf(actor));
    const valid = validateUpload(file, rules);
    await this.scanner.assertClean(valid.buffer, valid.fileName);
    return valid;
  }

  /** The original upload route: a document for one of a student's applications. */
  async upload(actor: AuthUser, input: UploadDocumentInput, file: ValidatedFile): Promise<DocumentView> {
    const created = await this.store(
      actor,
      {
        clientId: null,
        caseId: input.caseId,
        typeKey: input.type,
        replacesId: input.replacesId ?? null,
        expiresOn: input.expiresOn ?? null,
      },
      file,
    );
    return this.view(actor, created.id);
  }

  /**
   * Stores a document. Works out the student from the application when only
   * that is given, files it into the folder its type belongs in unless told
   * otherwise, keeps it as a new version when it replaces another, and notes
   * when the same bytes are already in the student's drive.
   */
  async store(actor: AuthUser, input: StoreInput, file: ValidatedFile): Promise<DocRow> {
    const tenantId = tenantOf(actor);
    let clientId = input.clientId;
    let caseId = input.caseId ?? null;

    // Access to the application, or to the student, is the access check.
    if (caseId) {
      const kase = await this.cases.findAccessible(actor, caseId);
      if (clientId && kase.case.clientId !== clientId) {
        throw new BadRequestException('That application is not this student’s.');
      }
      clientId = kase.case.clientId;
    }

    let folderId = input.folderId ?? null;
    if (folderId) {
      const folder = await this.folders.find(actor, folderId);
      if (clientId && folder.clientId && folder.clientId !== clientId) {
        throw new BadRequestException('That folder belongs to another student.');
      }
      clientId = folder.clientId;
    }
    if (clientId && !caseId) await this.assertStudentAccess(actor, clientId, folderId);
    if (!clientId && actor.role === 'client') throw new ForbiddenException('Upload into your own documents.');
    if (!clientId && !folderId) throw new BadRequestException('Choose a student or a folder for the file.');

    // A replacement continues the same document's history.
    let previous: DocRow | null = null;
    if (input.replacesId) {
      previous = await this.findAccessible(actor, input.replacesId);
      if (previous.clientId !== clientId && clientId) {
        throw new BadRequestException('A new version must be for the same student.');
      }
      if (actor.role === 'client' && !['pending', 'rejected', 'reupload_requested'].includes(previous.status)) {
        throw new ForbiddenException('This document has been approved. Ask your consultant if it needs replacing.');
      }
      clientId = previous.clientId;
      caseId = caseId ?? previous.caseId;
      folderId = folderId ?? previous.folderId;
    }

    const typeKey = await this.resolveType(tenantId, input.typeKey ?? previous?.typeKey ?? null, file.fileName);

    if (caseId && !previous) {
      const [row] = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(documents)
        .where(
          and(eq(documents.caseId, caseId), isNull(documents.deletedAt), isNull(documents.trashedAt), isNull(documents.supersededBy)),
        );
      if ((row?.n ?? 0) >= MAX_DOCUMENTS_PER_CASE) {
        throw new BadRequestException(
          `This application already has the maximum of ${MAX_DOCUMENTS_PER_CASE} documents. Remove one before adding another.`,
        );
      }
    }

    await this.entitlements.assertStorageFor(tenantId, file.size);
    if (clientId && !folderId) folderId = await this.folders.folderForType(tenantId, clientId, typeKey);

    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const [duplicate] = clientId
      ? await this.db
          .select({ id: documents.id })
          .from(documents)
          .where(
            and(
              eq(documents.clientId, clientId),
              eq(documents.checksum, checksum),
              isNull(documents.deletedAt),
              isNull(documents.trashedAt),
              previous ? sql`${documents.id} <> ${previous.id}::uuid` : undefined,
            ),
          )
          .limit(1)
      : [];

    // Keys are ours, opaque and unguessable - never derived from user input -
    // and prefixed by consultancy so one consultancy's files stand apart.
    const id = randomUUID();
    const key = `tenants/${tenantId}/${clientId ? `clients/${clientId}` : 'agency'}/${typeKey}/${randomUUID()}`;
    await this.storage.put(key, file.buffer, file.mimeType);

    let versionGroup: string = id;
    let version = 1;
    if (previous) {
      versionGroup = previous.versionGroup ?? previous.id;
      const [max] = await this.db
        .select({ v: sql<number>`max(${documents.version})::int` })
        .from(documents)
        .where(eq(documents.versionGroup, versionGroup));
      version = (max?.v ?? previous.version) + 1;
    }

    const [created] = await this.db
      .insert(documents)
      .values({
        id,
        tenantId,
        caseId,
        clientId,
        type: (DOCUMENT_TYPES as readonly string[]).includes(typeKey) ? (typeKey as DocumentType) : 'other',
        typeKey,
        folderId,
        versionGroup,
        version,
        fileKey: key,
        fileName: file.fileName,
        fileSize: file.size,
        mimeType: file.mimeType,
        checksum,
        duplicateOf: duplicate?.id ?? null,
        expiresOn: input.expiresOn ?? null,
        issuedOn: input.issuedOn ?? null,
        status: 'pending',
        uploadedBy: actor.id,
      })
      .returning();
    if (!created) throw new Error('Document insert returned no row');

    if (previous) {
      await this.db.update(documents).set({ supersededBy: created.id }).where(eq(documents.id, previous.id));
    }
    if (caseId) await this.cases.touch(caseId);

    await this.audit.record(actor, {
      action: 'document.uploaded',
      entityType: 'document',
      entityId: created.id,
      caseId,
      clientId,
      metadata: {
        type: typeKey,
        fileName: file.fileName,
        size: file.size,
        version,
        replaces: previous?.id ?? null,
        duplicateOf: duplicate?.id ?? null,
      },
    });

    // Tell their consultant something is waiting - only when the student
    // sent it; staff do not need telling about their own upload.
    if (actor.role === 'client' && clientId) {
      const consultantUserId = await this.consultantUserFor(clientId, caseId);
      const [who] = await this.db.select({ name: clients.fullName }).from(clients).where(eq(clients.id, clientId));
      if (consultantUserId) {
        await this.notifications.push({
          userId: consultantUserId,
          type: 'document_uploaded',
          title: `${who?.name ?? 'A student'} uploaded ${await this.labelFor(tenantId, typeKey)}`,
          body: previous ? `A new version (v${version}). It is waiting for your review.` : 'It is waiting for your review.',
          link: caseId ? `/desk/cases/${caseId}` : `/desk/documents?clientId=${clientId}`,
          caseId,
          email: true,
        });
      }
    }
    await this.fireDocumentEvent('document_uploaded', { ...created, tenantId }, actor, '');
    return created;
  }

  /**
   * Automations listening for documents. A student's own document (no
   * application) concerns each of their open applications.
   */
  private async fireDocumentEvent(
    trigger: 'document_uploaded' | 'document_approved' | 'document_rejected',
    doc: { id: string; tenantId: string; caseId: string | null; clientId: string | null; typeKey: string },
    actor: AuthUser,
    occurrence: string,
  ): Promise<void> {
    const caseIds = doc.caseId
      ? [doc.caseId]
      : doc.clientId
        ? (
            await this.db
              .select({ id: cases.id })
              .from(cases)
              .where(and(eq(cases.clientId, doc.clientId), eq(cases.status, 'active')))
          ).map((c) => c.id)
        : [];
    for (const caseId of caseIds) {
      await this.automation.fire({
        trigger,
        tenantId: doc.tenantId,
        caseId,
        actor,
        documentType: doc.typeKey,
        eventKey: `${trigger}:${doc.id}:${caseId}${occurrence}`,
      });
    }
  }

  /** A type key the consultancy knows, or the best guess from the file name, or "other". */
  private async resolveType(tenantId: string, given: string | null, fileName: string): Promise<string> {
    const candidate = given || classifyFileName(fileName) || 'other';
    if ((DOCUMENT_TYPES as readonly string[]).includes(candidate)) return candidate;
    const [own] = await this.db
      .select({ key: documentTypes.key })
      .from(documentTypes)
      .where(and(eq(documentTypes.tenantId, tenantId), eq(documentTypes.key, candidate)))
      .limit(1);
    if (own) return own.key;
    if (given) throw new BadRequestException({ message: 'That document type does not exist.', fieldErrors: { typeKey: 'Pick a type.' } });
    return 'other';
  }

  /** Staff working with the student, the student themselves, or someone granted the folder. */
  private async assertStudentAccess(actor: AuthUser, clientId: string, folderId: string | null): Promise<void> {
    const tenantId = tenantOf(actor);
    if (actor.role === 'client') {
      if (actor.clientId !== clientId) throw new NotFoundException('Student not found.');
      return;
    }
    // A partner, for the students it brought (folders are the consultancy's to file into).
    if (actor.role === 'partner') {
      const [mine] = await this.db
        .select({ id: clients.id })
        .from(clients)
        .where(and(eq(clients.id, clientId), eq(clients.tenantId, tenantId), eq(clients.partnerId, actor.partnerId ?? NIL_UUID)))
        .limit(1);
      if (!mine || folderId) throw new NotFoundException('Student not found.');
      return;
    }
    const me = actor.consultantId ?? NIL_UUID;
    const [row] = await this.db
      .select({ id: clients.id })
      .from(clients)
      .where(
        and(
          eq(clients.id, clientId),
          eq(clients.tenantId, tenantId),
          actor.role === 'manager' || seesAll(actor)
            ? undefined
            : or(
                eq(clients.assignedConsultantId, me),
                sql`exists (select 1 from cases k where k.client_id = "clients"."id" and k.consultant_id = ${me}::uuid)`,
                folderId
                  ? sql`exists (select 1 from resource_grants g join doc_folders f on f.id = ${folderId}::uuid
                      where g.user_id = ${actor.id}::uuid and g.resource_type = 'folder' and g.access = 'edit'
                        and (g.resource_id = f.id or f.ancestry like '%/' || g.resource_id::text || '/%'))`
                  : undefined,
              ),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Student not found.');
  }

  /* ---------------------------------------------------------------- */
  /* Review                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Approve a document. This is the trigger for auto-advancement: if it was
   * the last required document for the stage, the application moves on by itself.
   */
  async verify(actor: AuthUser, documentId: string): Promise<DocumentView> {
    await this.setStatus(actor, documentId, 'verified');
    return this.view(actor, documentId);
  }

  /** Reject with a required reason, and tell the student what to fix. */
  async reject(actor: AuthUser, documentId: string, input: RejectDocumentInput): Promise<DocumentView> {
    await this.setStatus(actor, documentId, 'rejected', input.comment);
    return this.view(actor, documentId);
  }

  /**
   * Moves a document through review: under review, approved, rejected (with
   * a reason), or "please send it again" (with what was wrong). The student
   * hears about every step, in the app and by email.
   */
  async setStatus(
    actor: AuthUser,
    documentId: string,
    status: 'under_review' | 'verified' | 'rejected' | 'reupload_requested',
    comment?: string,
  ): Promise<DocRow> {
    if (actor.role !== 'manager' && actor.role !== 'consultant') {
      throw new ForbiddenException('Only your consultant can review documents.');
    }
    const needed = status === 'verified' || status === 'under_review' ? 'document.verify' : 'document.reject';
    if (!hasPermission(actor, needed)) {
      throw new ForbiddenException({ message: 'You do not have permission to do that.', code: 'PERMISSION_DENIED', permission: needed });
    }
    const doc = await this.findAccessible(actor, documentId);
    if (doc.status === status) return doc;
    // A proof of payment is decided where the money is recorded with it.
    if (doc.typeKey === 'payment_proof') {
      const [waiting] = await this.db.execute<{ id: string }>(
        sql`select id from payment_submissions where document_id = ${doc.id} and status = 'pending' limit 1`,
      ).then((r) => (r as unknown as { rows?: { id: string }[] }).rows ?? (r as unknown as { id: string }[]));
      if (waiting) {
        throw new BadRequestException('This is a proof of payment waiting to be checked. Approve or reject it under Finance → Payments to verify, so the payment is recorded with it.');
      }
    }
    if (doc.status === 'verified' && status !== 'reupload_requested') {
      throw new BadRequestException('This document has already been approved.');
    }
    if ((status === 'rejected' || status === 'reupload_requested') && (comment?.trim().length ?? 0) < 10) {
      throw new BadRequestException({
        message: 'Tell the student what to fix, in a full sentence.',
        fieldErrors: { comment: 'Tell the student what to fix, in a full sentence.' },
      });
    }

    const [updated] = await this.db
      .update(documents)
      .set({
        status,
        reviewerComment: status === 'rejected' || status === 'reupload_requested' ? comment!.trim() : null,
        reviewedBy: actor.id,
        reviewedAt: new Date(),
      })
      .where(eq(documents.id, documentId))
      .returning();
    if (doc.caseId) await this.cases.touch(doc.caseId);

    const label = await this.labelFor(doc.tenantId, doc.typeKey);
    await this.audit.record(actor, {
      action:
        status === 'verified' ? 'document.verified' : status === 'rejected' ? 'document.rejected' : 'document.status_changed',
      entityType: 'document',
      entityId: documentId,
      caseId: doc.caseId,
      clientId: doc.clientId,
      metadata: { type: doc.typeKey, fileName: doc.fileName, from: doc.status, to: status, reason: comment ?? null },
    });

    const message = {
      verified: { type: 'document_verified' as const, title: `${label} approved`, body: 'Nothing more to do for this one.' },
      rejected: { type: 'document_rejected' as const, title: `${label} was not accepted`, body: comment ?? '' },
      reupload_requested: {
        type: 'document_status' as const,
        title: `Please send your ${label} again`,
        body: comment ?? '',
      },
      under_review: {
        type: 'document_status' as const,
        title: `Your ${label} is being checked`,
        body: 'We will tell you as soon as it is done.',
      },
    }[status];
    if (doc.clientId) await this.notifyStudent(doc.clientId, doc.caseId, message);

    // The whole point of the checklist: the application advances on its own.
    // A student's own document (a passport) counts for every application.
    if (status === 'verified') {
      const caseIds = doc.caseId
        ? [doc.caseId]
        : doc.clientId
          ? (
              await this.db
                .select({ id: cases.id })
                .from(cases)
                .where(and(eq(cases.clientId, doc.clientId), eq(cases.status, 'active')))
            ).map((c) => c.id)
          : [];
      for (const caseId of caseIds) await this.cases.evaluateAutoAdvance(caseId, actor);
    }
    if (status !== 'under_review') {
      await this.fireDocumentEvent(
        status === 'verified' ? 'document_approved' : 'document_rejected',
        doc,
        actor,
        `:${updated!.reviewedAt?.toISOString() ?? Date.now()}`,
      );
    }
    return updated!;
  }

  /**
   * A clarifying question that stops short of a rejection - the document stays
   * where it is and the student is not told to upload again.
   */
  async comment(actor: AuthUser, documentId: string, input: CommentDocumentInput): Promise<DocumentView> {
    const doc = await this.findAccessible(actor, documentId);
    await this.db.insert(documentComments).values({
      tenantId: tenantOf(actor),
      documentId,
      authorId: actor.id,
      body: input.body,
    });
    if (doc.caseId) await this.cases.touch(doc.caseId);
    await this.audit.record(actor, {
      action: 'document.commented',
      entityType: 'document',
      entityId: documentId,
      caseId: doc.caseId,
      clientId: doc.clientId,
      metadata: { type: doc.typeKey, body: input.body },
    });

    const label = await this.labelFor(doc.tenantId, doc.typeKey);
    if (actor.role === 'client' && doc.clientId) {
      const consultantUserId = await this.consultantUserFor(doc.clientId, doc.caseId);
      if (consultantUserId) {
        await this.notifications.push({
          userId: consultantUserId,
          type: 'document_commented',
          title: 'A student replied about a document',
          body: input.body,
          link: doc.caseId ? `/desk/cases/${doc.caseId}` : `/desk/documents?clientId=${doc.clientId}`,
          caseId: doc.caseId,
        });
      }
    } else if (doc.clientId) {
      await this.notifyStudent(doc.clientId, doc.caseId, {
        type: 'document_commented',
        title: `Question about your ${label}`,
        body: input.body,
      });
    }
    return this.view(actor, documentId);
  }

  /* ---------------------------------------------------------------- */
  /* Trash                                                             */
  /* ---------------------------------------------------------------- */

  /**
   * Moves a document - every version of it - to the trash. The bytes stay
   * until the consultancy's retention period ends, so it can be restored.
   * The uploader may trash their own file while it is not approved; a
   * manager may trash anything. An approved document is evidence the
   * application was allowed to move on, so the student never removes it.
   */
  async trash(actor: AuthUser, documentId: string): Promise<void> {
    const doc = await this.findAccessible(actor, documentId);
    if (!canTrash(actor, doc)) {
      throw new ForbiddenException(
        doc.status === 'verified'
          ? 'Approved documents cannot be removed. Ask your consultant if it is wrong.'
          : 'You can only remove documents you uploaded yourself.',
      );
    }
    const now = new Date();
    await this.db
      .update(documents)
      .set({ trashedAt: now, trashedBy: actor.id })
      .where(and(eq(documents.versionGroup, doc.versionGroup ?? doc.id), isNull(documents.trashedAt), isNull(documents.deletedAt)));
    if (doc.caseId) await this.cases.touch(doc.caseId);
    await this.audit.record(actor, {
      action: 'document.trashed',
      entityType: 'document',
      entityId: documentId,
      caseId: doc.caseId,
      clientId: doc.clientId,
      metadata: { type: doc.typeKey, fileName: doc.fileName, statusWhenTrashed: doc.status },
    });
  }

  /** The original route's name for it. */
  remove(actor: AuthUser, documentId: string): Promise<void> {
    return this.trash(actor, documentId);
  }

  async restore(actor: AuthUser, documentId: string): Promise<DocRow> {
    const doc = await this.findAccessible(actor, documentId, { includeTrashed: true });
    if (!doc.trashedAt) return doc;
    if (actor.role !== 'manager' && doc.trashedBy !== actor.id) {
      throw new ForbiddenException('Only a manager, or whoever removed it, can restore it.');
    }
    await this.db
      .update(documents)
      .set({ trashedAt: null, trashedBy: null })
      .where(and(eq(documents.versionGroup, doc.versionGroup ?? doc.id), eq(documents.trashedAt, doc.trashedAt), isNull(documents.deletedAt)));
    if (doc.caseId) await this.cases.touch(doc.caseId);
    await this.audit.record(actor, {
      action: 'document.restored',
      entityType: 'document',
      entityId: documentId,
      caseId: doc.caseId,
      clientId: doc.clientId,
      metadata: { type: doc.typeKey, fileName: doc.fileName },
    });
    return (await this.findAccessible(actor, documentId))!;
  }

  /**
   * Empties the trash past the retention period: the bytes go, the row and
   * its audit trail stay, marked deleted. Run by the reminders sweep.
   */
  async purgeExpiredTrash(tenantId: string, retentionDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
    const rows = await this.db
      .update(documents)
      .set({ deletedAt: new Date() })
      .where(and(eq(documents.tenantId, tenantId), isNotNull(documents.trashedAt), lt(documents.trashedAt, cutoff), isNull(documents.deletedAt)))
      .returning({ id: documents.id, fileKey: documents.fileKey, clientId: documents.clientId, fileName: documents.fileName });
    for (const r of rows) {
      await this.storage.delete(r.fileKey).catch((err: unknown) => this.logger.warn(`purge ${r.id}: ${(err as Error).message}`));
      await this.audit.record(null, {
        action: 'document.purged',
        entityType: 'document',
        entityId: r.id,
        tenantId,
        clientId: r.clientId,
        metadata: { fileName: r.fileName, retentionDays },
      });
    }
    return rows.length;
  }

  /* ---------------------------------------------------------------- */
  /* Versions                                                          */
  /* ---------------------------------------------------------------- */

  async versions(actor: AuthUser, documentId: string): Promise<DocumentVersionView[]> {
    const doc = await this.findAccessible(actor, documentId, { includeTrashed: true });
    const rows = await this.db
      .select({
        id: documents.id,
        version: documents.version,
        fileName: documents.fileName,
        fileSize: documents.fileSize,
        status: documents.status,
        uploadedAt: documents.uploadedAt,
        uploadedByName: users.fullName,
        reviewerComment: documents.reviewerComment,
        supersededBy: documents.supersededBy,
      })
      .from(documents)
      .innerJoin(users, eq(users.id, documents.uploadedBy))
      .where(and(eq(documents.versionGroup, doc.versionGroup ?? doc.id), isNull(documents.deletedAt)))
      .orderBy(desc(documents.version));
    return rows.map((r) => ({
      id: r.id,
      version: r.version,
      fileName: r.fileName,
      fileSize: r.fileSize,
      status: r.status as DocumentStatus,
      uploadedAt: iso(r.uploadedAt),
      uploadedByName: r.uploadedByName,
      reviewerComment: r.reviewerComment,
      current: !r.supersededBy,
      fileUrl: `/api/documents/${r.id}/file`,
    }));
  }

  /**
   * Brings an earlier version back as the newest: its bytes are copied into a
   * new version, so the history still reads as what actually happened.
   */
  async restoreVersion(actor: AuthUser, documentId: string, versionId: string): Promise<DocRow> {
    if (actor.role === 'client') throw new ForbiddenException('Ask your consultant to restore an earlier version.');
    const doc = await this.findAccessible(actor, documentId);
    const group = doc.versionGroup ?? doc.id;
    const [old] = await this.db
      .select()
      .from(documents)
      .where(and(eq(documents.id, versionId), eq(documents.versionGroup, group), isNull(documents.deletedAt)))
      .limit(1);
    if (!old) throw new NotFoundException('That version is not part of this document.');
    const [current] = await this.db
      .select()
      .from(documents)
      .where(and(eq(documents.versionGroup, group), isNull(documents.supersededBy), isNull(documents.deletedAt)))
      .limit(1);
    if (current?.id === old.id) return old;

    const [max] = await this.db
      .select({ v: sql<number>`max(${documents.version})::int` })
      .from(documents)
      .where(eq(documents.versionGroup, group));
    const key = `tenants/${old.tenantId}/${old.clientId ? `clients/${old.clientId}` : 'agency'}/${old.typeKey}/${randomUUID()}`;
    await this.storage.copy(old.fileKey, key);
    // Everything about the old version - its type, review and dates - but a new row.
    const { id: _oldId, ...rest } = old;
    void _oldId;
    const [created] = await this.db
      .insert(documents)
      .values({
        ...rest,
        fileKey: key,
        version: (max?.v ?? old.version) + 1,
        supersededBy: null,
        uploadedBy: actor.id,
        uploadedAt: new Date(),
        trashedAt: null,
        trashedBy: null,
        expiryNotifiedDays: null,
      })
      .returning();
    if (current) await this.db.update(documents).set({ supersededBy: created!.id }).where(eq(documents.id, current.id));
    await this.audit.record(actor, {
      action: 'document.version_restored',
      entityType: 'document',
      entityId: created!.id,
      caseId: old.caseId,
      clientId: old.clientId,
      metadata: { fileName: old.fileName, restoredVersion: old.version, newVersion: created!.version },
    });
    return created!;
  }

  /* ---------------------------------------------------------------- */
  /* Read                                                              */
  /* ---------------------------------------------------------------- */

  async list(actor: AuthUser, query: ListDocumentsQuery): Promise<Paginated<DocumentView>> {
    const conditions: (SQL | undefined)[] = [isNull(documents.deletedAt), isNull(documents.trashedAt), documentScope(actor)];
    if (query.caseId) conditions.push(eq(documents.caseId, query.caseId));
    if (query.clientId) conditions.push(eq(documents.clientId, query.clientId));
    if (query.status) conditions.push(eq(documents.status, query.status));
    if (query.awaiting) conditions.push(inArray(documents.status, ['pending', 'under_review']), isNull(documents.supersededBy));
    if (query.type) conditions.push(eq(documents.typeKey, query.type));
    const where = and(...conditions);

    const [[totalRow], rows] = await Promise.all([
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(documents)
        .leftJoin(cases, eq(cases.id, documents.caseId))
        .leftJoin(clients, eq(clients.id, documents.clientId))
        .where(where),
      this.db
        .select(this.selection())
        .from(documents)
        .leftJoin(cases, eq(cases.id, documents.caseId))
        .leftJoin(clients, eq(clients.id, documents.clientId))
        .innerJoin(users, eq(users.id, documents.uploadedBy))
        .where(where)
        .orderBy(query.sort === 'newest' ? desc(documents.uploadedAt) : asc(documents.uploadedAt))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
    ]);

    // Without an N+1: comments and reviewer names for the whole page in one
    // query each; the signed URLs touch no database.
    const docIds = rows.map((r) => r.id);
    const reviewerIds = [...new Set(rows.map((r) => r.reviewedBy).filter((v): v is string => !!v))];
    const [commentsByDoc, reviewerNames] = await Promise.all([this.commentsFor(docIds), this.userNamesFor(reviewerIds)]);
    const items = await Promise.all(
      rows.map(async (r) =>
        assembleView(
          actor,
          r,
          commentsByDoc.get(r.id) ?? [],
          r.reviewedBy ? (reviewerNames.get(r.reviewedBy) ?? null) : null,
          await this.storage.signedUrl(r.fileKey, SIGNED_URL_TTL),
        ),
      ),
    );
    return page(items, totalRow?.n ?? 0, query.page, query.pageSize);
  }

  async view(actor: AuthUser, documentId: string): Promise<DocumentView> {
    const [row] = await this.db
      .select(this.selection())
      .from(documents)
      .leftJoin(cases, eq(cases.id, documents.caseId))
      .leftJoin(clients, eq(clients.id, documents.clientId))
      .innerJoin(users, eq(users.id, documents.uploadedBy))
      .where(and(eq(documents.id, documentId), isNull(documents.deletedAt), documentScope(actor)))
      .limit(1);
    if (!row) throw new NotFoundException('Document not found.');
    const [comments, reviewerNames, signed] = await Promise.all([
      this.commentsFor([row.id]),
      this.userNamesFor(row.reviewedBy ? [row.reviewedBy] : []),
      this.storage.signedUrl(row.fileKey, SIGNED_URL_TTL),
    ]);
    return assembleView(
      actor,
      row,
      comments.get(row.id) ?? [],
      row.reviewedBy ? (reviewerNames.get(row.reviewedBy) ?? null) : null,
      signed,
    );
  }

  /** Streams the bytes, only after the same access check as the metadata. */
  async download(
    actor: AuthUser,
    documentId: string,
  ): Promise<{ stream: Readable; mimeType: string; fileName: string; downloadName: string; doc: DocRow }> {
    const doc = await this.findAccessible(actor, documentId, { includeTrashed: actor.role !== 'client' });
    const stream = await this.storage.get(doc.fileKey);
    // Staff opening a student's passport is exactly what the owner wants to see.
    await this.audit.recordView(actor, {
      action: 'document.downloaded',
      entityType: 'document',
      entityId: documentId,
      caseId: doc.caseId,
      clientId: doc.clientId,
      metadata: { type: doc.typeKey, fileName: doc.fileName },
    });
    return { stream, mimeType: doc.mimeType, fileName: doc.fileName, downloadName: await this.downloadName(doc), doc };
  }

  /** The consultancy's naming pattern applied: Ali_Khan_Passport.pdf. */
  async downloadName(doc: DocRow): Promise<string> {
    const [settings, [meta]] = await Promise.all([
      this.settings.get(doc.tenantId),
      this.db
        .select({ studentName: clients.fullName, caseReference: cases.reference })
        .from(documents)
        .leftJoin(clients, eq(clients.id, documents.clientId))
        .leftJoin(cases, eq(cases.id, documents.caseId))
        .where(eq(documents.id, doc.id))
        .limit(1),
    ]);
    return renameForDownload(settings.renamePattern, {
      studentName: meta?.studentName ?? 'Agency',
      typeLabel: await this.labelFor(doc.tenantId, doc.typeKey),
      uploadedAt: iso(doc.uploadedAt),
      caseReference: meta?.caseReference ?? null,
      fileName: doc.fileName,
      version: doc.version,
    });
  }

  /** A document this person may see, or 404. Trashed ones only when asked for. */
  async findAccessible(actor: AuthUser, documentId: string, opts: { includeTrashed?: boolean } = {}): Promise<DocRow> {
    const [row] = await this.db
      .select({ doc: documents })
      .from(documents)
      .leftJoin(cases, eq(cases.id, documents.caseId))
      .leftJoin(clients, eq(clients.id, documents.clientId))
      .where(
        and(
          eq(documents.id, documentId),
          isNull(documents.deletedAt),
          opts.includeTrashed ? undefined : isNull(documents.trashedAt),
          documentScope(actor),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Document not found.');
    return row.doc;
  }

  async labelFor(tenantId: string, key: string): Promise<string> {
    const [own] = await this.db
      .select({ label: documentTypes.label })
      .from(documentTypes)
      .where(and(eq(documentTypes.tenantId, tenantId), eq(documentTypes.key, key)))
      .limit(1);
    return own?.label ?? typeLabel(key);
  }

  /* ---------------------------------------------------------------- */
  /* Internals                                                         */
  /* ---------------------------------------------------------------- */

  private selection() {
    return {
      id: documents.id,
      caseId: documents.caseId,
      clientId: documents.clientId,
      clientName: clients.fullName,
      caseReference: cases.reference,
      type: documents.type,
      typeKey: documents.typeKey,
      folderId: documents.folderId,
      expiresOn: documents.expiresOn,
      fileName: documents.fileName,
      fileSize: documents.fileSize,
      mimeType: documents.mimeType,
      fileKey: documents.fileKey,
      status: documents.status,
      uploadedAt: documents.uploadedAt,
      uploadedById: documents.uploadedBy,
      uploadedByName: users.fullName,
      uploadedByRole: users.role,
      reviewerComment: documents.reviewerComment,
      reviewedAt: documents.reviewedAt,
      reviewedBy: documents.reviewedBy,
      supersededBy: documents.supersededBy,
    };
  }

  /** All comments for a set of documents, in one query, grouped by document. */
  async commentsFor(documentIds: string[]): Promise<Map<string, DocumentComment[]>> {
    const byDoc = new Map<string, DocumentComment[]>();
    if (documentIds.length === 0) return byDoc;
    const rows = await this.db
      .select({
        documentId: documentComments.documentId,
        id: documentComments.id,
        body: documentComments.body,
        authorId: documentComments.authorId,
        authorName: users.fullName,
        authorRole: users.role,
        createdAt: documentComments.createdAt,
      })
      .from(documentComments)
      .innerJoin(users, eq(users.id, documentComments.authorId))
      .where(inArray(documentComments.documentId, documentIds))
      .orderBy(asc(documentComments.createdAt));
    for (const r of rows) {
      const list = byDoc.get(r.documentId) ?? [];
      list.push({ id: r.id, body: r.body, authorId: r.authorId, authorName: r.authorName, authorRole: r.authorRole, createdAt: iso(r.createdAt) });
      byDoc.set(r.documentId, list);
    }
    return byDoc;
  }

  /** Names for a set of user ids, in one query. */
  async userNamesFor(userIds: string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    if (userIds.length === 0) return names;
    const rows = await this.db.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, userIds));
    for (const r of rows) names.set(r.id, r.name);
    return names;
  }

  /** The consultant who should hear about a student's upload: the application's, else the student's. */
  private async consultantUserFor(clientId: string, caseId: string | null): Promise<string | null> {
    const caseConsultant = alias(consultants, 'case_consultant');
    const [row] = await this.db
      .select({ caseUser: caseConsultant.userId, clientUser: consultants.userId })
      .from(clients)
      .leftJoin(consultants, eq(consultants.id, clients.assignedConsultantId))
      .leftJoin(cases, caseId ? and(eq(cases.id, caseId), eq(cases.clientId, clients.id)) : sql`false`)
      .leftJoin(caseConsultant, eq(caseConsultant.id, cases.consultantId))
      .where(eq(clients.id, clientId))
      .limit(1);
    return row?.caseUser ?? row?.clientUser ?? null;
  }

  private async notifyStudent(
    clientId: string,
    caseId: string | null,
    n: { type: 'document_verified' | 'document_rejected' | 'document_commented' | 'document_status'; title: string; body: string },
  ): Promise<void> {
    const [row] = await this.db.select({ userId: clients.userId }).from(clients).where(eq(clients.id, clientId)).limit(1);
    if (!row?.userId) return;
    await this.notifications.push({
      userId: row.userId,
      type: n.type,
      title: n.title,
      body: n.body,
      link: '/portal/documents',
      caseId,
      email: true,
    });
  }
}

/**
 * Removal rules in one place:
 * - a manager may remove anything;
 * - anyone else only their own upload, and only before it is approved.
 */
export function canTrash(actor: AuthUser, doc: { uploadedBy: string; status: string }): boolean {
  if (actor.role === 'manager') return true;
  if (doc.uploadedBy !== actor.id) return false;
  return doc.status !== 'verified';
}

/**
 * The wire shape from a fetched row plus its comments, reviewer name and
 * signed URL. Single-document and list paths both funnel through this.
 */
function assembleView(
  actor: AuthUser,
  row: DocumentRow,
  comments: DocumentComment[],
  reviewerName: string | null,
  signed: string | null,
): DocumentView {
  return {
    id: row.id,
    caseId: row.caseId,
    clientId: row.clientId,
    clientName: row.clientName,
    caseReference: row.caseReference,
    type: row.type,
    typeKey: row.typeKey,
    folderId: row.folderId,
    expiresOn: row.expiresOn,
    fileName: row.fileName,
    fileSize: row.fileSize,
    mimeType: row.mimeType,
    status: row.status as DocumentStatus,
    uploadedAt: iso(row.uploadedAt),
    uploadedById: row.uploadedById,
    uploadedByName: row.uploadedByName,
    uploadedByRole: row.uploadedByRole,
    reviewerComment: row.reviewerComment,
    reviewedAt: isoOrNull(row.reviewedAt),
    reviewedByName: reviewerName,
    supersededById: row.supersededBy,
    downloadUrl: signed ?? `/api/documents/${row.id}/file`,
    canDelete: canTrash(actor, { uploadedBy: row.uploadedById, status: row.status }),
    comments,
  };
}

/** Shape returned by DocumentsService.selection(). */
interface DocumentRow {
  id: string;
  caseId: string | null;
  clientId: string | null;
  clientName: string | null;
  caseReference: string | null;
  type: string;
  typeKey: string;
  folderId: string | null;
  expiresOn: string | null;
  fileName: string;
  fileSize: number;
  mimeType: string;
  fileKey: string;
  status: string;
  uploadedAt: Date | string;
  uploadedById: string;
  uploadedByName: string;
  uploadedByRole: string;
  reviewerComment: string | null;
  reviewedAt: Date | string | null;
  reviewedBy: string | null;
  supersededBy: string | null;
}

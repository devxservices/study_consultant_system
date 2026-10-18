import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import {
  SYSTEM_FOLDERS,
  type AuthUser,
  type CreateFolderInput,
  type DriveFolderView,
  type UpdateFolderInput,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { cases, clients, docFolders, documents, driveStars, folderTemplates } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { iso } from '../common/db-helpers';
import { folderScope, qualified } from './drive-sql';

/** The outer folder row, named in full inside correlated subqueries (see drive-sql). */
const FOLDER_ID = qualified('doc_folders', 'id');
const FOLDER_PARENT = qualified('doc_folders', 'parent_id');
const FOLDER_TRASHED = qualified('doc_folders', 'trashed_at');

type FolderRow = typeof docFolders.$inferSelect;

/**
 * The drive's folders: building a student's from the right template, filing
 * a document into the folder its type belongs in, and creating, renaming,
 * moving, colouring, restricting and trashing them.
 */
@Injectable()
export class FoldersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /* ---------------------------------------------------------------- */
  /* A student's structure                                             */
  /* ---------------------------------------------------------------- */

  /**
   * Makes sure a student has their folders, from the template for the country
   * they are applying to (or the consultancy's default), and files any of
   * their documents that are not in a folder yet. Cheap when there is nothing
   * to do: one indexed count.
   */
  async ensureStudentStructure(tenantId: string, clientId: string): Promise<void> {
    const [has] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(docFolders)
      .where(and(eq(docFolders.clientId, clientId), isNotNull(docFolders.systemKey), isNull(docFolders.trashedAt)));
    if ((has?.n ?? 0) === 0) {
      const folders = await this.templateFor(tenantId, clientId);
      await this.db
        .insert(docFolders)
        .values(folders.map((f) => ({ tenantId, clientId, name: f.name, systemKey: f.key, ancestry: '/' })))
        .onConflictDoNothing();
    }
    await this.fileUnfiled(tenantId, clientId);
  }

  /** The folder an upload of this type belongs in, for this student. */
  async folderForType(tenantId: string, clientId: string, typeKey: string): Promise<string | null> {
    await this.ensureStudentStructure(tenantId, clientId);
    const [row] = await this.db
      .select({ id: docFolders.id })
      .from(docFolders)
      .where(
        and(
          eq(docFolders.clientId, clientId),
          isNull(docFolders.trashedAt),
          sql`${docFolders.systemKey} = coalesce((
            select t.folder_key from document_types t where t.tenant_id = ${tenantId}::uuid and t.key = ${typeKey}
          ), 'other')`,
        ),
      )
      .limit(1);
    if (row) return row.id;
    const [other] = await this.db
      .select({ id: docFolders.id })
      .from(docFolders)
      .where(and(eq(docFolders.clientId, clientId), eq(docFolders.systemKey, 'other'), isNull(docFolders.trashedAt)))
      .limit(1);
    return other?.id ?? null;
  }

  private async templateFor(tenantId: string, clientId: string): Promise<{ key: string; name: string }[]> {
    const countries = await this.db
      .select({ country: cases.targetCountry })
      .from(cases)
      .where(and(eq(cases.clientId, clientId), eq(cases.tenantId, tenantId)))
      .orderBy(asc(cases.createdAt));
    const templates = await this.db.select().from(folderTemplates).where(eq(folderTemplates.tenantId, tenantId));
    const byCountry = templates.find((t) =>
      countries.some((c) => t.country && t.country.toLowerCase() === c.country.toLowerCase()),
    );
    const chosen = byCountry ?? templates.find((t) => t.isDefault) ?? templates[0];
    const folders = chosen?.folders?.length ? chosen.folders : SYSTEM_FOLDERS.map((f) => ({ key: f.key, name: f.name }));
    // Uploads are filed by key, so "other" is always there to catch the rest.
    return folders.some((f) => f.key === 'other') ? folders : [...folders, { key: 'other', name: 'Other' }];
  }

  /** Documents uploaded before the student had folders go where their type belongs. */
  private async fileUnfiled(tenantId: string, clientId: string): Promise<void> {
    await this.db.execute(sql`
      update documents d set folder_id = coalesce(
        (select f.id from doc_folders f
          where f.client_id = d.client_id and f.trashed_at is null
            and f.system_key = coalesce((select t.folder_key from document_types t
              where t.tenant_id = d.tenant_id and t.key = d.type_key), 'other')
          limit 1),
        (select f.id from doc_folders f
          where f.client_id = d.client_id and f.trashed_at is null and f.system_key = 'other' limit 1))
      where d.client_id = ${clientId}::uuid and d.tenant_id = ${tenantId}::uuid
        and d.folder_id is null and d.deleted_at is null
    `);
  }

  /* ---------------------------------------------------------------- */
  /* Reading                                                           */
  /* ---------------------------------------------------------------- */

  /** A folder this person may see, or 404. */
  async find(actor: AuthUser, id: string, opts: { includeTrashed?: boolean } = {}): Promise<FolderRow> {
    const [row] = await this.db
      .select()
      .from(docFolders)
      .where(and(eq(docFolders.id, id), folderScope(actor), opts.includeTrashed ? undefined : isNull(docFolders.trashedAt)))
      .limit(1);
    if (!row) throw new NotFoundException('Folder not found.');
    return row;
  }

  /** Child folders of a parent (or the roots of a student / the agency area), with counts. */
  async children(
    actor: AuthUser,
    where: { parentId: string | null; clientId?: string | null; agency?: boolean; trashed?: boolean },
  ): Promise<DriveFolderView[]> {
    const rows = await this.db
      .select({
        folder: docFolders,
        documentCount: sql<number>`(select count(*)::int from documents d
          where d.folder_id = ${FOLDER_ID} and d.deleted_at is null and d.trashed_at is null and d.superseded_by is null)`,
        folderCount: sql<number>`(select count(*)::int from doc_folders c
          where c.parent_id = ${FOLDER_ID} and c.trashed_at is null)`,
        starred: sql<boolean>`exists (select 1 from drive_stars s
          where s.user_id = ${actor.id}::uuid and s.item_type = 'folder' and s.item_id = ${FOLDER_ID})`,
      })
      .from(docFolders)
      .where(
        and(
          folderScope(actor),
          where.parentId ? eq(docFolders.parentId, where.parentId) : isNull(docFolders.parentId),
          where.clientId !== undefined && where.clientId !== null ? eq(docFolders.clientId, where.clientId) : undefined,
          where.agency ? isNull(docFolders.clientId) : undefined,
          where.trashed ? isNotNull(docFolders.trashedAt) : isNull(docFolders.trashedAt),
        ),
      )
      .orderBy(sql`${docFolders.systemKey} is null`, asc(sql`lower(${docFolders.name})`));
    return rows.map((r) => toFolderView(r.folder, r));
  }

  /** One folder with its counts and whether this person starred it. */
  async view(actor: AuthUser, id: string): Promise<DriveFolderView> {
    const folder = await this.find(actor, id, { includeTrashed: true });
    const [counts] = await this.db
      .select({
        documentCount: sql<number>`(select count(*)::int from documents d
          where d.folder_id = ${folder.id}::uuid and d.deleted_at is null and d.trashed_at is null and d.superseded_by is null)`,
        folderCount: sql<number>`(select count(*)::int from doc_folders c where c.parent_id = ${folder.id}::uuid and c.trashed_at is null)`,
        starred: sql<boolean>`exists (select 1 from drive_stars s
          where s.user_id = ${actor.id}::uuid and s.item_type = 'folder' and s.item_id = ${folder.id}::uuid)`,
      })
      .from(sql`(select 1) as one`);
    return toFolderView(folder, counts ?? { documentCount: 0, folderCount: 0, starred: false });
  }

  async trashedFolders(actor: AuthUser): Promise<DriveFolderView[]> {
    const rows = await this.db
      .select({ folder: docFolders })
      .from(docFolders)
      .where(
        and(
          folderScope(actor),
          isNotNull(docFolders.trashedAt),
          // Only the top of each trashed tree: its children come back with it.
          sql`not exists (select 1 from doc_folders p where p.id = ${FOLDER_PARENT} and p.trashed_at = ${FOLDER_TRASHED})`,
        ),
      )
      .orderBy(sql`${docFolders.trashedAt} desc`);
    return rows.map((r) => toFolderView(r.folder, { documentCount: 0, folderCount: 0, starred: false }));
  }

  async starredFolders(actor: AuthUser): Promise<DriveFolderView[]> {
    const rows = await this.db
      .select({ folder: docFolders })
      .from(docFolders)
      .innerJoin(driveStars, and(eq(driveStars.itemId, docFolders.id), eq(driveStars.userId, actor.id), eq(driveStars.itemType, 'folder')))
      .where(and(folderScope(actor), isNull(docFolders.trashedAt)));
    return rows.map((r) => toFolderView(r.folder, { documentCount: 0, folderCount: 0, starred: true }));
  }

  /** The folders above this one, top first. */
  async ancestors(folder: FolderRow): Promise<FolderRow[]> {
    const ids = folder.ancestry.split('/').filter(Boolean);
    if (ids.length === 0) return [];
    const rows = await this.db.select().from(docFolders).where(inArray(docFolders.id, ids));
    return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is FolderRow => Boolean(r));
  }

  /* ---------------------------------------------------------------- */
  /* Changing                                                          */
  /* ---------------------------------------------------------------- */

  async create(actor: AuthUser, input: CreateFolderInput): Promise<DriveFolderView> {
    const tenantId = tenantOf(actor);
    let clientId: string | null = input.clientId ?? null;
    let ancestry = '/';
    if (input.parentId) {
      const parent = await this.find(actor, input.parentId);
      clientId = parent.clientId;
      ancestry = `${parent.ancestry}${parent.id}/`;
    } else if (clientId) {
      const [client] = await this.db
        .select({ id: clients.id })
        .from(clients)
        .where(and(eq(clients.id, clientId), eq(clients.tenantId, tenantId)))
        .limit(1);
      if (!client) throw new NotFoundException('Student not found.');
    }
    // Restricting is a manager's call: it hides the folder from other staff.
    const restricted = actor.role === 'manager' ? Boolean(input.restricted) : false;
    const [row] = await this.db
      .insert(docFolders)
      .values({
        tenantId,
        clientId,
        parentId: input.parentId ?? null,
        name: input.name,
        color: input.color ?? null,
        restricted,
        sharedWithPartners: clientId ? false : Boolean(input.sharedWithPartners),
        ancestry,
        createdBy: actor.id,
      })
      .returning();
    await this.audit.record(actor, {
      action: 'folder.created',
      entityType: 'folder',
      entityId: row!.id,
      clientId,
      metadata: { name: input.name, parentId: input.parentId ?? null, restricted },
    });
    return toFolderView(row!, { documentCount: 0, folderCount: 0, starred: false });
  }

  async update(actor: AuthUser, id: string, input: UpdateFolderInput): Promise<DriveFolderView> {
    const folder = await this.find(actor, id);
    const changes: Partial<typeof docFolders.$inferInsert> = { updatedAt: new Date() };
    if (input.name !== undefined) changes.name = input.name;
    if (input.color !== undefined) changes.color = input.color;
    if (input.restricted !== undefined) {
      if (actor.role !== 'manager') throw new BadRequestException('Only a manager can restrict a folder.');
      changes.restricted = input.restricted;
    }
    if (input.sharedWithPartners !== undefined) {
      if (folder.clientId) throw new BadRequestException('A student’s folders are never shared with partners this way.');
      changes.sharedWithPartners = input.sharedWithPartners;
    }

    let moved = false;
    if (input.parentId !== undefined && input.parentId !== folder.parentId) {
      let ancestry = '/';
      if (input.parentId) {
        const parent = await this.find(actor, input.parentId);
        if (parent.id === folder.id || parent.ancestry.includes(`/${folder.id}/`)) {
          throw new BadRequestException('A folder cannot go inside itself.');
        }
        if (parent.clientId !== folder.clientId) {
          throw new BadRequestException('Folders stay with their student. Copy documents across instead.');
        }
        ancestry = `${parent.ancestry}${parent.id}/`;
      }
      changes.parentId = input.parentId;
      changes.ancestry = ancestry;
      moved = true;
      // Everything beneath keeps its path relative to this folder.
      const oldPrefix = `${folder.ancestry}${folder.id}/`;
      const newPrefix = `${ancestry}${folder.id}/`;
      await this.db
        .update(docFolders)
        .set({ ancestry: sql`${newPrefix} || substr(${docFolders.ancestry}, ${oldPrefix.length + 1})` })
        .where(and(eq(docFolders.tenantId, folder.tenantId), sql`${docFolders.ancestry} like ${oldPrefix + '%'}`));
    }

    const [row] = await this.db.update(docFolders).set(changes).where(eq(docFolders.id, id)).returning();
    await this.audit.record(actor, {
      action: 'folder.updated',
      entityType: 'folder',
      entityId: id,
      clientId: folder.clientId,
      metadata: {
        name: input.name ?? folder.name,
        ...(input.name && input.name !== folder.name ? { renamedFrom: folder.name } : {}),
        ...(moved ? { movedTo: input.parentId ?? 'top' } : {}),
        ...(input.restricted !== undefined ? { restricted: input.restricted } : {}),
      },
    });
    return toFolderView(row!, { documentCount: 0, folderCount: 0, starred: false });
  }

  /**
   * Trashes a folder with everything in it: sub-folders and their documents
   * get the same timestamp, so restoring brings exactly that set back. A
   * student's built-in folders stay - uploads are filed into them.
   */
  async trash(actor: AuthUser, id: string): Promise<void> {
    const folder = await this.find(actor, id);
    if (folder.systemKey && folder.clientId) {
      throw new BadRequestException('Built-in folders stay, so uploads always have somewhere to go. Rename it instead.');
    }
    const now = new Date();
    const prefix = `${folder.ancestry}${folder.id}/`;
    const inTree = and(
      eq(docFolders.tenantId, folder.tenantId),
      isNull(docFolders.trashedAt),
      sql`(${docFolders.id} = ${folder.id}::uuid or ${docFolders.ancestry} like ${prefix + '%'})`,
    );
    if (actor.role !== 'manager') {
      // A folder takes its documents with it, so the same rule as removing
      // them one by one: only your own uploads, and never an approved one.
      const [blocking] = await this.db
        .select({ id: documents.id })
        .from(documents)
        .where(
          and(
            inArray(documents.folderId, this.db.select({ id: docFolders.id }).from(docFolders).where(inTree)),
            isNull(documents.trashedAt),
            isNull(documents.deletedAt),
            sql`(${documents.uploadedBy} <> ${actor.id}::uuid or ${documents.status} = 'verified')`,
          ),
        )
        .limit(1);
      if (blocking) {
        throw new ForbiddenException('This folder holds approved documents or files someone else uploaded. Ask a manager to remove it, or move those files out first.');
      }
    }
    const tree = await this.db
      .update(docFolders)
      .set({ trashedAt: now, trashedBy: actor.id })
      .where(inTree)
      .returning({ id: docFolders.id });
    await this.db
      .update(documents)
      .set({ trashedAt: now, trashedBy: actor.id })
      .where(and(inArray(documents.folderId, tree.map((t) => t.id)), isNull(documents.trashedAt), isNull(documents.deletedAt)));
    await this.audit.record(actor, {
      action: 'folder.trashed',
      entityType: 'folder',
      entityId: id,
      clientId: folder.clientId,
      metadata: { name: folder.name, folders: tree.length },
    });
  }

  async restore(actor: AuthUser, id: string): Promise<void> {
    const folder = await this.find(actor, id, { includeTrashed: true });
    if (!folder.trashedAt) return;
    const when = folder.trashedAt;
    const prefix = `${folder.ancestry}${folder.id}/`;
    const tree = await this.db
      .update(docFolders)
      .set({ trashedAt: null, trashedBy: null })
      .where(
        and(
          eq(docFolders.tenantId, folder.tenantId),
          eq(docFolders.trashedAt, when),
          sql`(${docFolders.id} = ${folder.id}::uuid or ${docFolders.ancestry} like ${prefix + '%'})`,
        ),
      )
      .returning({ id: docFolders.id });
    await this.db
      .update(documents)
      .set({ trashedAt: null, trashedBy: null })
      .where(and(inArray(documents.folderId, tree.map((t) => t.id)), eq(documents.trashedAt, when), isNull(documents.deletedAt)));
    // A parent that was trashed separately would leave it unreachable: bring it to the top.
    if (folder.parentId) {
      const [parent] = await this.db.select({ trashedAt: docFolders.trashedAt }).from(docFolders).where(eq(docFolders.id, folder.parentId));
      if (parent?.trashedAt) {
        await this.db.update(docFolders).set({ parentId: null, ancestry: '/' }).where(eq(docFolders.id, folder.id));
      }
    }
    await this.audit.record(actor, {
      action: 'folder.restored',
      entityType: 'folder',
      entityId: id,
      clientId: folder.clientId,
      metadata: { name: folder.name },
    });
  }
}

export function toFolderView(
  f: FolderRow,
  extra: { documentCount: number; folderCount: number; starred: boolean },
): DriveFolderView {
  return {
    id: f.id,
    name: f.name,
    parentId: f.parentId,
    clientId: f.clientId,
    partnerId: (f as FolderRow & { partnerId?: string | null }).partnerId ?? null,
    systemKey: f.systemKey,
    color: f.color,
    restricted: f.restricted,
    sharedWithPartners: f.sharedWithPartners,
    starred: Boolean(extra.starred),
    documentCount: Number(extra.documentCount ?? 0),
    folderCount: Number(extra.folderCount ?? 0),
    trashedAt: f.trashedAt ? iso(f.trashedAt) : null,
    updatedAt: iso(f.updatedAt),
  };
}

import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { compare, hash } from 'bcryptjs';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  hasPermission,
  typeLabel,
  type AuthUser,
  type CreateShareInput,
  type PublicShareView,
  type ShareAccessView,
  type ShareCreated,
  type ShareLinkView,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { docFolders, documentTypes, documents, shareAccessLog, shareLinks, tenants, users } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { DocumentsService } from '../documents/documents.service';
import { FoldersService } from '../documents/folders.service';
import { STORAGE, type StorageDriver } from '../storage/storage.driver';
import { env } from '../config/env';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { iso, isoOrNull } from '../common/db-helpers';

type LinkRow = typeof shareLinks.$inferSelect;
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const ACCESS_MINUTES = 60;

/** Where a public request came from, for the access log. */
export interface Visitor {
  ip: string | null;
  userAgent: string | null;
  /** The consultancy whose address the link was opened on, if any. */
  tenantId: string | null;
}

/**
 * Secure links for people outside: a university's admissions office, a
 * partner. Only the token's hash is stored; links expire, can need a
 * password (five wrong tries lock them for a quarter of an hour), can be
 * view-only, are revocable, and every open, download and refused password is
 * logged - visible to the consultancy on the link.
 */
@Injectable()
export class ShareService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: StorageDriver,
    private readonly audit: AuditService,
    private readonly documents: DocumentsService,
    private readonly folders: FoldersService,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Staff                                                             */
  /* ---------------------------------------------------------------- */

  async create(actor: AuthUser, input: CreateShareInput): Promise<ShareCreated> {
    if (!hasPermission(actor, 'document.share')) {
      throw new ForbiddenException({ message: 'You do not have permission to share documents outside.', code: 'PERMISSION_DENIED', permission: 'document.share' });
    }
    let clientId: string | null = null;
    let targetName: string;
    if (input.documentId) {
      const doc = await this.documents.findAccessible(actor, input.documentId);
      clientId = doc.clientId;
      targetName = doc.fileName;
    } else {
      const folder = await this.folders.find(actor, input.folderId!);
      clientId = folder.clientId;
      targetName = folder.name;
    }
    const token = randomBytes(24).toString('base64url');
    const [row] = await this.db
      .insert(shareLinks)
      .values({
        tenantId: tenantOf(actor),
        tokenHash: hashToken(token),
        documentId: input.documentId ?? null,
        folderId: input.folderId ?? null,
        label: input.label,
        passwordHash: input.password ? await hash(input.password, 10) : null,
        expiresAt: new Date(Date.now() + input.expiresInDays * 86_400_000),
        viewOnly: input.viewOnly,
        createdBy: actor.id,
      })
      .returning();
    await this.audit.record(actor, {
      action: 'share.created',
      entityType: 'share',
      entityId: row!.id,
      clientId,
      metadata: {
        label: input.label,
        target: targetName,
        expiresInDays: input.expiresInDays,
        password: Boolean(input.password),
        viewOnly: input.viewOnly,
      },
    });
    const [view] = await this.list(actor, { id: row!.id });
    return { ...view!, token };
  }

  async list(actor: AuthUser, filter: { id?: string; documentId?: string; folderId?: string }): Promise<ShareLinkView[]> {
    const creator = users;
    const rows = await this.db
      .select({
        link: shareLinks,
        createdByName: creator.fullName,
        targetName: sql<string>`coalesce(
          (select d.file_name from documents d where d.id = ${shareLinks.documentId}),
          (select f.name from doc_folders f where f.id = ${shareLinks.folderId}), '')`,
        clientName: sql<string | null>`(select c.full_name from clients c where c.id = coalesce(
          (select d.client_id from documents d where d.id = ${shareLinks.documentId}),
          (select f.client_id from doc_folders f where f.id = ${shareLinks.folderId})))`,
      })
      .from(shareLinks)
      .leftJoin(creator, eq(creator.id, shareLinks.createdBy))
      .where(
        and(
          eq(shareLinks.tenantId, tenantOf(actor)),
          filter.id ? eq(shareLinks.id, filter.id) : undefined,
          filter.documentId ? eq(shareLinks.documentId, filter.documentId) : undefined,
          filter.folderId ? eq(shareLinks.folderId, filter.folderId) : undefined,
          // Staff without the sharing permission see only links they made.
          hasPermission(actor, 'document.share') ? undefined : eq(shareLinks.createdBy, actor.id),
        ),
      )
      .orderBy(desc(shareLinks.createdAt))
      .limit(200);
    return rows.map((r) => toView(r.link, r.targetName, r.clientName, r.createdByName));
  }

  async revoke(actor: AuthUser, id: string): Promise<void> {
    const [row] = await this.db
      .update(shareLinks)
      .set({ revokedAt: new Date(), revokedBy: actor.id })
      .where(and(eq(shareLinks.id, id), eq(shareLinks.tenantId, tenantOf(actor)), isNull(shareLinks.revokedAt)))
      .returning();
    if (!row) throw new NotFoundException('Share link not found, or already revoked.');
    await this.audit.record(actor, { action: 'share.revoked', entityType: 'share', entityId: id, metadata: { label: row.label } });
  }

  async accessLog(actor: AuthUser, id: string): Promise<ShareAccessView[]> {
    const [link] = await this.db
      .select({ id: shareLinks.id })
      .from(shareLinks)
      .where(and(eq(shareLinks.id, id), eq(shareLinks.tenantId, tenantOf(actor))))
      .limit(1);
    if (!link) throw new NotFoundException('Share link not found.');
    const rows = await this.db
      .select({
        at: shareAccessLog.at,
        action: shareAccessLog.action,
        documentName: documents.fileName,
        ipAddress: shareAccessLog.ipAddress,
        userAgent: shareAccessLog.userAgent,
      })
      .from(shareAccessLog)
      .leftJoin(documents, eq(documents.id, shareAccessLog.documentId))
      .where(eq(shareAccessLog.shareLinkId, id))
      .orderBy(desc(shareAccessLog.at))
      .limit(500);
    return rows.map((r) => ({ ...r, at: iso(r.at), action: r.action as ShareAccessView['action'] }));
  }

  /* ---------------------------------------------------------------- */
  /* The public side                                                   */
  /* ---------------------------------------------------------------- */

  async publicView(token: string, access: string | undefined, visitor: Visitor): Promise<PublicShareView> {
    const link = await this.resolve(token, visitor);
    const [tenant] = await this.db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, link.tenantId));
    const unlocked = !link.passwordHash || this.verifyAccess(link, access);
    let name = '';
    if (link.documentId) {
      const [d] = await this.db.select({ name: documents.fileName }).from(documents).where(eq(documents.id, link.documentId));
      name = d?.name ?? '';
    } else {
      const [f] = await this.db.select({ name: docFolders.name }).from(docFolders).where(eq(docFolders.id, link.folderId!));
      name = f?.name ?? '';
    }
    return {
      consultancy: tenant?.name ?? '',
      label: link.label,
      kind: link.documentId ? 'document' : 'folder',
      name,
      expiresAt: iso(link.expiresAt),
      viewOnly: link.viewOnly,
      needsPassword: !unlocked,
      items: unlocked ? await this.items(link) : null,
    };
  }

  /** A correct password returns an access token good for an hour; wrong ones lock the link. */
  async unlock(token: string, password: string, visitor: Visitor): Promise<{ access: string; expiresAt: string }> {
    const link = await this.resolve(token, visitor);
    if (!link.passwordHash) throw new BadRequestException('This link has no password.');
    if (link.lockedUntil && link.lockedUntil > new Date()) {
      throw new HttpException(
        { message: `Too many wrong passwords. Try again after ${link.lockedUntil.toISOString().slice(11, 16)} UTC.` },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (!(await compare(password, link.passwordHash))) {
      const attempts = link.failedAttempts + 1;
      await this.db
        .update(shareLinks)
        .set({
          failedAttempts: attempts >= MAX_ATTEMPTS ? 0 : attempts,
          lockedUntil: attempts >= MAX_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : link.lockedUntil,
        })
        .where(eq(shareLinks.id, link.id));
      await this.log(link, 'denied_password', null, visitor);
      throw new UnauthorizedException('That password is not right.');
    }
    await this.db.update(shareLinks).set({ failedAttempts: 0, lockedUntil: null }).where(eq(shareLinks.id, link.id));
    const exp = Math.min(Date.now() + ACCESS_MINUTES * 60_000, link.expiresAt.getTime());
    return { access: this.sign(link.id, exp), expiresAt: new Date(exp).toISOString() };
  }

  async file(
    token: string,
    documentId: string,
    access: string | undefined,
    download: boolean,
    visitor: Visitor,
  ): Promise<{ stream: Readable; mimeType: string; fileName: string; disposition: 'inline' | 'attachment' }> {
    const link = await this.resolve(token, visitor);
    if (link.passwordHash && !this.verifyAccess(link, access)) throw new UnauthorizedException('Enter the password first.');
    const allowed = await this.items(link);
    const item = allowed.find((i) => i.id === documentId);
    if (!item) throw new NotFoundException('That document is not part of this link.');
    const [doc] = await this.db.select().from(documents).where(eq(documents.id, documentId));
    const stream = await this.storage.get(doc!.fileKey);
    const asAttachment = download && !link.viewOnly;
    await this.db
      .update(shareLinks)
      .set({ views: sql`${shareLinks.views} + 1`, lastAccessAt: new Date() })
      .where(eq(shareLinks.id, link.id));
    await this.log(link, asAttachment ? 'download' : 'view', documentId, visitor);
    await this.audit.record(null, {
      action: 'share.accessed',
      entityType: 'share',
      entityId: link.id,
      tenantId: link.tenantId,
      clientId: doc!.clientId,
      metadata: { label: link.label, fileName: doc!.fileName, how: asAttachment ? 'download' : 'view' },
    });
    const name = asAttachment ? await this.documents.downloadName(doc!) : doc!.fileName;
    return { stream, mimeType: doc!.mimeType, fileName: name, disposition: asAttachment ? 'attachment' : 'inline' };
  }

  /** The documents a link opens: one, or a folder's (and its sub-folders') current, live documents. */
  private async items(link: LinkRow): Promise<NonNullable<PublicShareView['items']>> {
    const live = and(isNull(documents.deletedAt), isNull(documents.trashedAt), isNull(documents.supersededBy));
    let rows: { id: string; fileName: string; mimeType: string; fileSize: number; typeKey: string; label: string | null }[];
    const select = {
      id: documents.id,
      fileName: documents.fileName,
      mimeType: documents.mimeType,
      fileSize: documents.fileSize,
      typeKey: documents.typeKey,
      label: documentTypes.label,
    };
    const typeJoin = and(eq(documentTypes.tenantId, documents.tenantId), eq(documentTypes.key, documents.typeKey));
    if (link.documentId) {
      rows = await this.db.select(select).from(documents).leftJoin(documentTypes, typeJoin).where(and(eq(documents.id, link.documentId), live));
    } else {
      const [folder] = await this.db.select().from(docFolders).where(and(eq(docFolders.id, link.folderId!), isNull(docFolders.trashedAt)));
      if (!folder) return [];
      const tree = await this.db
        .select({ id: docFolders.id })
        .from(docFolders)
        .where(
          and(
            isNull(docFolders.trashedAt),
            sql`(${docFolders.id} = ${folder.id}::uuid or ${docFolders.ancestry} like ${`${folder.ancestry}${folder.id}/%`})`,
          ),
        );
      rows = await this.db
        .select(select)
        .from(documents)
        .leftJoin(documentTypes, typeJoin)
        .where(and(inArray(documents.folderId, tree.map((t) => t.id)), live))
        .orderBy(documents.fileName);
    }
    return rows.map((r) => ({ id: r.id, fileName: r.fileName, mimeType: r.mimeType, fileSize: r.fileSize, typeLabel: r.label ?? typeLabel(r.typeKey) }));
  }

  /** The live link for a token - or a log line and a refusal. */
  private async resolve(token: string, visitor: Visitor): Promise<LinkRow> {
    const [link] = await this.db.select().from(shareLinks).where(eq(shareLinks.tokenHash, hashToken(token))).limit(1);
    // A link is only good on its own consultancy's address.
    if (!link || (visitor.tenantId && visitor.tenantId !== link.tenantId)) {
      throw new NotFoundException('This link does not exist.');
    }
    if (link.revokedAt) {
      await this.log(link, 'revoked', null, visitor);
      throw new GoneException('This link has been switched off by the consultancy.');
    }
    if (link.expiresAt <= new Date()) {
      await this.log(link, 'expired', null, visitor);
      throw new GoneException('This link has expired. Ask the consultancy for a new one.');
    }
    return link;
  }

  private async log(link: LinkRow, action: string, documentId: string | null, visitor: Visitor): Promise<void> {
    await this.db.insert(shareAccessLog).values({
      tenantId: link.tenantId,
      shareLinkId: link.id,
      documentId,
      action,
      ipAddress: visitor.ip,
      userAgent: visitor.userAgent?.slice(0, 300) ?? null,
    });
  }

  private sign(linkId: string, exp: number): string {
    const body = `${linkId}.${exp}`;
    return `${exp}.${createHmac('sha256', accessKey()).update(body).digest('base64url')}`;
  }

  private verifyAccess(link: LinkRow, access: string | undefined): boolean {
    if (!access) return false;
    const [expRaw, mac] = access.split('.');
    const exp = Number(expRaw);
    if (!mac || !Number.isFinite(exp) || exp < Date.now()) return false;
    const expected = createHmac('sha256', accessKey()).update(`${link.id}.${exp}`).digest();
    const given = Buffer.from(mac, 'base64url');
    return given.length === expected.length && timingSafeEqual(given, expected);
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function accessKey(): Buffer {
  return createHash('sha256').update(`share-access:${env().JWT_SECRET}`).digest();
}

function toView(link: LinkRow, targetName: string, clientName: string | null, createdByName: string | null): ShareLinkView {
  const active = !link.revokedAt && link.expiresAt > new Date();
  return {
    id: link.id,
    label: link.label,
    documentId: link.documentId,
    folderId: link.folderId,
    targetName,
    clientName,
    expiresAt: iso(link.expiresAt),
    viewOnly: link.viewOnly,
    hasPassword: Boolean(link.passwordHash),
    views: link.views,
    lastAccessAt: isoOrNull(link.lastAccessAt),
    revokedAt: isoOrNull(link.revokedAt),
    createdByName,
    createdAt: iso(link.createdAt),
    active,
  };
}


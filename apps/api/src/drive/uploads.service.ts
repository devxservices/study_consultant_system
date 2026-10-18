import { BadRequestException, Inject, Injectable, Logger, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { and, eq, lt } from 'drizzle-orm';
import archiver from 'archiver';
import { PassThrough, type Readable } from 'node:stream';
import type { AuthUser, StartUploadInput, UploadSessionView } from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { uploadSessions } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { DocumentsService, type DocRow } from '../documents/documents.service';
import { DriveSettingsService } from '../documents/drive-settings.service';
import { CasesService } from '../cases/cases.service';
import { FoldersService } from '../documents/folders.service';
import { STORAGE, type StorageDriver } from '../storage/storage.driver';
import { tenantOf } from '../tenancy/tenant-resolver.service';

/** Chunks are small enough to survive a weak mobile connection, large enough to be few. */
export const CHUNK_BYTES = 2 * 1024 * 1024;
const SESSION_HOURS = 24;
const ZIP_MAX_FILES = 200;
const ZIP_MAX_BYTES = 500 * 1024 * 1024;

/**
 * Resumable uploads and bulk downloads.
 *
 * A large file goes up in chunks; each chunk is stored as it arrives (through
 * the storage driver, so any API instance can take the next one), and a
 * dropped connection resumes from what the server already has. Completing
 * the upload runs exactly the checks a normal upload does.
 */
@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: StorageDriver,
    private readonly audit: AuditService,
    private readonly documents: DocumentsService,
    private readonly settings: DriveSettingsService,
    private readonly cases: CasesService,
    private readonly folders: FoldersService,
  ) {}

  async start(actor: AuthUser, input: StartUploadInput): Promise<UploadSessionView> {
    const tenantId = tenantOf(actor);
    const rules = await this.settings.uploadRules(tenantId);
    if (input.size > rules.maxBytes) {
      throw new PayloadTooLargeException(`Files must be ${Math.round(rules.maxBytes / 1024 / 1024)} MB or smaller.`);
    }
    // Refuse early what completing would refuse anyway.
    if (input.caseId) await this.cases.findAccessible(actor, input.caseId);
    if (input.folderId) await this.folders.find(actor, input.folderId);
    if (input.replacesId) await this.documents.findAccessible(actor, input.replacesId);
    if (!input.caseId && !input.folderId && !input.clientId && actor.role !== 'client') {
      throw new BadRequestException('Choose a student or a folder for the file.');
    }
    const { fileName, size, ...fields } = input;
    const [row] = await this.db
      .insert(uploadSessions)
      .values({
        tenantId,
        userId: actor.id,
        fields: fields as Record<string, string | undefined>,
        fileName,
        size,
        expiresAt: new Date(Date.now() + SESSION_HOURS * 3_600_000),
      })
      .returning();
    return { id: row!.id, received: 0, size, chunkSize: CHUNK_BYTES };
  }

  async status(actor: AuthUser, id: string): Promise<UploadSessionView> {
    const s = await this.session(actor, id);
    return { id: s.id, received: s.received, size: s.size, chunkSize: CHUNK_BYTES };
  }

  /**
   * One chunk, at the offset the server expects. A chunk that was already
   * received (the reply was lost, the client resent it) is acknowledged and
   * ignored, so retrying is always safe.
   */
  async chunk(actor: AuthUser, id: string, offset: number, body: Buffer): Promise<UploadSessionView> {
    const s = await this.session(actor, id);
    if (body.length === 0) throw new BadRequestException('Empty chunk.');
    if (body.length > CHUNK_BYTES) throw new PayloadTooLargeException('Chunks are at most 2 MB.');
    if (offset + body.length <= s.received) return this.status(actor, id);
    if (offset !== s.received) {
      throw new BadRequestException({ message: `Expected the chunk at ${s.received}.`, received: s.received });
    }
    if (offset + body.length > s.size) throw new BadRequestException('More bytes than the file was said to have.');
    await this.storage.put(chunkKey(s.tenantId, s.id, offset), body, 'application/octet-stream');
    const [updated] = await this.db
      .update(uploadSessions)
      .set({ received: offset + body.length })
      .where(and(eq(uploadSessions.id, id), eq(uploadSessions.received, offset)))
      .returning();
    return { id, received: updated?.received ?? s.received, size: s.size, chunkSize: CHUNK_BYTES };
  }

  async complete(actor: AuthUser, id: string): Promise<DocRow> {
    const s = await this.session(actor, id);
    if (s.received !== s.size) {
      throw new BadRequestException({ message: `Only ${s.received} of ${s.size} bytes have arrived.`, received: s.received });
    }
    const parts: Buffer[] = [];
    for (let offset = 0; offset < s.size; ) {
      const part = await this.storage.read(chunkKey(s.tenantId, s.id, offset));
      parts.push(part);
      offset += part.length;
    }
    const file = await this.documents.accept(actor, { buffer: Buffer.concat(parts), originalname: s.fileName, size: s.size });
    const f = s.fields as Record<string, string | undefined>;
    const created = await this.documents.store(
      actor,
      {
        clientId: actor.role === 'client' ? actor.clientId : (f.clientId ?? null),
        caseId: f.caseId ?? null,
        folderId: f.folderId ?? null,
        typeKey: f.typeKey ?? null,
        replacesId: f.replacesId ?? null,
        expiresOn: f.expiresOn ?? null,
        issuedOn: f.issuedOn ?? null,
      },
      file,
    );
    await this.discard(s);
    return created;
  }

  /** Sweeps sessions nobody finished. */
  async cleanExpired(): Promise<number> {
    const stale = await this.db.select().from(uploadSessions).where(lt(uploadSessions.expiresAt, new Date()));
    for (const s of stale) await this.discard(s);
    return stale.length;
  }

  private async discard(s: typeof uploadSessions.$inferSelect): Promise<void> {
    for (let offset = 0; offset < s.received; offset += CHUNK_BYTES) {
      await this.storage.delete(chunkKey(s.tenantId, s.id, offset)).catch(() => undefined);
    }
    await this.db.delete(uploadSessions).where(eq(uploadSessions.id, s.id));
  }

  private async session(actor: AuthUser, id: string) {
    const [s] = await this.db
      .select()
      .from(uploadSessions)
      .where(and(eq(uploadSessions.id, id), eq(uploadSessions.userId, actor.id)))
      .limit(1);
    if (!s || s.expiresAt < new Date()) throw new NotFoundException('That upload has expired. Start it again.');
    return s;
  }

  /* ---------------------------------------------------------------- */
  /* Bulk download                                                     */
  /* ---------------------------------------------------------------- */

  /**
   * Many documents as one ZIP, each named by the consultancy's pattern
   * (Ali_Khan_Passport.pdf) with clashes numbered. Every document passes the
   * same access check as opening it one by one, and the download is audited.
   */
  async zip(actor: AuthUser, documentIds: string[], label: string): Promise<{ stream: Readable; fileName: string }> {
    const unique = [...new Set(documentIds)].slice(0, ZIP_MAX_FILES + 1);
    if (unique.length === 0) throw new BadRequestException('Choose some documents.');
    if (unique.length > ZIP_MAX_FILES) throw new BadRequestException(`At most ${ZIP_MAX_FILES} documents at a time.`);
    const docs: DocRow[] = [];
    for (const id of unique) docs.push(await this.documents.findAccessible(actor, id));
    const total = docs.reduce((n, d) => n + d.fileSize, 0);
    if (total > ZIP_MAX_BYTES) throw new BadRequestException('That is more than 500 MB. Download fewer at a time.');

    const archive = archiver('zip', { zlib: { level: 6 } });
    const out = new PassThrough();
    archive.on('error', (err) => {
      this.logger.error(`zip failed: ${err.message}`);
      out.destroy(err);
    });
    archive.pipe(out);
    const used = new Map<string, number>();
    void (async () => {
      for (const d of docs) {
        let name = await this.documents.downloadName(d);
        const n = used.get(name) ?? 0;
        used.set(name, n + 1);
        if (n > 0) name = name.replace(/(\.[a-z0-9]+)?$/i, (ext) => ` (${n + 1})${ext}`);
        archive.append(await this.storage.read(d.fileKey), { name });
      }
      await archive.finalize();
    })().catch((err: Error) => archive.emit('error', err));

    await this.audit.record(actor, {
      action: 'document.bulk_downloaded',
      entityType: 'document',
      clientId: new Set(docs.map((d) => d.clientId)).size === 1 ? docs[0]!.clientId : null,
      metadata: { count: docs.length, label, files: docs.slice(0, 50).map((d) => d.fileName) },
    });
    const safe = label.replace(/[^A-Za-z0-9_\- ]/g, '').trim().replace(/\s+/g, '_') || 'documents';
    return { stream: out, fileName: `${safe}.zip` };
  }
}

function chunkKey(tenantId: string, sessionId: string, offset: number): string {
  return `tenants/${tenantId}/uploads/${sessionId}/${String(offset).padStart(12, '0')}`;
}

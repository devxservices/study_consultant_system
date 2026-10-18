import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import {
  UPLOAD_CEILING_MB,
  bulkSchema,
  copyDocumentSchema,
  createFolderSchema,
  createShareSchema,
  documentTypeSchema,
  driveListQuerySchema,
  driveSettingsSchema,
  driveUploadFieldsSchema,
  folderTemplateSchema,
  grantSchema,
  requirementSetSchema,
  starSchema,
  startUploadSchema,
  studentsQuerySchema,
  updateDocumentSchema,
  updateFolderSchema,
  type AuthUser,
  type BulkInput,
  type CopyDocumentInput,
  type CreateFolderInput,
  type CreateShareInput,
  type DocumentTypeInput,
  type DriveListQuery,
  type DriveSettingsInput,
  type FolderTemplateInput,
  type GrantInput,
  type RequirementSetInput,
  type StarInput,
  type StartUploadInput,
  type StudentsQuery,
  type UpdateDocumentInput,
  type UpdateFolderInput,
} from '@crm/shared';
import { zodPipe } from '../common/zod.pipe';
import { CurrentUser, Roles } from '../auth/auth.guard';
import { RequirePermission } from '../auth/permissions';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { DocumentsService } from '../documents/documents.service';
import { FoldersService } from '../documents/folders.service';
import { DriveSettingsService } from '../documents/drive-settings.service';
import { sendFile } from '../documents/documents.controller';
import { DriveService } from './drive.service';
import { ChecklistService } from './checklist.service';
import { ShareService } from './share.service';
import { CHUNK_BYTES, UploadsService } from './uploads.service';

interface UploadedFileLike {
  buffer: Buffer;
  originalname: string;
  size: number;
}

/**
 * The documents drive. Staff browse every student they work with and the
 * agency's own folders; a student browses their own. Every route names the
 * permission it needs and every query is scoped in SQL (documents/drive-sql).
 */
@Controller('drive')
export class DriveController {
  constructor(
    private readonly drive: DriveService,
    private readonly documents: DocumentsService,
    private readonly folders: FoldersService,
    private readonly settings: DriveSettingsService,
    private readonly checklists: ChecklistService,
    private readonly shares: ShareService,
    private readonly uploads: UploadsService,
  ) {}

  /* ---------------- browsing ---------------- */

  @RequirePermission('document.view')
  @Get()
  list(@CurrentUser() actor: AuthUser, @Query(zodPipe(driveListQuerySchema)) query: DriveListQuery) {
    return this.drive.list(actor, query);
  }

  @RequirePermission('document.view')
  @Get('documents/:id')
  document(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.drive.document(actor, id);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('document.view')
  @Get('students')
  students(@CurrentUser() actor: AuthUser, @Query(zodPipe(studentsQuerySchema)) query: StudentsQuery) {
    return this.drive.students(actor, query);
  }

  @RequirePermission('document.view')
  @Get('students/:clientId/checklist')
  studentChecklist(@CurrentUser() actor: AuthUser, @Param('clientId', ParseUUIDPipe) clientId: string) {
    return this.checklists.forStudent(actor, clientId);
  }

  /** A student's own checklist, for their portal. */
  @Roles('client')
  @Get('checklist')
  myChecklist(@CurrentUser() actor: AuthUser) {
    if (!actor.clientId) throw new ForbiddenException('No student record.');
    return this.checklists.forStudent(actor, actor.clientId);
  }

  /* ---------------- folders ---------------- */

  @RequirePermission('document.view')
  @Get('folders/:id')
  folder(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.folders.view(actor, id);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('document.manage')
  @Post('folders')
  createFolder(@CurrentUser() actor: AuthUser, @Body(zodPipe(createFolderSchema)) body: CreateFolderInput) {
    return this.folders.create(actor, body);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('document.manage')
  @Patch('folders/:id')
  updateFolder(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateFolderSchema)) body: UpdateFolderInput,
  ) {
    return this.folders.update(actor, id, body);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('document.manage')
  @Post('folders/:id/trash')
  @HttpCode(204)
  async trashFolder(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.folders.trash(actor, id);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('document.manage')
  @Post('folders/:id/restore')
  @HttpCode(204)
  async restoreFolder(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.folders.restore(actor, id);
  }

  /* ---------------- documents ---------------- */

  @Roles('consultant', 'manager')
  @RequirePermission('document.manage')
  @Patch('documents/:id')
  updateDocument(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateDocumentSchema)) body: UpdateDocumentInput,
  ) {
    return this.drive.updateDocument(actor, id, body);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('document.manage')
  @Post('documents/:id/copy')
  copy(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(copyDocumentSchema)) body: CopyDocumentInput,
  ) {
    return this.drive.copyDocument(actor, id, body);
  }

  @RequirePermission('document.view')
  @Post('star')
  @HttpCode(204)
  async star(@CurrentUser() actor: AuthUser, @Body(zodPipe(starSchema)) body: StarInput): Promise<void> {
    await this.drive.star(actor, body);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('document.view')
  @Post('bulk')
  bulk(@CurrentUser() actor: AuthUser, @Body(zodPipe(bulkSchema)) body: BulkInput) {
    return this.drive.bulk(actor, body);
  }

  /** Several documents, or a whole folder, as one ZIP. */
  @RequirePermission('document.view')
  @Get('zip')
  async zip(
    @CurrentUser() actor: AuthUser,
    @Query('ids') ids: string | undefined,
    @Query('folderId') folderId: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    let documentIds = (ids ?? '').split(',').filter((v) => /^[0-9a-f-]{36}$/i.test(v));
    let label = 'documents';
    if (folderId) {
      if (!/^[0-9a-f-]{36}$/i.test(folderId)) throw new BadRequestException('Not a folder.');
      const folder = await this.folders.find(actor, folderId);
      label = folder.name;
      const listing = await this.drive.list(actor, { folderId, q: undefined, sort: 'name', page: 1, pageSize: 200 } as DriveListQuery);
      documentIds = listing.documents.map((d) => d.id);
    }
    const { stream, fileName } = await this.uploads.zip(actor, documentIds, label);
    sendFile(res, stream, 'application/zip', fileName, 'attachment');
  }

  /* ---------------- uploads ---------------- */

  /** One request, one file: into a student's drive, a folder, or an application. */
  @RequirePermission('document.upload')
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_CEILING_MB * 1024 * 1024, files: 1 } }))
  async upload(
    @CurrentUser() actor: AuthUser,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body() body: Record<string, string>,
  ) {
    if (!file) throw new BadRequestException({ message: 'No file was received.', fieldErrors: { file: 'Choose a file to upload.' } });
    const fields = zodPipe(driveUploadFieldsSchema).transform(
      Object.fromEntries(Object.entries(body).filter(([, v]) => v !== '' && v !== undefined)),
    );
    const accepted = await this.documents.accept(actor, file);
    const created = await this.documents.store(
      actor,
      {
        clientId: actor.role === 'client' ? actor.clientId : (fields.clientId ?? null),
        caseId: fields.caseId ?? null,
        folderId: fields.folderId ?? null,
        typeKey: fields.typeKey ?? null,
        replacesId: fields.replacesId ?? null,
        expiresOn: fields.expiresOn ?? null,
        issuedOn: fields.issuedOn ?? null,
      },
      accepted,
    );
    return this.drive.document(actor, created.id);
  }

  @RequirePermission('document.upload')
  @Post('uploads')
  startUpload(@CurrentUser() actor: AuthUser, @Body(zodPipe(startUploadSchema)) body: StartUploadInput) {
    return this.uploads.start(actor, body);
  }

  @RequirePermission('document.upload')
  @Get('uploads/:id')
  uploadStatus(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.uploads.status(actor, id);
  }

  /** One chunk as the raw request body (application/octet-stream), at ?offset=. */
  @RequirePermission('document.upload')
  @Put('uploads/:id')
  async uploadChunk(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('offset') offset: string,
    @Req() req: Request,
  ) {
    const at = Number(offset);
    if (!Number.isInteger(at) || at < 0) throw new BadRequestException('offset must be a whole number.');
    return this.uploads.chunk(actor, id, at, await readBody(req, CHUNK_BYTES));
  }

  @RequirePermission('document.upload')
  @Post('uploads/:id/complete')
  async completeUpload(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const created = await this.uploads.complete(actor, id);
    return this.drive.document(actor, created.id);
  }

  /* ---------------- settings ---------------- */

  /** Readable by everyone who uploads, so the uploader knows the limits before trying. */
  @Get('settings')
  getSettings(@CurrentUser() actor: AuthUser) {
    return this.settings.get(tenantOf(actor));
  }

  @Roles('consultant', 'manager')
  @RequirePermission('document.settings')
  @Put('settings')
  putSettings(@CurrentUser() actor: AuthUser, @Body(zodPipe(driveSettingsSchema)) body: DriveSettingsInput) {
    return this.settings.update(actor, body);
  }

  @Get('types')
  types(@CurrentUser() actor: AuthUser) {
    return this.drive.types(actor);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('document.settings')
  @Post('types')
  createType(@CurrentUser() actor: AuthUser, @Body(zodPipe(documentTypeSchema)) body: DocumentTypeInput) {
    return this.drive.saveType(actor, body);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('document.settings')
  @Patch('types/:id')
  updateType(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(documentTypeSchema)) body: DocumentTypeInput,
  ) {
    return this.drive.saveType(actor, body, id);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('document.view')
  @Get('folder-templates')
  folderTemplates(@CurrentUser() actor: AuthUser) {
    return this.drive.folderTemplates(actor);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('document.settings')
  @Post('folder-templates')
  createFolderTemplate(@CurrentUser() actor: AuthUser, @Body(zodPipe(folderTemplateSchema)) body: FolderTemplateInput) {
    return this.drive.saveFolderTemplate(actor, body);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('document.settings')
  @Patch('folder-templates/:id')
  updateFolderTemplate(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(folderTemplateSchema)) body: FolderTemplateInput,
  ) {
    return this.drive.saveFolderTemplate(actor, body, id);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('document.settings')
  @Delete('folder-templates/:id')
  @HttpCode(204)
  async deleteFolderTemplate(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.drive.deleteFolderTemplate(actor, id);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('document.view')
  @Get('checklists')
  checklistSets(@CurrentUser() actor: AuthUser) {
    return this.drive.checklistSets(actor);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('document.settings')
  @Post('checklists')
  createChecklist(@CurrentUser() actor: AuthUser, @Body(zodPipe(requirementSetSchema)) body: RequirementSetInput) {
    return this.drive.saveChecklistSet(actor, body);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('document.settings')
  @Patch('checklists/:id')
  updateChecklist(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(requirementSetSchema)) body: RequirementSetInput,
  ) {
    return this.drive.saveChecklistSet(actor, body, id);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('document.settings')
  @Delete('checklists/:id')
  @HttpCode(204)
  async deleteChecklist(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.drive.deleteChecklistSet(actor, id);
  }

  /* ---------------- access grants (managers) ---------------- */

  @Roles('manager')
  @Get('grants')
  grants(
    @CurrentUser() actor: AuthUser,
    @Query('resourceType') resourceType?: string,
    @Query('resourceId') resourceId?: string,
  ) {
    return this.drive.grants(actor, {
      resourceType: resourceType === 'folder' || resourceType === 'document' ? resourceType : undefined,
      resourceId: resourceId && /^[0-9a-f-]{36}$/i.test(resourceId) ? resourceId : undefined,
    });
  }

  @Roles('manager')
  @Post('grants')
  grant(@CurrentUser() actor: AuthUser, @Body(zodPipe(grantSchema)) body: GrantInput) {
    return this.drive.grant(actor, body);
  }

  @Roles('manager')
  @Delete('grants/:id')
  @HttpCode(204)
  async revokeGrant(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.drive.revokeGrant(actor, id);
  }

  /* ---------------- share links ---------------- */

  @Roles('consultant', 'manager')
  @RequirePermission('document.view')
  @Get('shares')
  listShares(
    @CurrentUser() actor: AuthUser,
    @Query('documentId') documentId?: string,
    @Query('folderId') folderId?: string,
  ) {
    const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
    return this.shares.list(actor, { documentId: uuid(documentId), folderId: uuid(folderId) });
  }

  @Roles('consultant', 'manager')
  @RequirePermission('document.share')
  @Post('shares')
  createShare(@CurrentUser() actor: AuthUser, @Body(zodPipe(createShareSchema)) body: CreateShareInput) {
    return this.shares.create(actor, body);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('document.share')
  @Post('shares/:id/revoke')
  @HttpCode(204)
  async revokeShare(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.shares.revoke(actor, id);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('document.share')
  @Get('shares/:id/access')
  shareAccess(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.shares.accessLog(actor, id);
  }
}

/** Reads a raw request body, refusing anything larger than the limit. */
function readBody(req: Request, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new BadRequestException('Chunks are at most 2 MB.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

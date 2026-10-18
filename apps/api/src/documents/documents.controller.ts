import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  UPLOAD_CEILING_MB,
  setStatusSchema,
  type SetStatusInput,
  commentDocumentSchema,
  listDocumentsQuerySchema,
  rejectDocumentSchema,
  uploadDocumentSchema,
  type AuthUser,
  type CommentDocumentInput,
  type ListDocumentsQuery,
  type RejectDocumentInput,
} from '@crm/shared';
import { zodPipe } from '../common/zod.pipe';
import { CurrentUser, Roles } from '../auth/auth.guard';
import { RequirePermission } from '../auth/permissions';
import { DocumentsService } from './documents.service';
import type { Readable } from 'node:stream';

/** What multer hands us; typed here to avoid depending on the global namespace. */
interface UploadedFileLike {
  buffer: Buffer;
  originalname: string;
  size: number;
  mimetype: string;
}

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @RequirePermission('document.view')
  @Get()
  list(
    @CurrentUser() actor: AuthUser,
    @Query(zodPipe(listDocumentsQuerySchema)) query: ListDocumentsQuery,
  ) {
    return this.documents.list(actor, query);
  }

  @RequirePermission('document.view')
  @Get(':id')
  view(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.documents.view(actor, id);
  }

  /**
   * Streams the file itself. Used by local storage; with S3 the client gets a
   * presigned URL instead and never touches this route. Either way the bytes
   * are only served after the same access check as the metadata.
   */
  @RequirePermission('document.view')
  @Get(':id/file')
  async file(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { stream, mimeType, fileName } = await this.documents.download(actor, id);
    // inline so a consultant can preview a passport scan without downloading it.
    sendFile(res, stream, mimeType, fileName, 'inline');
  }

  /** The same bytes as an attachment, named by the consultancy's pattern (Ali_Khan_Passport.pdf). */
  @RequirePermission('document.view')
  @Get(':id/download')
  async downloadAs(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { stream, mimeType, downloadName } = await this.documents.download(actor, id);
    sendFile(res, stream, mimeType, downloadName, 'attachment');
  }

  /** Under review, approved, rejected or "please send it again" - with the reason for the last two. */
  @Roles('consultant', 'manager')
  @Post(':id/status')
  async setStatus(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(setStatusSchema)) body: SetStatusInput,
  ) {
    await this.documents.setStatus(actor, id, body.status, body.comment);
    return this.documents.view(actor, id);
  }

  @RequirePermission('document.delete')
  @Post(':id/restore')
  async restore(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const doc = await this.documents.restore(actor, id);
    return this.documents.view(actor, doc.id);
  }

  @RequirePermission('document.view')
  @Get(':id/versions')
  versions(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.documents.versions(actor, id);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('document.upload')
  @Post(':id/versions/:versionId/restore')
  async restoreVersion(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ) {
    const doc = await this.documents.restoreVersion(actor, id, versionId);
    return this.documents.view(actor, doc.id);
  }

  /**
   * Upload. Clients upload their own documents; consultants can upload on a
   * client's behalf when a document arrives by hand or over WhatsApp.
   */
  @RequirePermission('document.upload')
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      // The platform's ceiling; the consultancy's own limit is checked after.
      limits: { fileSize: UPLOAD_CEILING_MB * 1024 * 1024, files: 1 },
    }),
  )
  async upload(
    @CurrentUser() actor: AuthUser,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body() body: Record<string, string>,
  ) {
    if (!file) {
      throw new BadRequestException({
        message: 'No file was received.',
        fieldErrors: { file: 'Choose a file to upload.' },
      });
    }

    // Multipart text fields arrive as strings, so parse them separately from
    // the file rather than through a body-wide pipe.
    const input = zodPipe(uploadDocumentSchema).transform({
      caseId: body.caseId,
      type: body.type,
      ...(body.replacesId ? { replacesId: body.replacesId } : {}),
      ...(body.expiresOn ? { expiresOn: body.expiresOn } : {}),
    });

    return this.documents.upload(actor, input, await this.documents.accept(actor, file));
  }

  @Roles('consultant', 'manager')
  @RequirePermission('document.verify')
  @Post(':id/verify')
  verify(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.documents.verify(actor, id);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('document.reject')
  @Post(':id/reject')
  reject(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(rejectDocumentSchema)) body: RejectDocumentInput,
  ) {
    return this.documents.reject(actor, id, body);
  }

  /** Open to clients too - this is the back-and-forth about a document. */
  @RequirePermission('document.comment')
  @Post(':id/comments')
  comment(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(commentDocumentSchema)) body: CommentDocumentInput,
  ) {
    return this.documents.comment(actor, id, body);
  }

  @RequirePermission('document.delete')
  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.documents.remove(actor, id);
  }
}

/**
 * Streams a stored file back. Private and never cached by a proxy - the URL is
 * per-person authorised - and nosniff, so a browser never second-guesses the type.
 */
export function sendFile(
  res: Response,
  stream: Readable,
  mimeType: string,
  fileName: string,
  disposition: 'inline' | 'attachment',
): void {
  res.setHeader('Content-Type', mimeType);
  res.setHeader(
    'Content-Disposition',
    `${disposition}; filename="${fileName.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  );
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  stream.on('error', () => {
    if (!res.headersSent) res.status(404).end();
    else res.end();
  });
  stream.pipe(res);
}

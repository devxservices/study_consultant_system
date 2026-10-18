import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { unlockShareSchema, type UnlockShareInput } from '@crm/shared';
import { zodPipe } from '../common/zod.pipe';
import { Public, Site } from '../auth/auth.guard';
import { clientIp } from '../common/request-context';
import type { ResolvedHost } from '../tenancy/tenant-resolver.service';
import { sendFile } from '../documents/documents.controller';
import { ShareService, type Visitor } from './share.service';

/**
 * Share links, from the outside. No account: the token in the address is
 * the key, the password (when set) is the second one. Everything is logged.
 */
@Public()
@Controller('share')
export class ShareController {
  constructor(private readonly shares: ShareService) {}

  @Get(':token')
  view(@Param('token') token: string, @Query('access') access: string | undefined, @Req() req: Request, @Site() site: ResolvedHost) {
    return this.shares.publicView(token, access, visitor(req, site));
  }

  @Post(':token/unlock')
  unlock(
    @Param('token') token: string,
    @Body(zodPipe(unlockShareSchema)) body: UnlockShareInput,
    @Req() req: Request,
    @Site() site: ResolvedHost,
  ) {
    return this.shares.unlock(token, body.password, visitor(req, site));
  }

  @Get(':token/files/:documentId')
  async file(
    @Param('token') token: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Query('access') access: string | undefined,
    @Query('download') download: string | undefined,
    @Req() req: Request,
    @Site() site: ResolvedHost,
    @Res() res: Response,
  ): Promise<void> {
    const f = await this.shares.file(token, documentId, access, download === '1', visitor(req, site));
    sendFile(res, f.stream, f.mimeType, f.fileName, f.disposition);
  }
}

function visitor(req: Request, site: ResolvedHost): Visitor {
  return {
    ip: clientIp(req.headers, req.socket.remoteAddress),
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    tenantId: site.kind === 'tenant' ? site.tenant.id : null,
  };
}

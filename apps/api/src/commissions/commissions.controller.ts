import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Readable } from 'node:stream';
import { z } from 'zod';
import {
  UPLOAD_CEILING_MB,
  agreementSchema,
  caseEnrolmentSchema,
  claimSchema,
  clawbackSchema,
  commissionReasonSchema,
  commissionSettingsSchema,
  commissionSplitSchema,
  commissionsQuerySchema,
  confirmCommissionSchema,
  institutionReceiptSchema,
  institutionSchema,
  institutionsQuerySchema,
  manualCommissionSchema,
  payIncentiveSchema,
  submitClaimSchema,
  type AuthUser,
  type CommissionsQuery,
  type InstitutionsQuery,
} from '@crm/shared';
import { zodPipe } from '../common/zod.pipe';
import { CurrentUser, Roles } from '../auth/auth.guard';
import { RequirePermission } from '../auth/permissions';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { sendFile } from '../documents/documents.controller';
import { InstitutionsService } from './institutions.service';
import { CommissionsService } from './commissions.service';
import { ClaimsService } from './claims.service';

const reason = zodPipe(commissionReasonSchema);

/** Institutions and their agreements. Every member of staff reads; changing needs "Manage universities". */
@Roles('consultant', 'manager')
@Controller('institutions')
export class InstitutionsController {
  constructor(private readonly institutions: InstitutionsService) {}

  @Get()
  list(@CurrentUser() actor: AuthUser, @Query(zodPipe(institutionsQuerySchema)) q: InstitutionsQuery) {
    return this.institutions.list(actor, q);
  }

  @Get(':id')
  get(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.institutions.get(actor, id);
  }

  @RequirePermission('institution.manage')
  @Post()
  create(@CurrentUser() actor: AuthUser, @Body(zodPipe(institutionSchema)) body: z.input<typeof institutionSchema>) {
    return this.institutions.save(actor, body);
  }

  @RequirePermission('institution.manage')
  @Put(':id')
  save(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(institutionSchema)) body: z.input<typeof institutionSchema>) {
    return this.institutions.save(actor, body, id);
  }

  @RequirePermission('institution.manage')
  @Post(':id/agreements')
  addAgreement(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(agreementSchema)) body: z.input<typeof agreementSchema>) {
    return this.institutions.saveAgreement(actor, id, body);
  }

  @RequirePermission('institution.manage')
  @Put(':id/agreements/:agreementId')
  saveAgreement(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('agreementId', ParseUUIDPipe) agreementId: string,
    @Body(zodPipe(agreementSchema)) body: z.input<typeof agreementSchema>,
  ) {
    return this.institutions.saveAgreement(actor, id, body, agreementId);
  }

  @RequirePermission('institution.manage')
  @Post('agreements/:agreementId/document')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_CEILING_MB * 1024 * 1024, files: 1 } }))
  async attach(@CurrentUser() actor: AuthUser, @Param('agreementId', ParseUUIDPipe) agreementId: string, @UploadedFile() file?: { buffer: Buffer; originalname: string; size: number }) {
    if (!file) throw new BadRequestException('Attach the signed agreement.');
    await this.institutions.attachAgreementDocument(actor, agreementId, file);
    return { ok: true };
  }

  @Get('agreements/:agreementId/document')
  async document(@CurrentUser() actor: AuthUser, @Param('agreementId', ParseUUIDPipe) agreementId: string, @Res() res: Response) {
    const d = await this.institutions.agreementDocument(actor, agreementId);
    sendFile(res, d.stream, d.mime, d.name, 'inline');
  }
}

/** An application's institution, tuition and commissions. */
@Roles('consultant', 'manager')
@Controller('cases')
export class CaseCommissionsController {
  constructor(
    private readonly institutions: InstitutionsService,
    private readonly commissions: CommissionsService,
  ) {}

  @RequirePermission('case.edit')
  @Put(':id/enrolment')
  async enrolment(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(caseEnrolmentSchema)) body: z.input<typeof caseEnrolmentSchema>) {
    const detail = await this.institutions.setEnrolment(actor, id, body);
    // What is only expected follows the new fees and dates (or the new institution)...
    await this.commissions.followEnrolment(tenantOf(actor), id, actor);
    // ...and an application already past its trigger step earns its commission now.
    await this.commissions.workOut(tenantOf(actor), id, actor, false);
    return detail;
  }

  @RequirePermission('commission.view')
  @Get(':id/commissions')
  forCase(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.commissions.forCase(actor, id);
  }

  @RequirePermission('commission.manage')
  @Post(':id/commissions/work-out')
  workOut(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.commissions.workOutFor(actor, id);
  }
}

/** Claims and receipts - registered before the commission routes, whose ":id" would otherwise take these paths. */
@Roles('consultant', 'manager')
@Controller('commissions')
export class ClaimsController {
  constructor(
    private readonly claims: ClaimsService,
    private readonly commissions: CommissionsService,
  ) {}

  @RequirePermission('commission.view')
  @Get('overview')
  async overview(@CurrentUser() actor: AuthUser) {
    return this.commissions.overview(actor, await this.claims.overdue(tenantOf(actor)));
  }

  @RequirePermission('commission.view')
  @Get('settings')
  settings(@CurrentUser() actor: AuthUser) {
    return this.commissions.settings(actor);
  }

  @RequirePermission('commission.manage')
  @Put('settings')
  saveSettings(@CurrentUser() actor: AuthUser, @Body(zodPipe(commissionSettingsSchema)) body: z.input<typeof commissionSettingsSchema>) {
    return this.commissions.saveSettings(actor, body);
  }

  @RequirePermission('commission.manage')
  @Get('staff-options')
  staffOptions(@CurrentUser() actor: AuthUser) {
    return this.commissions.staffOptions(actor);
  }

  /** Any member of staff: their own incentives. */
  @Get('incentives/mine')
  mine(@CurrentUser() actor: AuthUser) {
    return this.commissions.myIncentives(actor);
  }

  @RequirePermission('commission.manage')
  @Post('splits/:splitId/pay')
  payIncentive(@CurrentUser() actor: AuthUser, @Param('splitId', ParseUUIDPipe) splitId: string, @Body(zodPipe(payIncentiveSchema)) body: z.input<typeof payIncentiveSchema>) {
    return this.commissions.payIncentive(actor, splitId, body);
  }

  @RequirePermission('commission.view')
  @Get('claims')
  claimsList(@CurrentUser() actor: AuthUser, @Query('status') status?: string, @Query('institutionId') institutionId?: string) {
    return this.claims.list(actor, { status, institutionId: institutionId && /^[0-9a-f-]{36}$/i.test(institutionId) ? institutionId : undefined });
  }

  @RequirePermission('commission.manage')
  @Post('claims')
  createClaim(@CurrentUser() actor: AuthUser, @Body(zodPipe(claimSchema)) body: z.input<typeof claimSchema>) {
    return this.claims.create(actor, body);
  }

  @RequirePermission('commission.view')
  @Get('claims/:id')
  claim(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.claims.get(actor, id);
  }

  @RequirePermission('commission.view')
  @Get('claims/:id/pdf')
  async claimPdf(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const f = await this.claims.pdfFor(actor, id);
    sendFile(res, Readable.from(f.file), 'application/pdf', f.name, 'inline');
  }

  @RequirePermission('commission.manage')
  @Post('claims/:id/submit')
  submit(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(submitClaimSchema)) body: z.input<typeof submitClaimSchema>) {
    return this.claims.submit(actor, id, body);
  }

  @RequirePermission('commission.manage')
  @Post('claims/:id/dispute')
  disputeClaim(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(reason) body: { reason: string }) {
    return this.claims.setDisputed(actor, id, true, body.reason);
  }

  @RequirePermission('commission.manage')
  @Post('claims/:id/resolve')
  resolveClaim(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(reason) body: { reason: string }) {
    return this.claims.setDisputed(actor, id, false, body.reason);
  }

  @RequirePermission('commission.manage')
  @Post('claims/:id/cancel')
  cancelClaim(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(reason) body: { reason: string }) {
    return this.claims.cancel(actor, id, body.reason);
  }

  @RequirePermission('commission.view')
  @Get('receipts')
  receipts(@CurrentUser() actor: AuthUser, @Query('institutionId') institutionId?: string) {
    return this.claims.receipts(actor, { institutionId: institutionId && /^[0-9a-f-]{36}$/i.test(institutionId) ? institutionId : undefined });
  }

  @RequirePermission('commission.manage')
  @Post('receipts')
  record(@CurrentUser() actor: AuthUser, @Body(zodPipe(institutionReceiptSchema)) body: z.input<typeof institutionReceiptSchema>) {
    return this.claims.record(actor, body);
  }

  @RequirePermission('commission.manage')
  @Post('receipts/:id/void')
  voidReceipt(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(reason) body: { reason: string }) {
    return this.claims.voidReceipt(actor, id, body.reason);
  }
}

@Roles('consultant', 'manager')
@Controller('commissions')
export class CommissionsController {
  constructor(private readonly commissions: CommissionsService) {}

  @RequirePermission('commission.view')
  @Get()
  list(@CurrentUser() actor: AuthUser, @Query(zodPipe(commissionsQuerySchema)) q: CommissionsQuery) {
    return this.commissions.list(actor, q);
  }

  @RequirePermission('commission.manage')
  @Post()
  create(@CurrentUser() actor: AuthUser, @Body(zodPipe(manualCommissionSchema)) body: z.input<typeof manualCommissionSchema>) {
    return this.commissions.createManual(actor, body);
  }

  @RequirePermission('commission.view')
  @Get(':id')
  get(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.commissions.get(actor, id);
  }

  @RequirePermission('commission.manage')
  @Post(':id/confirm')
  confirm(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(confirmCommissionSchema)) body: z.input<typeof confirmCommissionSchema>) {
    return this.commissions.confirm(actor, id, body);
  }

  @RequirePermission('commission.manage')
  @Post(':id/cancel')
  cancel(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(reason) body: { reason: string }) {
    return this.commissions.cancel(actor, id, body.reason);
  }

  @RequirePermission('commission.manage')
  @Post(':id/dispute')
  dispute(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(reason) body: { reason: string }) {
    return this.commissions.dispute(actor, id, body.reason);
  }

  @RequirePermission('commission.manage')
  @Post(':id/resolve')
  resolve(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(reason) body: { reason: string }) {
    return this.commissions.resolveDispute(actor, id, body.reason);
  }

  @RequirePermission('commission.manage')
  @Post(':id/write-off')
  writeOff(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(reason) body: { reason: string }) {
    return this.commissions.writeOff(actor, id, body.reason);
  }

  @RequirePermission('commission.manage')
  @Post(':id/clawback')
  clawback(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(clawbackSchema)) body: z.input<typeof clawbackSchema>) {
    return this.commissions.clawback(actor, id, body);
  }

  @RequirePermission('commission.manage')
  @Put(':id/splits')
  splits(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(commissionSplitSchema)) body: z.input<typeof commissionSplitSchema>) {
    return this.commissions.setSplits(actor, id, body);
  }
}

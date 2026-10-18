import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { z } from 'zod';
import {
  localIsoDate,
  PARTNER_MEMBER_ROLES,
  UPLOAD_CEILING_MB,
  advanceSchema,
  assignStudentSchema,
  createPayoutSchema,
  earningAdjustmentSchema,
  kycReviewSchema,
  partnerAgreementSchema,
  partnerApplicationSchema,
  partnerBankSchema,
  partnerMemberSchema,
  partnerMessageSchema,
  partnerRuleSchema,
  partnerSchema,
  partnerSettingsSchema,
  partnerStatusSchema,
  partnerTierSchema,
  partnersQuerySchema,
  payPayoutSchema,
  registerStudentSchema,
  resolveConflictSchema,
  signAgreementSchema,
  type AuthUser,
  type PartnersQuery,
} from '@crm/shared';
import { zodPipe } from '../common/zod.pipe';
import { CurrentUser, Public, Roles, Site } from '../auth/auth.guard';
import { RequirePermission } from '../auth/permissions';
import { clientIp } from '../common/request-context';
import { sendFile } from '../documents/documents.controller';
import type { ResolvedHost } from '../tenancy/tenant-resolver.service';
import { PartnersService } from './partners.service';
import { PartnerAgreementsService } from './agreements.service';
import { AttributionService } from './attribution.service';
import { PartnerEarningsService } from './earnings.service';
import { PayoutsService } from './payouts.service';
import { PartnerPortalService } from './portal.service';
import { FormThrottleGuard } from './form-throttle.guard';

const reason = zodPipe(z.object({ reason: z.string().trim().min(5, 'Say why, so the record explains itself later').max(500) }));
const memberChange = zodPipe(z.object({ role: z.enum(PARTNER_MEMBER_ROLES).optional(), active: z.boolean().optional() }));
const uploadLimits = { limits: { fileSize: UPLOAD_CEILING_MB * 1024 * 1024, files: 1 } };
type Upload = { buffer: Buffer; originalname: string; size: number };

function pdf(res: Response, buf: Buffer, name: string) {
  sendFile(res, Readable.from(buf), 'application/pdf', name, 'inline');
}

/**
 * Partners, from the consultancy's side. Reading needs "See partners";
 * changing needs "Manage partners"; money out needs "Pay partners" (checked
 * in the services, which also refuse other consultancies' records).
 */
@Roles('consultant', 'manager')
@Controller('partners')
export class PartnersController {
  constructor(
    private readonly partners: PartnersService,
    private readonly agreements: PartnerAgreementsService,
    private readonly attribution: AttributionService,
    private readonly earnings: PartnerEarningsService,
    private readonly payouts: PayoutsService,
    private readonly portal: PartnerPortalService,
  ) {}

  /* Static routes first: ":id" would take them otherwise. */

  @RequirePermission('partner.view')
  @Get()
  list(@CurrentUser() actor: AuthUser, @Query(zodPipe(partnersQuerySchema)) q: PartnersQuery) {
    return this.partners.list(actor, q);
  }

  @RequirePermission('partner.view')
  @Get('options')
  options(@CurrentUser() actor: AuthUser) {
    return this.partners.options(actor);
  }

  @RequirePermission('partner.view')
  @Get('leaderboard')
  leaderboard(@CurrentUser() actor: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.partners.leaderboard(actor, { from, to });
  }

  @RequirePermission('partner.view')
  @Get('settings')
  settings(@CurrentUser() actor: AuthUser) {
    return this.partners.readSettings(actor);
  }

  @RequirePermission('partner.manage')
  @Put('settings')
  saveSettings(@CurrentUser() actor: AuthUser, @Body(zodPipe(partnerSettingsSchema)) body: z.input<typeof partnerSettingsSchema>) {
    return this.partners.saveSettings(actor, body);
  }

  @RequirePermission('partner.view')
  @Get('conflicts')
  conflicts(@CurrentUser() actor: AuthUser, @Query('status') status?: string) {
    return this.attribution.conflicts(actor, status && ['open', 'decided', 'all'].includes(status) ? status : 'open');
  }

  @RequirePermission('partner.manage')
  @Post('conflicts/:id/resolve')
  resolve(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(resolveConflictSchema)) body: z.input<typeof resolveConflictSchema>) {
    return this.attribution.resolve(actor, id, body);
  }

  @RequirePermission('partner.view')
  @Get('rules')
  rules(@CurrentUser() actor: AuthUser, @Query('all') all?: string) {
    return this.earnings.rules(actor, all === 'true');
  }

  @RequirePermission('partner.manage')
  @Post('rules')
  addRule(@CurrentUser() actor: AuthUser, @Body(zodPipe(partnerRuleSchema)) body: z.input<typeof partnerRuleSchema>) {
    return this.earnings.saveRule(actor, body);
  }

  @RequirePermission('partner.manage')
  @Put('rules/:ruleKey')
  saveRule(@CurrentUser() actor: AuthUser, @Param('ruleKey', ParseUUIDPipe) ruleKey: string, @Body(zodPipe(partnerRuleSchema)) body: z.input<typeof partnerRuleSchema>) {
    return this.earnings.saveRule(actor, body, ruleKey);
  }

  @RequirePermission('partner.view')
  @Get('earnings')
  earningsList(@CurrentUser() actor: AuthUser, @Query() q: Record<string, unknown>) {
    return this.earnings.list(actor, q);
  }

  @RequirePermission('partner.view')
  @Get('payouts')
  payoutList(@CurrentUser() actor: AuthUser, @Query('partnerId') partnerId?: string, @Query('status') status?: string) {
    return this.payouts.list(actor, { partnerId: partnerId && /^[0-9a-f-]{36}$/i.test(partnerId) ? partnerId : undefined, status });
  }

  @RequirePermission('partner.view')
  @Get('payouts/owed')
  owed(@CurrentUser() actor: AuthUser) {
    return this.payouts.owed(actor);
  }

  @RequirePermission('payout.manage')
  @Post('payouts')
  createPayout(@CurrentUser() actor: AuthUser, @Body(zodPipe(createPayoutSchema)) body: z.input<typeof createPayoutSchema>) {
    return this.payouts.create(actor, body);
  }

  @RequirePermission('partner.view')
  @Get('payouts/:id')
  payout(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payouts.get(actor, id);
  }

  @RequirePermission('partner.view')
  @Get('payouts/:id/statement')
  async statement(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const s = await this.payouts.statement(actor, id);
    pdf(res, s.pdf, s.name);
  }

  @RequirePermission('payout.manage')
  @Post('payouts/:id/approve')
  approve(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payouts.approve(actor, id);
  }

  @RequirePermission('payout.manage')
  @Post('payouts/:id/pay')
  pay(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(payPayoutSchema)) body: z.input<typeof payPayoutSchema>) {
    return this.payouts.pay(actor, id, body);
  }

  @RequirePermission('payout.manage')
  @Post('payouts/:id/void')
  voidPayout(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(reason) body: { reason: string }) {
    return this.payouts.void(actor, id, body.reason);
  }

  @RequirePermission('partner.view')
  @Get('advances')
  advances(@CurrentUser() actor: AuthUser, @Query('partnerId') partnerId?: string) {
    return this.payouts.advances(actor, partnerId && /^[0-9a-f-]{36}$/i.test(partnerId) ? partnerId : undefined);
  }

  @RequirePermission('payout.manage')
  @Post('advances')
  giveAdvance(@CurrentUser() actor: AuthUser, @Body(zodPipe(advanceSchema)) body: z.input<typeof advanceSchema>) {
    return this.payouts.giveAdvance(actor, body);
  }

  @RequirePermission('payout.manage')
  @Post('advances/:id/void')
  voidAdvance(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(reason) body: { reason: string }) {
    return this.payouts.voidAdvance(actor, id, body.reason);
  }

  /** Who brought a student - on the student's page. */
  @Get('students/:clientId')
  studentPartner(@CurrentUser() actor: AuthUser, @Param('clientId', ParseUUIDPipe) clientId: string) {
    return this.attribution.partnerOf(actor, clientId);
  }

  @RequirePermission('partner.manage')
  @Put('students/:clientId')
  assign(@CurrentUser() actor: AuthUser, @Param('clientId', ParseUUIDPipe) clientId: string, @Body(zodPipe(assignStudentSchema)) body: z.input<typeof assignStudentSchema>) {
    return this.attribution.assign(actor, clientId, body);
  }

  /* One partner */

  @RequirePermission('partner.manage')
  @Post()
  create(@CurrentUser() actor: AuthUser, @Body(zodPipe(partnerSchema)) body: z.input<typeof partnerSchema>) {
    return this.partners.create(actor, body);
  }

  @RequirePermission('partner.view')
  @Get(':id')
  get(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.partners.get(actor, id);
  }

  @RequirePermission('partner.manage')
  @Put(':id')
  update(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(partnerSchema)) body: z.input<typeof partnerSchema>) {
    return this.partners.update(actor, id, body);
  }

  @RequirePermission('partner.manage')
  @Post(':id/status')
  status(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(partnerStatusSchema)) body: z.input<typeof partnerStatusSchema>) {
    return this.partners.setStatus(actor, id, body);
  }

  @RequirePermission('partner.manage')
  @Post(':id/tier')
  tier(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(partnerTierSchema)) body: z.input<typeof partnerTierSchema>) {
    return this.partners.setTier(actor, id, body);
  }

  @RequirePermission('partner.manage')
  @Post(':id/members')
  addMember(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(partnerMemberSchema)) body: z.input<typeof partnerMemberSchema>) {
    return this.partners.addMember(actor, id, body);
  }

  @RequirePermission('partner.manage')
  @Put(':id/members/:memberId')
  updateMember(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body(memberChange) body: { role?: (typeof PARTNER_MEMBER_ROLES)[number]; active?: boolean },
  ) {
    return this.partners.updateMember(actor, id, memberId, body);
  }

  @RequirePermission('payout.manage')
  @Put(':id/bank')
  @HttpCode(204)
  async bank(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(partnerBankSchema)) body: z.input<typeof partnerBankSchema>) {
    await this.partners.setBank(actor, id, body);
  }

  @RequirePermission('partner.manage')
  @Post(':id/documents')
  @UseInterceptors(FileInterceptor('file', uploadLimits))
  upload(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body('kind') kind: string, @UploadedFile() file?: Upload) {
    if (!file) throw new BadRequestException('Attach the file.');
    return this.partners.uploadDocument(actor, id, kind, file);
  }

  @RequirePermission('partner.manage')
  @Post(':id/documents/:documentId/review')
  review(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('documentId', ParseUUIDPipe) documentId: string, @Body(zodPipe(kycReviewSchema)) body: z.input<typeof kycReviewSchema>) {
    return this.partners.reviewDocument(actor, id, documentId, body);
  }

  @RequirePermission('partner.view')
  @Get(':id/documents/:documentId')
  async document(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('documentId', ParseUUIDPipe) documentId: string, @Res() res: Response) {
    const d = await this.partners.documentFile(actor, id, documentId);
    sendFile(res, d.stream, d.mime, d.name, 'inline');
  }

  @RequirePermission('partner.view')
  @Get(':id/agreements')
  agreementList(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.agreements.list(actor, id);
  }

  @RequirePermission('partner.manage')
  @Get(':id/agreements/draft')
  draft(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.agreements.draftText(actor, id);
  }

  @RequirePermission('partner.manage')
  @Post(':id/agreements')
  addAgreement(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(partnerAgreementSchema)) body: z.input<typeof partnerAgreementSchema>) {
    return this.agreements.create(actor, id, body);
  }

  @RequirePermission('partner.manage')
  @Put(':id/agreements/:agreementId')
  saveAgreement(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('agreementId', ParseUUIDPipe) agreementId: string,
    @Body(zodPipe(partnerAgreementSchema)) body: z.input<typeof partnerAgreementSchema>,
  ) {
    return this.agreements.update(actor, id, agreementId, body);
  }

  @RequirePermission('partner.manage')
  @Post(':id/agreements/:agreementId/send')
  send(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('agreementId', ParseUUIDPipe) agreementId: string) {
    return this.agreements.send(actor, id, agreementId);
  }

  @RequirePermission('partner.manage')
  @Post(':id/agreements/:agreementId/withdraw')
  withdraw(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('agreementId', ParseUUIDPipe) agreementId: string, @Body(reason) body: { reason: string }) {
    return this.agreements.withdraw(actor, id, agreementId, body.reason);
  }

  @RequirePermission('partner.view')
  @Get(':id/agreements/:agreementId/pdf')
  async agreementPdf(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('agreementId', ParseUUIDPipe) agreementId: string, @Res() res: Response) {
    const c = await this.agreements.certificate(actor, id, agreementId);
    pdf(res, c.pdf, c.name);
  }

  @RequirePermission('partner.view')
  @Get(':id/students')
  students(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query('q') q?: string) {
    return this.attribution.students(actor, { partnerId: id, q: q?.slice(0, 80) });
  }

  @RequirePermission('payout.manage')
  @Post(':id/earnings/adjust')
  adjust(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(earningAdjustmentSchema)) body: z.input<typeof earningAdjustmentSchema>) {
    return this.earnings.adjust(actor, id, body);
  }

  @RequirePermission('partner.view')
  @Get(':id/messages')
  messages(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.messages(actor, id);
  }

  @RequirePermission('partner.view')
  @Post(':id/messages')
  message(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(partnerMessageSchema)) body: z.input<typeof partnerMessageSchema>) {
    return this.portal.send(actor, body, id);
  }
}

/** The partner's own portal. Closed to everyone else; the services resolve which partner from the login. */
@Roles('partner')
@Controller('partner-portal')
export class PartnerPortalController {
  constructor(
    private readonly partners: PartnersService,
    private readonly agreements: PartnerAgreementsService,
    private readonly attribution: AttributionService,
    private readonly earnings: PartnerEarningsService,
    private readonly payouts: PayoutsService,
    private readonly portal: PartnerPortalService,
  ) {}

  @Get('dashboard')
  dashboard(@CurrentUser() actor: AuthUser) {
    return this.portal.dashboard(actor);
  }

  /** The partner's own record: bank details in full only for its owner and administrators. */
  @Get('me')
  async me(@CurrentUser() actor: AuthUser) {
    const ctx = await this.partners.context(actor);
    const v = await this.partners.view(ctx.partner.tenantId, ctx.partner.id, ctx.canManage);
    return { ...v, notes: null, managerUserId: null, role: ctx.role, canManage: ctx.canManage };
  }

  @Put('bank')
  @HttpCode(204)
  async bank(@CurrentUser() actor: AuthUser, @Body(zodPipe(partnerBankSchema)) body: z.input<typeof partnerBankSchema>) {
    const ctx = await this.partners.context(actor);
    await this.partners.setBank(actor, ctx.partner.id, body);
  }

  @Post('documents')
  @UseInterceptors(FileInterceptor('file', uploadLimits))
  async upload(@CurrentUser() actor: AuthUser, @Body('kind') kind: string, @UploadedFile() file?: Upload) {
    if (!file) throw new BadRequestException('Attach the file.');
    const ctx = await this.partners.context(actor);
    return this.partners.uploadDocument(actor, ctx.partner.id, kind, file);
  }

  @Get('documents/:documentId')
  async document(@CurrentUser() actor: AuthUser, @Param('documentId', ParseUUIDPipe) documentId: string, @Res() res: Response) {
    const ctx = await this.partners.context(actor);
    const d = await this.partners.documentFile(actor, ctx.partner.id, documentId);
    sendFile(res, d.stream, d.mime, d.name, 'inline');
  }

  @Get('team')
  async team(@CurrentUser() actor: AuthUser) {
    const ctx = await this.partners.context(actor);
    return this.partners.members(ctx.partner.id);
  }

  @Post('team')
  async addMember(@CurrentUser() actor: AuthUser, @Body(zodPipe(partnerMemberSchema)) body: z.input<typeof partnerMemberSchema>) {
    const ctx = await this.partners.context(actor);
    return this.partners.addMember(actor, ctx.partner.id, body);
  }

  @Put('team/:memberId')
  async updateMember(@CurrentUser() actor: AuthUser, @Param('memberId', ParseUUIDPipe) memberId: string, @Body(memberChange) body: { role?: (typeof PARTNER_MEMBER_ROLES)[number]; active?: boolean }) {
    const ctx = await this.partners.context(actor);
    return this.partners.updateMember(actor, ctx.partner.id, memberId, body);
  }

  @Get('agreements')
  async agreementList(@CurrentUser() actor: AuthUser) {
    const ctx = await this.partners.context(actor);
    return this.agreements.list(actor, ctx.partner.id);
  }

  @Post('agreements/:id/sign')
  sign(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(signAgreementSchema)) body: z.input<typeof signAgreementSchema>, @Req() req: Request) {
    return this.agreements.sign(actor, id, body, {
      ip: clientIp(req.headers, req.socket.remoteAddress),
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    });
  }

  @Get('agreements/:id/pdf')
  async agreementPdf(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const ctx = await this.partners.context(actor);
    const c = await this.agreements.certificate(actor, ctx.partner.id, id);
    pdf(res, c.pdf, c.name);
  }

  @Get('students')
  students(@CurrentUser() actor: AuthUser, @Query('q') q?: string) {
    return this.attribution.students(actor, { q: q?.slice(0, 80) });
  }

  @Post('students')
  register(@CurrentUser() actor: AuthUser, @Body(zodPipe(registerStudentSchema)) body: z.input<typeof registerStudentSchema>) {
    return this.attribution.register(actor, body);
  }

  @Get('students/:clientId')
  student(@CurrentUser() actor: AuthUser, @Param('clientId', ParseUUIDPipe) clientId: string) {
    return this.attribution.student(actor, clientId);
  }

  @Post('students/:clientId/documents')
  @UseInterceptors(FileInterceptor('file', uploadLimits))
  uploadForStudent(@CurrentUser() actor: AuthUser, @Param('clientId', ParseUUIDPipe) clientId: string, @Body('type') type: string | undefined, @UploadedFile() file?: Upload) {
    if (!file) throw new BadRequestException('Attach the file.');
    return this.attribution.upload(actor, clientId, type && /^[a-z0-9_]{2,40}$/.test(type) ? type : null, file);
  }

  @Get('students/:clientId/documents/:documentId')
  async studentDocument(@CurrentUser() actor: AuthUser, @Param('clientId', ParseUUIDPipe) clientId: string, @Param('documentId', ParseUUIDPipe) documentId: string, @Res() res: Response) {
    const d = await this.attribution.download(actor, clientId, documentId);
    sendFile(res, d.stream, d.mime, d.name, 'inline');
  }

  @Get('conflicts')
  conflicts(@CurrentUser() actor: AuthUser) {
    return this.attribution.conflicts(actor, 'all');
  }

  @Get('earnings')
  earningsList(@CurrentUser() actor: AuthUser, @Query() q: Record<string, unknown>) {
    return this.earnings.list(actor, { ...q, partnerId: undefined });
  }

  @Get('payouts')
  payoutList(@CurrentUser() actor: AuthUser) {
    return this.payouts.list(actor, {});
  }

  @Get('payouts/:id')
  payout(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payouts.get(actor, id);
  }

  @Get('payouts/:id/statement')
  async statement(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const s = await this.payouts.statement(actor, id);
    pdf(res, s.pdf, s.name);
  }

  @Get('advances')
  advances(@CurrentUser() actor: AuthUser) {
    return this.payouts.advances(actor);
  }

  @Get('messages')
  messages(@CurrentUser() actor: AuthUser) {
    return this.portal.messages(actor);
  }

  @Post('messages')
  message(@CurrentUser() actor: AuthUser, @Body(zodPipe(partnerMessageSchema)) body: z.input<typeof partnerMessageSchema>) {
    return this.portal.send(actor, body);
  }

  @Get('resources')
  resources(@CurrentUser() actor: AuthUser) {
    return this.portal.resources(actor);
  }

  @Get('resources/:documentId')
  async resource(@CurrentUser() actor: AuthUser, @Param('documentId', ParseUUIDPipe) documentId: string, @Res() res: Response) {
    const f = await this.portal.resourceFile(actor, documentId);
    sendFile(res, f.stream, f.mime, f.name, 'attachment');
  }

  /** A master partner's view of its sub-agents. */
  @Get('sub-agents')
  async subAgents(@CurrentUser() actor: AuthUser) {
    const ctx = await this.partners.context(actor);
    const family = (await this.partners.family(ctx.partner.id)).filter((id) => id !== ctx.partner.id);
    if (!family.length) return [];
    const year = new Date();
    const from = localIsoDate(new Date(year.getTime() - 365 * 86_400_000));
    return this.partners.performance(ctx.partner.tenantId, from, localIsoDate(year), family);
  }
}

/** The public "become a partner" form on the consultancy's own site. */
@Public()
@Controller('public/partners')
export class PartnerApplyController {
  constructor(private readonly partners: PartnersService) {}

  @Get('apply')
  info(@Site() site: ResolvedHost) {
    if (site.kind !== 'tenant') throw new BadRequestException('Apply on the consultancy’s own site.');
    return this.partners.applicationsOpen(site.tenant.id);
  }

  @Post('apply')
  @UseGuards(FormThrottleGuard)
  apply(@Site() site: ResolvedHost, @Body(zodPipe(partnerApplicationSchema)) body: z.input<typeof partnerApplicationSchema>) {
    if (site.kind !== 'tenant') throw new BadRequestException('Apply on the consultancy’s own site.');
    return this.partners.apply(site.tenant.id, body);
  }
}

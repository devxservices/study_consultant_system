import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
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
  type RawBodyRequest,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { z } from 'zod';
import {
  UPLOAD_CEILING_MB,
  approveInvoiceSchema,
  convertQuoteSchema,
  createInvoiceSchema,
  creditNoteSchema,
  decideSchema,
  installmentPlanSchema,
  listInvoicesQuerySchema,
  quoteDecisionSchema,
  quoteSchema,
  recordPaymentSchema,
  refundRequestSchema,
  rejectInvoiceSchema,
  reviewSubmissionSchema,
  servicePackageSchema,
  startOnlinePaymentSchema,
  submitPaymentSchema,
  voidSchema,
  type AuthUser,
  type ListInvoicesQuery,
  type ServicePackageInput,
} from '@crm/shared';
import { zodPipe } from '../common/zod.pipe';
import { CurrentUser, Public, Roles } from '../auth/auth.guard';
import { RequiresModule } from '../tenancy/entitlements.service';
import { RequirePermission } from '../auth/permissions';
import { sendFile } from '../documents/documents.controller';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { isProd } from '../config/env';
import { BillingService } from './billing.service';
import { FinanceSettingsService } from '../finance/finance-settings.service';
import { QuotesService } from '../finance/quotes.service';
import { SubmissionsService } from '../finance/submissions.service';
import { OnlinePaymentsService } from '../finance/online-payments.service';
import { RefundsService } from '../finance/refunds.service';

const uuid = /^[0-9a-f-]{36}$/i;
const optionalUuid = (v?: string) => (v && uuid.test(v) ? v : undefined);
const statementQuery = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

interface UploadedFileLike {
  buffer: Buffer;
  originalname: string;
  size: number;
}

function sendPdf(res: Response, file: { file: Buffer; name: string }, disposition: 'inline' | 'attachment' = 'inline') {
  sendFile(res, Readable.from(file.file), 'application/pdf', file.name, disposition);
}

/**
 * Invoices, payments and everything a student sees about money. Clients
 * reach the read routes - each service scopes them to their own records -
 * and the few things a student does themselves (accept a quote, upload
 * proof, pay online); every other write is staff-only, with the permission
 * named on the route and checked again in the service.
 */
@RequiresModule('billing')
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly settings: FinanceSettingsService,
    private readonly quotes: QuotesService,
    private readonly submissions: SubmissionsService,
    private readonly online: OnlinePaymentsService,
    private readonly refunds: RefundsService,
  ) {}

  /* ------------------------------ fee catalogue ------------------------------ */

  @Roles('consultant', 'manager')
  @Get('packages')
  packages(@CurrentUser() actor: AuthUser, @Query('all') all?: string) {
    return this.billing.packages(actor, all === 'true');
  }

  @Roles('consultant', 'manager')
  @RequirePermission('finance.settings')
  @Post('packages')
  createPackage(@CurrentUser() actor: AuthUser, @Body(zodPipe(servicePackageSchema)) body: ServicePackageInput) {
    return this.billing.savePackage(actor, body);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('finance.settings')
  @Patch('packages/:id')
  updatePackage(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(servicePackageSchema)) body: ServicePackageInput) {
    return this.billing.savePackage(actor, body, id);
  }

  /** How this consultancy can be paid - what a student's invoice page offers. */
  @Get('payment-options')
  async paymentOptions(@CurrentUser() actor: AuthUser) {
    const tenantId = tenantOf(actor);
    const [gateway, row] = await Promise.all([this.settings.gatewayFor(tenantId), this.settings.row(tenantId)]);
    const online = gateway.provider === 'stripe' ? Boolean(gateway.stripeSecretKey) : gateway.provider === 'test' && !isProd();
    return { online, provider: online ? gateway.provider : 'none', bankDetails: row.bankDetails, baseCurrency: row.baseCurrency, directRefunds: row.directRefunds };
  }

  /** Active tax rates, for the invoice and quote forms. */
  @Roles('consultant', 'manager')
  @Get('taxes')
  taxes(@CurrentUser() actor: AuthUser) {
    return this.settings.taxes(actor, false);
  }

  /** Checks a promotion code for the invoice form, before anything is issued. */
  @Roles('consultant', 'manager')
  @RequirePermission('billing.invoice')
  @Get('promo/:code')
  async promo(@CurrentUser() actor: AuthUser, @Param('code') code: string, @Query('currency') currency = 'PKR') {
    const p = await this.settings.resolvePromo(tenantOf(actor), code, currency);
    return { code: p.code, kind: p.kind, value: p.value };
  }

  /* ------------------------------ invoices ------------------------------ */

  @RequirePermission('billing.view')
  @Get('invoices')
  list(@CurrentUser() actor: AuthUser, @Query(zodPipe(listInvoicesQuerySchema)) query: ListInvoicesQuery) {
    return this.billing.list(actor, query);
  }

  @RequirePermission('billing.view')
  @Get('invoices/:id')
  get(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.billing.get(actor, id);
  }

  @RequirePermission('billing.view')
  @Get('invoices/:id/pdf')
  async invoicePdf(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response, @Query('download') download?: string) {
    sendPdf(res, await this.billing.invoicePdf(actor, id), download === '1' ? 'attachment' : 'inline');
  }

  @Roles('consultant', 'manager')
  @RequirePermission('billing.invoice')
  @Post('invoices')
  create(@CurrentUser() actor: AuthUser, @Body(zodPipe(createInvoiceSchema)) body: z.input<typeof createInvoiceSchema>) {
    return this.billing.create(actor, body);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('billing.approve')
  @Post('invoices/:id/approve')
  approve(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(approveInvoiceSchema)) body: { note: string | null }) {
    return this.billing.approve(actor, id, body.note);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('billing.approve')
  @Post('invoices/:id/reject')
  reject(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(rejectInvoiceSchema)) body: { reason: string }) {
    return this.billing.rejectPending(actor, id, body.reason);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('billing.approve')
  @Post('invoices/:id/void')
  voidInvoice(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(voidSchema)) body: { reason: string }) {
    return this.billing.voidInvoice(actor, id, body.reason);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('billing.invoice')
  @Put('invoices/:id/installments')
  installments(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(installmentPlanSchema)) body: z.input<typeof installmentPlanSchema>) {
    return this.billing.setInstallments(actor, id, body);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('billing.view')
  @Post('invoices/:id/email')
  email(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.billing.emailInvoice(actor, id);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('billing.approve')
  @Post('invoices/:id/credit-notes')
  creditNote(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(creditNoteSchema)) body: z.input<typeof creditNoteSchema>) {
    return this.billing.creditNote(actor, id, body);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('billing.approve')
  @Post('credit-notes/:id/void')
  voidCreditNote(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(voidSchema)) body: { reason: string }) {
    return this.billing.voidCreditNote(actor, id, body.reason);
  }

  /* ------------------------------ payments ------------------------------ */

  @Roles('consultant', 'manager')
  @RequirePermission('billing.payment')
  @Post('invoices/:id/payments')
  record(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(recordPaymentSchema)) body: z.input<typeof recordPaymentSchema>) {
    return this.billing.record(actor, id, body);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('billing.approve')
  @Post('payments/:id/void')
  voidPayment(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(voidSchema)) body: { reason: string }) {
    return this.billing.voidPayment(actor, id, body.reason);
  }

  @RequirePermission('billing.view')
  @Get('payments')
  payments(@CurrentUser() actor: AuthUser, @Query('clientId') clientId?: string, @Query('limit') limit?: string) {
    return this.billing.ledger(actor, { clientId: optionalUuid(clientId), limit: Math.min(200, Math.max(1, Number(limit) || 50)) });
  }

  @RequirePermission('billing.view')
  @Get('payments/:id/receipt')
  receipt(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.billing.receipt(actor, id);
  }

  @RequirePermission('billing.view')
  @Get('payments/:id/pdf')
  async receiptPdf(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response, @Query('download') download?: string) {
    sendPdf(res, await this.billing.receiptPdf(actor, id), download === '1' ? 'attachment' : 'inline');
  }

  @RequirePermission('billing.view')
  @Get('totals')
  totals(@CurrentUser() actor: AuthUser, @Query('clientId') clientId?: string) {
    return this.billing.totals(actor, optionalUuid(clientId));
  }

  @Roles('consultant', 'manager')
  @RequirePermission('billing.view')
  @Get('revenue')
  revenue(@CurrentUser() actor: AuthUser, @Query('months') months?: string) {
    return this.billing.revenue(actor, Number(months) || 6);
  }

  /* ------------------------------ statements ------------------------------ */

  /** A student's own statement. */
  @Roles('client')
  @Get('statement')
  myStatement(@CurrentUser() actor: AuthUser, @Query(zodPipe(statementQuery)) q: z.output<typeof statementQuery>) {
    return this.billing.statement(actor, actor.clientId ?? '', q);
  }

  @Roles('client')
  @Get('statement/pdf')
  async myStatementPdf(@CurrentUser() actor: AuthUser, @Query(zodPipe(statementQuery)) q: z.output<typeof statementQuery>, @Res() res: Response) {
    sendPdf(res, await this.billing.statementPdf(actor, actor.clientId ?? '', q));
  }

  @Roles('consultant', 'manager')
  @RequirePermission('billing.view')
  @Get('clients/:clientId/statement')
  statement(@CurrentUser() actor: AuthUser, @Param('clientId', ParseUUIDPipe) clientId: string, @Query(zodPipe(statementQuery)) q: z.output<typeof statementQuery>) {
    return this.billing.statement(actor, clientId, q);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('billing.view')
  @Get('clients/:clientId/statement/pdf')
  async statementPdf(
    @CurrentUser() actor: AuthUser,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Query(zodPipe(statementQuery)) q: z.output<typeof statementQuery>,
    @Res() res: Response,
  ) {
    sendPdf(res, await this.billing.statementPdf(actor, clientId, q));
  }

  /* ------------------------------ refunds ------------------------------ */

  @Roles('consultant', 'manager')
  @RequirePermission('billing.refund')
  @Post('invoices/:id/refund-requests')
  requestRefund(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(refundRequestSchema)) body: z.input<typeof refundRequestSchema>) {
    return this.refunds.request(actor, id, body);
  }

  @Roles('consultant', 'manager')
  @Get('refund-requests')
  refundRequests(@CurrentUser() actor: AuthUser, @Query('status') status?: string) {
    return this.refunds.list(actor, status);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('billing.approve')
  @Post('refund-requests/:id/decide')
  decideRefund(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(decideSchema)) body: z.input<typeof decideSchema>) {
    return this.refunds.decide(actor, id, body);
  }

  @Roles('consultant', 'manager')
  @Post('refund-requests/:id/cancel')
  cancelRefund(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.refunds.cancel(actor, id);
  }

  /* ------------------------------ quotes ------------------------------ */

  @RequirePermission('billing.view')
  @Get('quotes')
  listQuotes(@CurrentUser() actor: AuthUser, @Query('status') status?: string, @Query('clientId') clientId?: string, @Query('page') pageNo?: string) {
    return this.quotes.list(actor, { status, clientId: optionalUuid(clientId), page: Number(pageNo) || 1 });
  }

  @Roles('consultant', 'manager')
  @RequirePermission('billing.invoice')
  @Post('quotes')
  createQuote(@CurrentUser() actor: AuthUser, @Body(zodPipe(quoteSchema)) body: z.input<typeof quoteSchema>) {
    return this.quotes.create(actor, body);
  }

  @RequirePermission('billing.view')
  @Get('quotes/:id')
  getQuote(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.get(actor, id);
  }

  @RequirePermission('billing.view')
  @Get('quotes/:id/pdf')
  async quotePdf(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    sendPdf(res, await this.quotes.pdfFor(actor, id));
  }

  @Roles('consultant', 'manager')
  @RequirePermission('billing.invoice')
  @Post('quotes/:id/send')
  sendQuote(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.send(actor, id);
  }

  @RequirePermission('billing.invoice')
  @Post('quotes/:id/accept')
  acceptQuote(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(quoteDecisionSchema)) body: { note: string | null }) {
    return this.quotes.decide(actor, id, true, body.note);
  }

  @RequirePermission('billing.invoice')
  @Post('quotes/:id/decline')
  declineQuote(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(quoteDecisionSchema)) body: { note: string | null }) {
    return this.quotes.decide(actor, id, false, body.note);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('billing.invoice')
  @Post('quotes/:id/convert')
  convertQuote(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(convertQuoteSchema)) body: z.input<typeof convertQuoteSchema>) {
    return this.quotes.convert(actor, id, body);
  }

  /* ------------------------------ proof of payment ------------------------------ */

  /** A student's "I have paid", with the slip or screenshot. */
  @Roles('client')
  @Post('invoices/:id/submissions')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_CEILING_MB * 1024 * 1024, files: 1 } }))
  submit(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body() body: Record<string, string>,
  ) {
    if (!file) throw new BadRequestException({ message: 'Attach the bank slip or a screenshot of the transfer.', fieldErrors: { file: 'Attach the proof' } });
    const input = zodPipe(submitPaymentSchema).transform({
      amount: body.amount,
      method: body.method,
      reference: body.reference || undefined,
      paidOn: body.paidOn,
      note: body.note || undefined,
    });
    return this.submissions.submit(actor, id, input, file);
  }

  @Get('submissions')
  listSubmissions(@CurrentUser() actor: AuthUser, @Query('status') status?: string) {
    return this.submissions.list(actor, status);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('billing.verify')
  @Post('submissions/:id/review')
  review(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(reviewSubmissionSchema)) body: z.input<typeof reviewSubmissionSchema>) {
    return this.submissions.review(actor, id, body);
  }

  /* ------------------------------ paying online ------------------------------ */

  @Roles('client')
  @Post('invoices/:id/pay-online')
  payOnline(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(startOnlinePaymentSchema)) body: z.input<typeof startOnlinePaymentSchema>) {
    return this.online.start(actor, id, body);
  }

  @RequirePermission('billing.view')
  @Get('online')
  onlineList(@CurrentUser() actor: AuthUser, @Query('invoiceId') invoiceId?: string) {
    return this.online.list(actor, optionalUuid(invoiceId));
  }

  @RequirePermission('billing.view')
  @Get('online/:id')
  onlineGet(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.online.get(actor, id);
  }

  /** The simulated provider's buttons (development and demos only). */
  @Roles('client')
  @Post('online/:id/test')
  testDecision(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(z.object({ pay: z.boolean() }))) body: { pay: boolean }) {
    return this.online.testDecision(actor, id, body.pay);
  }

  /**
   * Stripe's webhook, per consultancy. Public - Stripe has no session - and
   * trusted only through the signature made with that consultancy's secret.
   */
  @Public()
  @HttpCode(200)
  @Post('online/stripe/:tenantId/webhook')
  stripeWebhook(@Param('tenantId') tenantId: string, @Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature?: string) {
    return this.online.stripeWebhook(tenantId, req.rawBody, signature);
  }
}

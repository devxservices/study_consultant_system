import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import {
  REPORTS,
  UPLOAD_CEILING_MB,
  bankEntrySchema,
  bankImportSchema,
  billSchema,
  dayCloseSchema,
  expenseSchema,
  exportJournalSchema,
  financeSettingsSchema,
  gatewaySettingsSchema,
  journalQuerySchema,
  ledgerAccountSchema,
  manualJournalSchema,
  matchBankLineSchema,
  payBillSchema,
  periodLockSchema,
  promoCodeSchema,
  reportQuerySchema,
  taxRateSchema,
  voidSchema,
  type AuthUser,
  type ExportJournalInput,
  type JournalQuery,
  type ReportName,
  type ReportQuery,
} from '@crm/shared';
import { zodPipe } from '../common/zod.pipe';
import { CurrentUser, Roles } from '../auth/auth.guard';
import { RequirePermission, staffCan } from '../auth/permissions';
import { RequiresModule } from '../tenancy/entitlements.service';
import { sendFile } from '../documents/documents.controller';
import { FinanceSettingsService } from './finance-settings.service';
import { LedgerService } from './ledger.service';
import { SpendingService } from './spending.service';
import { BankService } from './bank.service';
import { ReportsService } from './reports.service';
import { Readable } from 'node:stream';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ledgerRange = z.object({ from: dateOnly.optional(), to: dateOnly.optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional() });
const reasonBody = z.object({ reason: z.string().trim().min(5, 'Say why').max(500) });

/**
 * The accountant's workspace: settings, the books, spending, the bank and
 * reports. Every route names the permission it needs; the services check
 * it again. Managers hold them all.
 */
@RequiresModule('billing')
@Roles('consultant', 'manager')
@Controller('finance')
export class FinanceController {
  constructor(
    private readonly settings: FinanceSettingsService,
    private readonly ledger: LedgerService,
    private readonly spending: SpendingService,
    private readonly bank: BankService,
    private readonly reports: ReportsService,
  ) {}

  @Get('overview')
  overview(@CurrentUser() actor: AuthUser) {
    return this.reports.overview(actor);
  }

  /* ------------------------------ settings ------------------------------ */

  @Get('settings')
  getSettings(@CurrentUser() actor: AuthUser) {
    return this.settings.view(actor);
  }

  @RequirePermission('finance.settings')
  @Put('settings')
  saveSettings(@CurrentUser() actor: AuthUser, @Body(zodPipe(financeSettingsSchema)) body: z.input<typeof financeSettingsSchema>) {
    return this.settings.save(actor, body);
  }

  @RequirePermission('finance.settings')
  @Put('settings/gateway')
  saveGateway(@CurrentUser() actor: AuthUser, @Body(zodPipe(gatewaySettingsSchema)) body: z.input<typeof gatewaySettingsSchema>) {
    return this.settings.saveGateway(actor, body);
  }

  @RequirePermission('finance.ledger')
  @Post('lock')
  lock(@CurrentUser() actor: AuthUser, @Body(zodPipe(periodLockSchema)) body: { through: string | null }) {
    return this.settings.lock(actor, body.through);
  }

  @Get('taxes')
  taxes(@CurrentUser() actor: AuthUser) {
    return this.settings.taxes(actor, true);
  }

  @RequirePermission('finance.settings')
  @Post('taxes')
  addTax(@CurrentUser() actor: AuthUser, @Body(zodPipe(taxRateSchema)) body: z.input<typeof taxRateSchema>) {
    return this.settings.saveTax(actor, body);
  }

  @RequirePermission('finance.settings')
  @Put('taxes/:id')
  saveTax(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(taxRateSchema)) body: z.input<typeof taxRateSchema>) {
    return this.settings.saveTax(actor, body, id);
  }

  @RequirePermission('finance.settings')
  @Get('promos')
  promos(@CurrentUser() actor: AuthUser) {
    return this.settings.promos(actor);
  }

  @RequirePermission('finance.settings')
  @Post('promos')
  addPromo(@CurrentUser() actor: AuthUser, @Body(zodPipe(promoCodeSchema)) body: z.input<typeof promoCodeSchema>) {
    return this.settings.savePromo(actor, body);
  }

  @RequirePermission('finance.settings')
  @Put('promos/:id')
  savePromo(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(promoCodeSchema)) body: z.input<typeof promoCodeSchema>) {
    return this.settings.savePromo(actor, body, id);
  }

  /* ------------------------------ accounts and the journal ------------------------------ */

  /**
   * The accounts, for pickers (where money went in, what an expense was for).
   * Balances only for those who may see the books.
   */
  @Get('account-options')
  async accountOptions(@CurrentUser() actor: AuthUser) {
    const all = await this.ledger.accounts(actor);
    return all.map((a) => ({ ...a, balances: staffCan(actor, 'finance.ledger') ? a.balances : [] }));
  }

  @RequirePermission('finance.ledger')
  @Get('accounts')
  accounts(@CurrentUser() actor: AuthUser, @Query('all') all?: string, @Query('asOf') asOf?: string) {
    return this.ledger.accounts(actor, { includeInactive: all === 'true', asOf: asOf && dateOnly.safeParse(asOf).success ? asOf : undefined });
  }

  @RequirePermission('finance.ledger')
  @Post('accounts')
  addAccount(@CurrentUser() actor: AuthUser, @Body(zodPipe(ledgerAccountSchema)) body: z.input<typeof ledgerAccountSchema>) {
    return this.ledger.saveAccount(actor, body);
  }

  @RequirePermission('finance.ledger')
  @Put('accounts/:id')
  saveAccount(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(ledgerAccountSchema)) body: z.input<typeof ledgerAccountSchema>) {
    return this.ledger.saveAccount(actor, body, id);
  }

  @RequirePermission('finance.ledger')
  @Get('accounts/:id/ledger')
  generalLedger(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query(zodPipe(ledgerRange)) q: z.output<typeof ledgerRange>) {
    return this.ledger.generalLedger(actor, id, q);
  }

  @RequirePermission('finance.ledger')
  @Get('journal')
  journal(@CurrentUser() actor: AuthUser, @Query(zodPipe(journalQuerySchema)) q: JournalQuery) {
    return this.ledger.journal(actor, q);
  }

  @RequirePermission('finance.ledger')
  @Get('journal/:id')
  entry(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.ledger.entry(actor, id);
  }

  @RequirePermission('finance.ledger')
  @Post('journal')
  manual(@CurrentUser() actor: AuthUser, @Body(zodPipe(manualJournalSchema)) body: z.input<typeof manualJournalSchema>) {
    return this.ledger.manual(actor, body);
  }

  @RequirePermission('finance.ledger')
  @Post('journal/:id/reverse')
  reverse(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(reasonBody)) body: { reason: string }) {
    return this.ledger.reverse(actor, id, body.reason);
  }

  /* ------------------------------ expenses and bills ------------------------------ */

  @RequirePermission('finance.expenses')
  @Get('expenses')
  expenses(@CurrentUser() actor: AuthUser, @Query() q: Record<string, string | undefined>) {
    return this.spending.expenses(actor, {
      from: q.from && dateOnly.safeParse(q.from).success ? q.from : undefined,
      to: q.to && dateOnly.safeParse(q.to).success ? q.to : undefined,
      accountId: q.accountId && /^[0-9a-f-]{36}$/i.test(q.accountId) ? q.accountId : undefined,
      q: q.q?.slice(0, 80),
      page: Number(q.page) || 1,
    });
  }

  /** JSON, or multipart with a receipt file and the same fields as text. */
  @RequirePermission('finance.expenses')
  @Post('expenses')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_CEILING_MB * 1024 * 1024, files: 1 } }))
  recordExpense(
    @CurrentUser() actor: AuthUser,
    @Body() body: Record<string, unknown>,
    @UploadedFile() file?: { buffer: Buffer; originalname: string; size: number },
  ) {
    const fields = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== '' && v !== null && v !== undefined));
    const input = zodPipe(expenseSchema).transform(fields);
    return this.spending.recordExpense(actor, input, file);
  }

  @RequirePermission('finance.expenses')
  @Post('expenses/:id/void')
  voidExpense(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(voidSchema)) body: { reason: string }) {
    return this.spending.voidExpense(actor, id, body.reason);
  }

  @RequirePermission('finance.expenses')
  @Get('expenses/:id/receipt')
  async expenseReceipt(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const r = await this.spending.receipt(actor, id);
    sendFile(res, r.stream, r.mime, r.name, 'inline');
  }

  @RequirePermission('finance.expenses')
  @Get('bills')
  bills(@CurrentUser() actor: AuthUser, @Query('status') status?: string, @Query('q') q?: string) {
    return this.spending.bills(actor, { status, q: q?.slice(0, 80) });
  }

  @RequirePermission('finance.expenses')
  @Post('bills')
  saveBill(@CurrentUser() actor: AuthUser, @Body(zodPipe(billSchema)) body: z.input<typeof billSchema>) {
    return this.spending.saveBill(actor, body);
  }

  @RequirePermission('finance.expenses')
  @Post('bills/:id/pay')
  payBill(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(payBillSchema)) body: z.input<typeof payBillSchema>) {
    return this.spending.payBill(actor, id, body);
  }

  @RequirePermission('finance.expenses')
  @Post('bills/:id/void')
  voidBill(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(voidSchema)) body: { reason: string }) {
    return this.spending.voidBill(actor, id, body.reason);
  }

  /* ------------------------------ the bank and the cash ------------------------------ */

  @RequirePermission('finance.ledger')
  @Get('bank/:accountId')
  bankView(@CurrentUser() actor: AuthUser, @Param('accountId', ParseUUIDPipe) accountId: string, @Query('currency') currency?: string) {
    return this.bank.view(actor, accountId, currency && /^[A-Z]{3}$/.test(currency) ? currency : undefined);
  }

  @RequirePermission('finance.ledger')
  @Post('bank/:accountId/import')
  bankImport(@CurrentUser() actor: AuthUser, @Param('accountId', ParseUUIDPipe) accountId: string, @Body(zodPipe(bankImportSchema)) body: z.input<typeof bankImportSchema>) {
    return this.bank.import(actor, accountId, body);
  }

  @RequirePermission('finance.ledger')
  @Post('bank/lines/:id/match')
  async match(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(matchBankLineSchema)) body: { journalLineId: string }) {
    await this.bank.match(actor, id, body.journalLineId);
    return { ok: true };
  }

  @RequirePermission('finance.ledger')
  @Post('bank/lines/:id/unmatch')
  async unmatch(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.bank.unmatch(actor, id);
    return { ok: true };
  }

  @RequirePermission('finance.ledger')
  @Post('bank/lines/:id/entry')
  async entryFromLine(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(bankEntrySchema)) body: z.input<typeof bankEntrySchema>) {
    await this.bank.entryFromLine(actor, id, body);
    return { ok: true };
  }

  @RequirePermission('finance.ledger')
  @Delete('bank/imports/:id')
  async removeImport(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.bank.removeImport(actor, id);
    return { ok: true };
  }

  @RequirePermission('finance.ledger')
  @Get('day-close')
  dayCloses(@CurrentUser() actor: AuthUser, @Query('accountId') accountId?: string) {
    return this.bank.dayCloses(actor, accountId && /^[0-9a-f-]{36}$/i.test(accountId) ? accountId : undefined);
  }

  @RequirePermission('finance.ledger')
  @Get('day-close/expected')
  async expected(@CurrentUser() actor: AuthUser, @Query('accountId') accountId: string, @Query('date') date: string, @Query('currency') currency: string) {
    if (!/^[0-9a-f-]{36}$/i.test(accountId ?? '') || !dateOnly.safeParse(date).success || !/^[A-Z]{3}$/.test(currency ?? '')) {
      throw new BadRequestException('accountId, date and currency are needed.');
    }
    return { expected: await this.bank.expectedCash(actor, accountId, date, currency) };
  }

  @RequirePermission('finance.ledger')
  @Post('day-close')
  closeDay(@CurrentUser() actor: AuthUser, @Body(zodPipe(dayCloseSchema)) body: z.input<typeof dayCloseSchema>) {
    return this.bank.closeDay(actor, body);
  }

  /* ------------------------------ reports and exports ------------------------------ */

  @RequirePermission('finance.ledger')
  @Get('reports/:name')
  async report(@CurrentUser() actor: AuthUser, @Param('name') name: string, @Query(zodPipe(reportQuerySchema)) q: ReportQuery, @Res() res: Response) {
    if (!(REPORTS as readonly string[]).includes(name)) throw new BadRequestException('Unknown report.');
    const r = await this.reports.report(actor, name as ReportName, q);
    if (q.format === 'csv') {
      const csv = this.reports.toCsv(r);
      sendFile(res, Readable.from(Buffer.from(csv, 'utf8')), 'text/csv; charset=utf-8', `${name}-${r.to}.csv`, 'attachment');
      return;
    }
    res.json(r);
  }

  @RequirePermission('finance.ledger', 'data.export')
  @Get('export/journal')
  async exportJournal(@CurrentUser() actor: AuthUser, @Query(zodPipe(exportJournalSchema)) q: ExportJournalInput, @Res() res: Response) {
    const file = await this.reports.exportJournal(actor, q);
    sendFile(res, Readable.from(Buffer.from(file.body, 'utf8')), file.contentType, file.fileName, 'attachment');
  }
}

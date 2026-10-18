import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { FinanceController } from '../finance/finance.controller';
import { FinanceSettingsService } from '../finance/finance-settings.service';
import { LedgerService } from '../finance/ledger.service';
import { PdfService } from '../finance/pdf.service';
import { QuotesService } from '../finance/quotes.service';
import { SubmissionsService } from '../finance/submissions.service';
import { OnlinePaymentsService } from '../finance/online-payments.service';
import { RefundsService } from '../finance/refunds.service';
import { SpendingService } from '../finance/spending.service';
import { BankService } from '../finance/bank.service';
import { ReportsService } from '../finance/reports.service';
import { FinanceRemindersService } from '../finance/finance-reminders.service';

/**
 * Money: invoices and payments (billing/) and the books under them
 * (finance/). One module, because every part posts to the same journal.
 * Commissions and partner payouts post to it too, through LedgerService.
 */
@Module({
  imports: [DocumentsModule],
  controllers: [BillingController, FinanceController],
  providers: [
    BillingService,
    FinanceSettingsService,
    LedgerService,
    PdfService,
    QuotesService,
    SubmissionsService,
    OnlinePaymentsService,
    RefundsService,
    SpendingService,
    BankService,
    ReportsService,
    FinanceRemindersService,
  ],
  exports: [BillingService, LedgerService, FinanceSettingsService, ReportsService, PdfService],
})
export class BillingModule {}

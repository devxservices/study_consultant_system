import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { CasesModule } from '../cases/cases.module';
import { DocumentsModule } from '../documents/documents.module';
import { InstitutionsService } from './institutions.service';
import { CommissionsService } from './commissions.service';
import { ClaimsService } from './claims.service';
import { CaseCommissionsController, ClaimsController, CommissionsController, InstitutionsController } from './commissions.controller';

/**
 * University commissions and the institution catalogue. Claims come before
 * commissions in the list: their fixed paths (/commissions/claims...) must
 * be registered ahead of /commissions/:id.
 */
@Module({
  imports: [BillingModule, CasesModule, DocumentsModule],
  controllers: [InstitutionsController, CaseCommissionsController, ClaimsController, CommissionsController],
  providers: [InstitutionsService, CommissionsService, ClaimsService],
  exports: [InstitutionsService, CommissionsService],
})
export class CommissionsModule {}

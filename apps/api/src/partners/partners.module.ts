import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { CasesModule } from '../cases/cases.module';
import { DocumentsModule } from '../documents/documents.module';
import { CommissionsModule } from '../commissions/commissions.module';
import { PartnersService } from './partners.service';
import { PartnerAgreementsService } from './agreements.service';
import { AttributionService } from './attribution.service';
import { PartnerEarningsService } from './earnings.service';
import { PayoutsService } from './payouts.service';
import { PartnerPortalService } from './portal.service';
import { FormThrottleGuard } from './form-throttle.guard';
import { PartnerApplyController, PartnerPortalController, PartnersController } from './partners.controller';

/**
 * Partner consultants: the partners themselves, their agreements, the
 * students they bring, what they earn (hearing commission and payment
 * events from the modules that own that money), and their payouts.
 */
@Module({
  imports: [BillingModule, CasesModule, DocumentsModule, CommissionsModule],
  controllers: [PartnersController, PartnerPortalController, PartnerApplyController],
  providers: [PartnersService, PartnerAgreementsService, AttributionService, PartnerEarningsService, PayoutsService, PartnerPortalService, FormThrottleGuard],
  exports: [PartnersService],
})
export class PartnersModule {}

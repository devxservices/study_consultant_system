import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  addDomainSchema,
  changeTenantStatusSchema,
  planSchema,
  platformBillingSchema,
  platformLegalSchema,
  subscriptionPaymentSchema,
  tenantSubscriptionSchema,
  type PlatformBilling,
  type PlatformLegal,
  type SubscriptionPaymentInput,
  type PlanInput,
  type TenantSubscriptionInput,
  createTenantSchema,
  updateTenantSchema,
  type AddDomainInput,
  type AuthUser,
  type ChangeTenantStatusInput,
  type CreateTenantInput,
  type PlatformReadiness,
  type UpdateTenantInput,
} from '@crm/shared';
import { zodPipe } from '../common/zod.pipe';
import { CurrentUser, Roles } from '../auth/auth.guard';
import { TenantsService } from './tenants.service';
import { tenancyConfig } from './tenant-resolver.service';
import { configuredAddresses } from './domain-dns';
import { env } from '../config/env';
import { PlansService } from './plans.service';
import { MfaService } from '../auth/mfa.service';
import { PlatformSettingsService } from './platform-settings.service';
import { SubscriptionsService } from './subscriptions.service';

/**
 * The platform admin's view of consultancies. Every route here is
 * super-admin-only, and no consultancy user can reach any of it.
 */
@Roles('super_admin')
@Controller('admin/tenants')
export class AdminTenantsController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly plans: PlansService,
    private readonly mfa: MfaService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  /**
   * An owner locked out of their own consultancy - phone lost, recovery codes
   * lost. Managers only: anyone else is reset by their own manager.
   */
  @Post(':id/managers/:userId/mfa/reset')
  @HttpCode(204)
  async resetManagerMfa(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    await this.mfa.resetFor(actor, userId, id, ['manager']);
  }

  /** A manager who cannot get in (or never set a password): a link to choose one, emailed and returned. */
  @Post(':id/managers/:userId/password-link')
  @HttpCode(200)
  managerPasswordLink(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.tenants.managerPasswordLink(actor, id, userId);
  }

  @Get()
  list() {
    return this.tenants.list();
  }

  @Post()
  create(@CurrentUser() actor: AuthUser, @Body(zodPipe(createTenantSchema)) body: CreateTenantInput) {
    return this.tenants.create(actor, body);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenants.get(id);
  }

  @Patch(':id')
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateTenantSchema)) body: UpdateTenantInput,
  ) {
    return this.tenants.update(actor, id, body);
  }

  @Post(':id/status')
  changeStatus(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(changeTenantStatusSchema)) body: ChangeTenantStatusInput,
  ) {
    return this.tenants.changeStatus(actor, id, body);
  }

  /** Which plan the consultancy is on, and whether it is paid up. */
  @Post(':id/subscription')
  async setSubscription(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(tenantSubscriptionSchema)) body: TenantSubscriptionInput,
  ) {
    await this.plans.setSubscription(actor, id, body);
    return this.tenants.get(id);
  }

  /** Payments received from this consultancy for the platform, newest first. */
  @Get(':id/payments')
  payments(@Param('id', ParseUUIDPipe) id: string) {
    return this.subscriptions.payments(id);
  }

  /** A payment received: it moves the paid-until date on, and the managers get a receipt. */
  @Post(':id/payments')
  async recordPayment(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(subscriptionPaymentSchema)) body: SubscriptionPaymentInput,
  ) {
    await this.subscriptions.recordPayment(actor, id, body);
    return this.tenants.get(id);
  }

  @Post(':id/logo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 1024 * 1024, files: 1 } }))
  setLogo(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
  ) {
    if (!file) {
      throw new BadRequestException({
        message: 'No file was received.',
        fieldErrors: { file: 'Choose an image to upload.' },
      });
    }
    return this.tenants.setLogo(actor, id, file);
  }

  @Delete(':id/logo')
  removeLogo(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tenants.removeLogo(actor, id);
  }

  @Post(':id/domains')
  addDomain(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(addDomainSchema)) body: AddDomainInput,
  ) {
    return this.tenants.addDomain(actor, id, body);
  }

  @Post(':id/domains/:domainId/verify')
  verifyDomain(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('domainId', ParseUUIDPipe) domainId: string,
  ) {
    return this.tenants.verifyDomain(actor, id, domainId);
  }

  @Delete(':id/domains/:domainId')
  removeDomain(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('domainId', ParseUUIDPipe) domainId: string,
  ) {
    return this.tenants.removeDomain(actor, id, domainId);
  }
}

/** The addressing scheme, so the admin forms can show a consultancy's address as it is typed. */
@Roles('super_admin')
@Controller('admin/platform')
export class AdminPlatformController {
  constructor(private readonly settings: PlatformSettingsService) {}

  @Get()
  config() {
    const { platformDomain, adminHost } = tenancyConfig();
    return { platformDomain, adminHost };
  }

  /**
   * Is the platform ready for real people? What each external service is
   * set to, in the words the launch guide uses. Settings only - no secrets.
   */
  /** How consultancies pay for the platform, and the published terms and privacy policy. */
  @Get('settings')
  getSettings() {
    return this.settings.view();
  }

  @Put('settings/billing')
  setBilling(@CurrentUser() actor: AuthUser, @Body(zodPipe(platformBillingSchema)) body: PlatformBilling) {
    return this.settings.setBilling(actor, body);
  }

  @Put('settings/legal')
  setLegal(@CurrentUser() actor: AuthUser, @Body(zodPipe(platformLegalSchema)) body: PlatformLegal) {
    return this.settings.setLegal(actor, body);
  }

  @Get('readiness')
  async readiness(): Promise<PlatformReadiness> {
    const e = env();
    const { billing, legal } = await this.settings.view();
    const prod = e.NODE_ENV === 'production';
    const ips = configuredAddresses();
    return {
      checks: [
        { key: 'mode', ok: prod, label: 'Production mode', detail: prod ? 'NODE_ENV=production' : `NODE_ENV=${e.NODE_ENV}: session cookies are not marked secure and production checks are off` },
        { key: 'domain', ok: e.PLATFORM_DOMAIN !== 'localhost', label: 'Platform domain', detail: e.PLATFORM_DOMAIN === 'localhost' ? 'PLATFORM_DOMAIN is localhost: only this computer can reach it' : `Consultancies live at <name>.${e.PLATFORM_DOMAIN}, the admin at ${tenancyConfig().adminHost}` },
        { key: 'database', ok: Boolean(process.env.DATABASE_URL), label: 'Database', detail: process.env.DATABASE_URL ? 'PostgreSQL (DATABASE_URL)' : 'Embedded development database: one process, no backups. Set DATABASE_URL' },
        { key: 'email', ok: e.MAIL_DRIVER === 'smtp', label: 'Email', detail: e.MAIL_DRIVER === 'smtp' ? `Sent through ${e.SMTP_HOST ?? 'SMTP'} as ${e.MAIL_FROM}` : 'MAIL_DRIVER=log: password resets and invitations are NOT sent. Set up SMTP' },
        { key: 'ip', ok: ips.length > 0, label: 'Server address for root domains', detail: ips.length ? `A records point to ${ips.join(', ')}` : 'PUBLIC_IP is not set: consultancies using a root domain (example.com) are not told where to point it' },
        { key: 'files', ok: e.STORAGE_DRIVER === 's3' || Boolean(e.STORAGE_ENCRYPTION_KEY), label: 'File storage', detail: e.STORAGE_DRIVER === 's3' ? `S3 bucket ${e.S3_BUCKET ?? ''}` : e.STORAGE_ENCRYPTION_KEY ? 'Server disk, encrypted' : 'Server disk, key derived from JWT_SECRET: set STORAGE_ENCRYPTION_KEY' },
        { key: 'scan', ok: e.VIRUS_SCAN === 'clamav', label: 'Virus scanning', detail: e.VIRUS_SCAN === 'clamav' ? `ClamAV at ${e.CLAMAV_HOST}:${e.CLAMAV_PORT}` : 'Off: uploads are checked by type only. Optional, recommended' },
        { key: 'legal', ok: Boolean(legal.terms && legal.privacy), label: 'Terms and privacy policy', detail: legal.terms && legal.privacy ? 'Published, linked from every sign-in page and public form' : 'Not published: write them under Settings before taking personal data from the public' },
        { key: 'billing', ok: Boolean(billing.paymentInstructions), label: 'How consultancies pay you', detail: billing.paymentInstructions ? `Shown to managers when payment is due; ${billing.graceDays} grace days, ${billing.trialDays ? `${billing.trialDays}-day trial` : 'no trial end'} for new consultancies` : 'No payment instructions: managers are reminded to renew but not told how. Add them under Settings' },
        { key: 'sms', ok: e.MESSAGING_DRIVER === 'twilio', label: 'SMS and WhatsApp', detail: e.MESSAGING_DRIVER === 'twilio' ? 'Twilio' : 'Off: reminders go by email and in the app only. Optional' },
      ],
    };
  }
}

/** Subscription plans: what each tier includes and how far it can grow. */
@Roles('super_admin')
@Controller('admin/plans')
export class AdminPlansController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  list() {
    return this.plans.list();
  }

  @Post()
  create(@Body(zodPipe(planSchema)) body: PlanInput) {
    return this.plans.create(body);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(planSchema)) body: PlanInput) {
    return this.plans.update(id, body);
  }
}

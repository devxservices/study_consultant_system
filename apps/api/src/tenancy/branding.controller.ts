import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { LOGO_UPLOAD_LIMITS } from './logo-image';
import { LogoWriteThrottleGuard } from './logo-throttle.guard';
import {
  addDomainSchema,
  updateTenantSchema,
  type AddDomainInput,
  type AuthUser,
  type BrandingSettings,
  type DomainCheckResult,
  type UpdateTenantInput,
} from '@crm/shared';
import { zodPipe } from '../common/zod.pipe';
import { CurrentUser, Roles } from '../auth/auth.guard';
import { TenantsService } from './tenants.service';
import { tenantOf } from './tenant-resolver.service';

/**
 * A consultancy's manager running their own white label: name, colour, logo,
 * contact details and their own domain. Always their own consultancy - the
 * id comes from the session, never from the request.
 */
@Roles('manager')
@Controller('tenancy/branding')
export class BrandingController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  get(@CurrentUser() actor: AuthUser): Promise<BrandingSettings> {
    return this.tenants.branding(tenantOf(actor));
  }

  @Patch()
  async update(
    @CurrentUser() actor: AuthUser,
    @Body(zodPipe(updateTenantSchema)) body: UpdateTenantInput,
  ): Promise<BrandingSettings> {
    await this.tenants.update(actor, tenantOf(actor), body);
    return this.tenants.branding(tenantOf(actor));
  }

  @Post('logo')
  @UseGuards(LogoWriteThrottleGuard)
  @UseInterceptors(FileInterceptor('file', { limits: LOGO_UPLOAD_LIMITS }))
  async setLogo(
    @CurrentUser() actor: AuthUser,
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
  ): Promise<BrandingSettings> {
    if (!file) {
      throw new BadRequestException({
        message: 'No file was received.',
        fieldErrors: { file: 'Choose an image to upload.' },
      });
    }
    await this.tenants.setLogo(actor, tenantOf(actor), file);
    return this.tenants.branding(tenantOf(actor));
  }

  @UseGuards(LogoWriteThrottleGuard)
  @Delete('logo')
  async removeLogo(@CurrentUser() actor: AuthUser): Promise<BrandingSettings> {
    await this.tenants.removeLogo(actor, tenantOf(actor));
    return this.tenants.branding(tenantOf(actor));
  }

  /** The wide logo, mark and name together, for the expanded menu and the sign-in page. */
  @Post('logo/full')
  @UseGuards(LogoWriteThrottleGuard)
  @UseInterceptors(FileInterceptor('file', { limits: LOGO_UPLOAD_LIMITS }))
  async setFullLogo(
    @CurrentUser() actor: AuthUser,
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
  ): Promise<BrandingSettings> {
    if (!file) {
      throw new BadRequestException({
        message: 'No file was received.',
        fieldErrors: { file: 'Choose an image to upload.' },
      });
    }
    await this.tenants.setLogo(actor, tenantOf(actor), file, 'full');
    return this.tenants.branding(tenantOf(actor));
  }

  @UseGuards(LogoWriteThrottleGuard)
  @Delete('logo/full')
  async removeFullLogo(@CurrentUser() actor: AuthUser): Promise<BrandingSettings> {
    await this.tenants.removeLogo(actor, tenantOf(actor), 'full');
    return this.tenants.branding(tenantOf(actor));
  }

  @Post('domains')
  async addDomain(
    @CurrentUser() actor: AuthUser,
    @Body(zodPipe(addDomainSchema)) body: AddDomainInput,
  ): Promise<BrandingSettings> {
    await this.tenants.addDomain(actor, tenantOf(actor), body);
    return this.tenants.branding(tenantOf(actor));
  }

  @Post('domains/:domainId/verify')
  verifyDomain(
    @CurrentUser() actor: AuthUser,
    @Param('domainId', ParseUUIDPipe) domainId: string,
  ): Promise<DomainCheckResult> {
    return this.tenants.verifyDomain(actor, tenantOf(actor), domainId);
  }

  @Delete('domains/:domainId')
  async removeDomain(
    @CurrentUser() actor: AuthUser,
    @Param('domainId', ParseUUIDPipe) domainId: string,
  ): Promise<BrandingSettings> {
    await this.tenants.removeDomain(actor, tenantOf(actor), domainId);
    return this.tenants.branding(tenantOf(actor));
  }
}

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
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 1024 * 1024, files: 1 } }))
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

  @Delete('logo')
  async removeLogo(@CurrentUser() actor: AuthUser): Promise<BrandingSettings> {
    await this.tenants.removeLogo(actor, tenantOf(actor));
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

import { Global, Module } from '@nestjs/common';
import { TenantResolver } from './tenant-resolver.service';
import { TenantsService } from './tenants.service';
import { TenancyController } from './tenancy.controller';
import { BrandingController } from './branding.controller';
import {
  AdminPlansController,
  AdminPlatformController,
  AdminTenantsController,
} from './admin-tenants.controller';
import { EntitlementsService } from './entitlements.service';
import { PlansService } from './plans.service';
import { PlatformSettingsService } from './platform-settings.service';
import { SubscriptionsService } from './subscriptions.service';

/**
 * Global: the auth guard resolves the site of every request, whichever module
 * the route lives in.
 */
@Global()
@Module({
  controllers: [TenancyController, BrandingController, AdminTenantsController, AdminPlatformController, AdminPlansController],
  providers: [TenantResolver, TenantsService, EntitlementsService, PlansService, PlatformSettingsService, SubscriptionsService],
  exports: [TenantResolver, EntitlementsService, PlatformSettingsService],
})
export class TenancyModule {}

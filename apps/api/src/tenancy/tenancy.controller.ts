import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthUser, Entitlements, HostContext, LegalDocsView, MySubscriptionView } from '@crm/shared';
import { CurrentUser, Public, Roles, Site } from '../auth/auth.guard';
import { EntitlementsService } from './entitlements.service';
import { TenantResolver, normalizeHost, tenancyConfig, tenantOf, toBranding, type ResolvedHost } from './tenant-resolver.service';
import { TenantsService } from './tenants.service';
import { PlatformSettingsService } from './platform-settings.service';
import { SubscriptionsService } from './subscriptions.service';

/**
 * What any visitor may learn about the site they are on, before signing in.
 */
@Controller('tenancy')
export class TenancyController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly resolver: TenantResolver,
    private readonly entitlements: EntitlementsService,
    private readonly settings: PlatformSettingsService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  /**
   * What the signed-in person's consultancy may use - the web app builds its
   * menus from this. The API enforces the same list on every module route.
   */
  @Get('entitlements')
  async entitlementsFor(@CurrentUser() actor: AuthUser): Promise<Entitlements> {
    const e = await this.entitlements.entitlements(tenantOf(actor));
    if (actor.role === 'manager' || actor.role === 'consultant') return e;
    // Students and partners need the menu, not the consultancy's plan, size
    // or whether it has paid the platform.
    return {
      planName: null,
      subscriptionStatus: 'active',
      currentPeriodEnd: null,
      subscription: { access: 'open', paidUntil: null, daysLeft: null, graceEndsOn: null, endingSoon: false },
      modules: e.modules,
      limits: { maxStaff: null, maxActiveClients: null, storageGb: null },
      usage: { staff: 0, activeClients: 0, storageBytes: 0 },
    };
  }

  /** The manager's own plan, where it stands, how to pay and what was paid. */
  @Roles('manager')
  @Get('subscription')
  subscription(@CurrentUser() actor: AuthUser): Promise<MySubscriptionView> {
    return this.subscriptions.mine(actor);
  }

  /** The platform's terms and privacy policy, for anyone - linked from every sign-in page and public form. */
  @Public()
  @Get('legal')
  legal(): Promise<LegalDocsView> {
    return this.settings.legalDocs();
  }

  /**
   * The branding for this address: the consultancy's name, colour and logo,
   * or "this is the platform admin site". An address that maps to nothing is a
   * 404, and the web app renders that as "not connected" rather than guessing.
   */
  @Public()
  @Get('current')
  current(@Site() site: ResolvedHost): HostContext {
    if (site.kind === 'platform') return { kind: 'platform' };
    if (site.kind === 'tenant') {
      return {
        kind: 'tenant',
        tenant: toBranding(site.tenant),
        available: site.tenant.status === 'active',
      };
    }
    throw new NotFoundException('This address is not connected to a consultancy.');
  }

  @Public()
  @Get('logo/:tenantId')
  async logo(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { stream, mimeType } = await this.tenants.logo(tenantId);
    res.setHeader('Content-Type', mimeType);
    // Public branding, cache-busted by the ?v= on the URL when it changes.
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    stream.on('error', () => {
      if (!res.headersSent) res.status(404).end();
      else res.end();
    });
    stream.pipe(res);
  }

  /**
   * For a TLS terminator that issues certificates on demand (Caddy's
   * `on_demand_tls { ask ... }`, or an equivalent hook): 200 means "this host
   * is ours, issue a certificate for it", 404 means refuse. Without a check
   * like this, anyone could point a domain at the server and have it request
   * certificates for them until the CA rate-limits the platform.
   */
  @Public()
  @Get('tls-check')
  async tlsCheck(@Query('domain') domain?: string): Promise<{ ok: true }> {
    // The bare platform domain is ours even when no consultancy lives there:
    // it shows the "not connected" page, over HTTPS like everything else.
    if (normalizeHost(domain) === tenancyConfig().platformDomain) return { ok: true };
    const site = await this.resolver.resolve(domain);
    if (site.kind === 'unknown') throw new NotFoundException();
    return { ok: true };
  }
}

import {
  CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthUser, Role } from '@crm/shared';
import { env } from '../config/env';
import {
  TenantResolver,
  requestHost,
  sessionMatchesHost,
  type ResolvedHost,
} from '../tenancy/tenant-resolver.service';
import { AuthService } from './auth.service';
import type { Module } from '@crm/shared';
import { EntitlementsService, REQUIRES_MODULE } from '../tenancy/entitlements.service';
import type { Permission } from '@crm/shared';
import { REQUIRES_PERMISSION, permissionDenied } from './permissions';

export const IS_PUBLIC = 'auth:public';
export const ROLES_KEY = 'auth:roles';
export const ALLOW_PLATFORM = 'auth:allow-platform';

/**
 * Opts an endpoint out of authentication (sign-in, health check). A public
 * endpoint answers the same whoever asks, so no identity is resolved for it:
 * `@CurrentUser()` is not available there, `@Site()` is.
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Restricts an endpoint to specific roles. Applied on top of AuthGuard. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Lets a platform admin (who belongs to no consultancy) use an endpoint that is
 * about their own account - who am I, sign out, my notifications. Without it,
 * everything outside the admin routes is consultancy data and refuses them.
 */
export const AllowPlatform = () => SetMetadata(ALLOW_PLATFORM, true);

export const ALLOW_PARTNER = 'auth:allow-partner';

/**
 * Opens a route to partner users (sub-agents). Everything else refuses them:
 * a partner is outside the consultancy, so the default for them is closed,
 * and a route has to say it was built for them. Their own-account routes
 * (marked @AllowPlatform - who am I, sign out, the bell) are open too.
 */
export const AllowPartner = () => SetMetadata(ALLOW_PARTNER, true);

export const ALLOW_DURING_MFA_SETUP = 'auth:allow-during-mfa-setup';

/**
 * Reachable by someone whose consultancy requires two-step verification but
 * who has not set it up yet. Everything else refuses them until they have -
 * only who-am-I, signing out, and the set-up itself are marked with this.
 */
export const AllowDuringMfaSetup = () => SetMetadata(ALLOW_DURING_MFA_SETUP, true);

export const ALLOW_WHEN_LAPSED = 'auth:allow-when-lapsed';

/**
 * Still open to staff while their consultancy's subscription has lapsed and
 * its records are read-only: their own password and two-step verification,
 * replying to students, marking notifications read. Reads are always open.
 */
export const AllowWhenLapsed = () => SetMetadata(ALLOW_WHEN_LAPSED, true);

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface AuthedRequest extends Request {
  user?: AuthUser;
  /** The site this request arrived at, resolved once by the guard. */
  site?: ResolvedHost;
}

/** Injects the resolved identity into a handler. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.user) throw new UnauthorizedException('Not signed in.');
  return req.user;
});

/** Injects the site (platform, consultancy or unknown) the request arrived at. */
export const Site = createParamDecorator((_data: unknown, ctx: ExecutionContext): ResolvedHost => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  return req.site ?? { kind: 'unknown' };
});

/**
 * Applied globally in AppModule. Every route is authenticated unless it opts
 * out with @Public(), so a new endpoint is never accidentally left open.
 *
 * On top of that it enforces the two tenancy rules no controller should have
 * to remember:
 *
 *  1. A session is only honoured on the site it belongs to. Cookies are
 *     host-only, so this should never trigger in a browser - it is the
 *     backstop for a copied token, a misconfigured cookie domain, or a script.
 *  2. A platform admin has no consultancy, so outside the routes built for
 *     them they are refused. Their role is powerful over accounts, never over
 *     a consultancy's clients.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly tenancy: TenantResolver,
    private readonly entitlements: EntitlementsService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    req.site = await this.tenancy.resolve(requestHost(req));

    // Public routes never look at who is asking, and a bad session never
    // stopped one - so a session that happens to come along is not read from
    // the database. The site's branding is asked for on every page.
    if (isPublic) return true;

    const token = extractToken(req);
    if (token) {
      const user = await this.auth.verify(token);
      if (!sessionMatchesHost(user, req.site)) {
        throw new UnauthorizedException('This session belongs to a different site. Sign in here.');
      }
      req.user = user;
    }

    if (!req.user) throw new UnauthorizedException('Please sign in to continue.');

    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, targets);
    if (roles?.length && !roles.includes(req.user.role)) {
      throw new ForbiddenException('You do not have access to this.');
    }

    if (req.user.tenantId === null) {
      const platformRoute =
        roles?.includes('super_admin') ||
        this.reflector.getAllAndOverride<boolean>(ALLOW_PLATFORM, targets);
      if (!platformRoute) {
        throw new ForbiddenException('Platform admins do not have access to consultancy data.');
      }
    }

    // Partners are closed by default: only routes built for them, or about
    // their own account, let them through.
    if (req.user.role === 'partner') {
      const partnerRoute =
        roles?.includes('partner') ||
        this.reflector.getAllAndOverride<boolean>(ALLOW_PARTNER, targets) ||
        this.reflector.getAllAndOverride<boolean>(ALLOW_PLATFORM, targets);
      if (!partnerRoute) throw new ForbiddenException('Partners do not have access to this.');
    }

    // A consultancy that requires two-step verification gets it: until this
    // person has set it up, they can do nothing but set it up.
    if (
      req.user.mfaSetupRequired &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_DURING_MFA_SETUP, targets)
    ) {
      throw new ForbiddenException({
        message: 'Your consultancy requires two-step verification. Set it up to continue.',
        code: 'MFA_SETUP_REQUIRED',
      });
    }

    // A lapsed subscription leaves staff able to read, export and reply, not
    // to change records, until the platform records a payment. Students and
    // partners carry on: they are the consultancy's customers, not its staff.
    if (
      req.user.tenantId &&
      (req.user.role === 'manager' || req.user.role === 'consultant') &&
      !READS.has(req.method) &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_WHEN_LAPSED, targets)
    ) {
      const sub = await this.entitlements.subscription(req.user.tenantId);
      if (sub.access === 'read_only') {
        throw new ForbiddenException({
          message:
            req.user.role === 'manager'
              ? 'Your subscription has ended, so records are read-only. Everything can still be seen and exported. Renew it to make changes again - see Subscription.'
              : 'Records are read-only until your consultancy renews its subscription. Everything can still be seen, and you can reply to students.',
          code: 'SUBSCRIPTION_LAPSED',
        });
      }
    }

    // Optional modules are decided by the consultancy's plan, on the server.
    const module = this.reflector.getAllAndOverride<Module>(REQUIRES_MODULE, targets);
    if (module && req.user.tenantId) {
      await this.entitlements.assertModule(req.user.tenantId, module);
    }

    // Per-member permissions. Consultants need each one the route names;
    // managers hold them all; clients are bounded by the service that serves
    // them (their own records only), so the check does not apply to them.
    const needed = this.reflector.getAllAndOverride<Permission[]>(REQUIRES_PERMISSION, targets);
    if (needed?.length && req.user.role === 'consultant') {
      const missing = needed.find((p) => !req.user!.permissions.includes(p));
      if (missing) throw permissionDenied(missing);
    }

    return true;
  }
}

/**
 * Session cookie first (what the browser uses), bearer token second (scripts
 * and the future mobile client).
 */
function extractToken(req: Request): string | null {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  const fromCookie = cookies?.[env().COOKIE_NAME];
  if (fromCookie) return fromCookie;

  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();

  return null;
}

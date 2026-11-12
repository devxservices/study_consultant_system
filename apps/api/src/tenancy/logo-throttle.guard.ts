import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthedRequest } from '../auth/auth.guard';
import { TokenBuckets, spendOrRefuse } from '../common/rate-limit';
import { clientIp, isLocalAddress } from '../common/request-context';

/*
 * The buckets live at module level, not on a guard instance: Nest may build a
 * guard once per controller, and the manager's routes and the platform
 * admin's must draw on the same budget for the same consultancy.
 */

/** Per person: ten changes at once, then one every three minutes (twenty an hour). */
const perAccount = new TokenBuckets(1 / 3, 10);
/** Per consultancy, whoever makes the change: twenty at once, then one a minute. */
const perTenant = new TokenBuckets(1, 20);

/**
 * Uploading or removing a logo. Each upload is decoded, trimmed and re-encoded
 * - the heaviest work any request here asks for - so it gets a budget far
 * tighter than the account-wide limit: plenty for someone trying a few
 * versions, nothing like enough for a script. It runs after sign-in and the
 * role check, and before the upload is read.
 */
@Injectable()
export class LogoWriteThrottleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const res = context.switchToHttp().getResponse<Response>();
    if (!req.user) return true; // signed-out requests never get this far
    const message = 'Too many logo changes in a short time. Please wait a few minutes and try again.';
    spendOrRefuse(perAccount, `u:${req.user.id}`, res, message);
    // The platform admin names the consultancy in the path; a manager's is their own.
    const tenant = (req.params as { id?: string } | undefined)?.id ?? req.user.tenantId ?? 'platform';
    spendOrRefuse(perTenant, `t:${tenant}`, res, message);
    return true;
  }
}

/**
 * Per visitor address: a page asks for two or three logo files and the
 * browser keeps them for a year, so 120 at once and 240 a minute is far above
 * any real visitor and still stops one machine hammering the public routes.
 */
const perIp = new TokenBuckets(240, 120);

/**
 * The public logo routes, which anyone can call without signing in. Behind the
 * web server every request arrives from its address, so only a real client
 * address (from the edge proxy) is limited; the in-memory cache and the image
 * slot limit protect the rest.
 */
@Injectable()
export class PublicImageThrottleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const ip = clientIp(req.headers, req.socket?.remoteAddress ?? null);
    if (isLocalAddress(ip)) return true;
    spendOrRefuse(perIp, `ip:${ip}`, context.switchToHttp().getResponse<Response>(), 'Too many requests. Please wait a moment and try again.');
    return true;
  }
}

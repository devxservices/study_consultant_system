import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { clientIp, isLocalAddress } from '../common/request-context';

/**
 * Brute-force protection for the sign-in route, kept deliberately small: an
 * in-process sliding window rather than a dependency.
 *
 * Two caps run together so neither password-spraying nor guessing one account
 * gets far: a per-IP cap catches one machine hammering many emails, and a
 * tighter per-(IP+email) cap catches a targeted guess at one account. Every
 * attempt counts, so the window cannot be reset by succeeding.
 *
 * The window is per-process memory, which is exactly right for one API
 * instance. Behind several instances or a proxy this belongs in Redis and
 * needs `trust proxy` set so `req.ip` is the real client - the real login
 * provider (Clerk/Auth0/Supabase) that replaces the dev one brings its own.
 */
@Injectable()
export class LoginThrottleGuard implements CanActivate {
  private readonly windowMs = 15 * 60 * 1000;
  private readonly maxPerIp = 30;
  private readonly maxPerAccount = 8;
  private readonly hits = new Map<string, number[]>();
  private lastSweep = 0;

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const now = Date.now();
    this.sweep(now);

    // Behind the web server every request arrives from its address, so a
    // per-IP cap keyed on that would be one bucket for the whole platform - and
    // anyone could lock everybody out of signing in. The real address comes from
    // the edge proxy (CLIENT_IP_HEADER); without it, only the per-account cap
    // applies.
    const ip = clientIp(req.headers, req.socket?.remoteAddress ?? null);
    const ipKnown = !isLocalAddress(ip);
    const email =
      typeof (req.body as { email?: unknown } | undefined)?.email === 'string'
        ? (req.body as { email: string }).email.toLowerCase().trim()
        : '';

    // Record this attempt against both keys, then judge each against its cap.
    const ipKey = `ip:${ip}`;
    const accountKey = `acct:${ip}:${email}`;
    const ipCount = ipKnown ? this.record(ipKey, now) : 0;
    const accountCount = email ? this.record(accountKey, now) : 0;

    if (ipCount > this.maxPerIp || accountCount > this.maxPerAccount) {
      throw new HttpException(
        'Too many sign-in attempts. Please wait a few minutes and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  private record(key: string, now: number): number {
    const cutoff = now - this.windowMs;
    const kept = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    kept.push(now);
    this.hits.set(key, kept);
    return kept.length;
  }

  /** Drop stale keys occasionally so the map cannot grow without bound. */
  private sweep(now: number): void {
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    const cutoff = now - this.windowMs;
    for (const [key, times] of this.hits) {
      const kept = times.filter((t) => t > cutoff);
      if (kept.length === 0) this.hits.delete(key);
      else this.hits.set(key, kept);
    }
  }
}

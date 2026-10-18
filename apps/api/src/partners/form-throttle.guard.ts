import { type CanActivate, type ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { clientIp, isLocalAddress } from '../common/request-context';

/**
 * Keeps a public form from being flooded: a few submissions per address an
 * hour, and per email a day. In-process, like the sign-in throttle - enough
 * for one API instance; several instances would share it through Redis.
 */
@Injectable()
export class FormThrottleGuard implements CanActivate {
  private readonly hits = new Map<string, number[]>();
  private readonly perIp = { max: 5, windowMs: 60 * 60 * 1000 };
  private readonly perEmail = { max: 3, windowMs: 24 * 60 * 60 * 1000 };

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const now = Date.now();
    const ip = clientIp(req.headers, req.socket?.remoteAddress ?? null);
    const email = typeof (req.body as { email?: unknown } | undefined)?.email === 'string' ? (req.body as { email: string }).email.trim().toLowerCase() : '';
    const checks: [string, { max: number; windowMs: number }][] = [];
    // Behind the web server every request comes from its address; only a real one is worth capping.
    if (!isLocalAddress(ip)) checks.push([`ip:${ip}`, this.perIp]);
    if (email) checks.push([`email:${email}`, this.perEmail]);
    for (const [key, cap] of checks) {
      const recent = (this.hits.get(key) ?? []).filter((t) => now - t < cap.windowMs);
      recent.push(now);
      this.hits.set(key, recent);
      if (recent.length > cap.max) throw new HttpException('Too many applications. Please try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) if (!v.some((t) => now - t < this.perEmail.windowMs)) this.hits.delete(k);
    }
    return true;
  }
}

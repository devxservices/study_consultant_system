import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Response } from 'express';
import { env } from '../config/env';
import type { AuthedRequest } from '../auth/auth.guard';

/**
 * Token buckets, one per key: up to `burst` requests at once, then a steady
 * `perMinute`. A bucket refills continuously, so a person who pauses gets
 * their burst back - no fixed windows for a script to time itself against.
 *
 * Memory is bounded: an idle bucket is indistinguishable from a full one, so
 * full buckets are dropped by a periodic sweep, and the map is capped.
 */
export class TokenBuckets {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  private readonly ratePerMs: number;
  private lastSweep = 0;

  constructor(
    private readonly perMinute: number,
    private readonly burst: number,
    private readonly maxKeys = 200_000,
  ) {
    this.ratePerMs = perMinute / 60_000;
  }

  /** Takes one token. Returns 0 when allowed, otherwise how many ms until one is free. */
  take(key: string, now = Date.now()): number {
    this.sweep(now);
    const b = this.buckets.get(key);
    const tokens = b ? Math.min(this.burst, b.tokens + (now - b.at) * this.ratePerMs) : this.burst;
    if (tokens < 1) {
      this.buckets.set(key, { tokens, at: now });
      return Math.ceil((1 - tokens) / this.ratePerMs);
    }
    if (!b && this.buckets.size >= this.maxKeys) this.buckets.clear();
    this.buckets.set(key, { tokens: tokens - 1, at: now });
    return 0;
  }

  /** Keys currently tracked - for tests. */
  get size(): number {
    return this.buckets.size;
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [key, b] of this.buckets) {
      if (b.tokens + (now - b.at) * this.ratePerMs >= this.burst) this.buckets.delete(key);
    }
  }
}

/**
 * A ceiling on how fast any one signed-in account can drive the API - a
 * runaway script, a scraper with a stolen session, a client bug stuck in a
 * loop - so no single account can take the database's attention from everyone
 * else. It counts per person, after authentication, and every request is
 * theirs: the pages the web server renders for them and the calls their
 * browser makes.
 *
 * Deliberately not per IP address. Behind the web server every request
 * arrives from that server's address, so a per-IP budget would be one bucket
 * for the whole platform. Unauthenticated traffic is the edge proxy's job,
 * and sign-in keeps its own, tighter throttle.
 *
 * The defaults sit far above any person's pace - a dashboard is a dozen calls
 * - so only automation ever meets them. Buckets live in this process, so
 * behind N instances the effective ceiling is N times the setting; a shared
 * budget would move the buckets to Redis without changing this guard's shape.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets: TokenBuckets | null;

  constructor() {
    const { RATE_LIMIT_PER_MINUTE: perMinute, RATE_LIMIT_BURST: burst } = env();
    this.buckets = perMinute > 0 ? new TokenBuckets(perMinute, burst) : null;
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.buckets || context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (!req.user) return true;

    const wait = this.buckets.take(`u:${req.user.id}`);
    if (wait > 0) {
      context
        .switchToHttp()
        .getResponse<Response>()
        .setHeader('Retry-After', String(Math.max(1, Math.ceil(wait / 1000))));
      throw new HttpException(
        'Too many requests from this account. Please wait a moment and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}

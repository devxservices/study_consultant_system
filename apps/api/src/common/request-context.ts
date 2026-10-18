import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';

/**
 * Where the current request came from, available anywhere in the call chain
 * without threading it through every service - the audit log reads it.
 */
export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function currentRequest(): RequestContext | undefined {
  return storage.getStore();
}

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/**
 * The client's IP address.
 *
 * Every request reaches the API through the web server, so the socket address
 * is the web server's own. The real address has to come from the edge proxy
 * (nginx, Caddy, a load balancer) in a header it sets itself, overwriting
 * anything the browser sent - named by CLIENT_IP_HEADER, e.g. `x-real-ip`.
 * Without that configured, the honest answer is the local address rather than
 * a header any browser could forge.
 */
export function clientIp(
  headers: Record<string, string | string[] | undefined>,
  socketAddress?: string | null,
): string | null {
  const header = env().CLIENT_IP_HEADER;
  if (header) {
    const raw = headers[header.toLowerCase()];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.split(',')[0]?.trim();
    if (value) return normalizeIp(value);
  }
  return socketAddress ? normalizeIp(socketAddress) : null;
}

function normalizeIp(ip: string): string {
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

/** True for addresses that only ever mean "the machine next door" - the web server. */
export function isLocalAddress(ip: string | null): boolean {
  return !ip || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('127.');
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const ua = req.headers['user-agent'];
    storage.run(
      {
        ip: clientIp(req.headers, req.socket?.remoteAddress ?? null),
        userAgent: typeof ua === 'string' ? ua.slice(0, 300) : null,
      },
      next,
    );
  }
}

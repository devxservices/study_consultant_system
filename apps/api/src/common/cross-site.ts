import type { NextFunction, Request, Response } from 'express';
import { normalizeHost, requestHost } from '../tenancy/tenant-resolver.service';

/**
 * A second line against cross-site request forgery. The session cookie is
 * SameSite=Lax, which stops other sites - but every consultancy's subdomain
 * counts as the same site as every other. A browser names the page a write
 * came from (Origin), so a write carrying a session from a page on another
 * host is refused. Writes with no session (payment webhooks, sign-in) and
 * clients that send no Origin (scripts, the server-side renderer) pass.
 */
export function refuseCrossSiteWrites(cookieName: string) {
  const reads = new Set(['GET', 'HEAD', 'OPTIONS']);
  return (req: Request, res: Response, next: NextFunction) => {
    if (reads.has(req.method)) return next();
    const origin = req.headers.origin;
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
    if (!origin || !cookies?.[cookieName]) return next();
    let from: string | null = null;
    try {
      from = normalizeHost(new URL(origin).host);
    } catch {
      from = null; // "null" (a sandboxed frame) or garbage: not this site.
    }
    if (from && from === requestHost(req)) return next();
    res.status(403).json({ statusCode: 403, message: 'This request came from another site and was refused.' });
  };
}

/**
 * Protection for the public /brand-icon routes, which anyone can call without
 * signing in and which draw an image from what is in the URL:
 *
 *  - a budget per visitor address (the edge proxy's X-Real-IP, which it sets
 *    itself, replacing anything the visitor sent): 120 at once, 240 a minute -
 *    a page asks for three icons and the browser keeps them for a year;
 *  - every finished icon kept in memory, so asking again costs nothing;
 *  - at most two images drawn at once, with a short queue; past that, "busy".
 *
 * In-process, like the API's limits: enough for one web server.
 */

const PER_MINUTE = 240;
const BURST = 120;
const MAX_ADDRESSES = 50_000;
const buckets = new Map<string, { tokens: number; at: number }>();

/** A 429 to send back when this visitor is over budget, or null to go ahead. */
export function overBudget(req: Request, now = Date.now()): Response | null {
  const ip = req.headers.get('x-real-ip')?.trim();
  // Without the proxy's address (local development) there is no one to tell apart.
  if (!ip || ip === '127.0.0.1' || ip === '::1') return null;
  const rate = PER_MINUTE / 60_000;
  const b = buckets.get(ip);
  const tokens = b ? Math.min(BURST, b.tokens + (now - b.at) * rate) : BURST;
  if (tokens < 1) {
    buckets.set(ip, { tokens, at: now });
    const wait = Math.max(1, Math.ceil((1 - tokens) / rate / 1000));
    return new Response('Too many requests', { status: 429, headers: { 'Retry-After': String(wait) } });
  }
  if (!b && buckets.size >= MAX_ADDRESSES) buckets.clear();
  buckets.set(ip, { tokens: tokens - 1, at: now });
  return null;
}

const MAX_CACHED = 500;
const cache = new Map<string, Buffer>();

/** The icon for `key`, drawn once and then served from memory (oldest dropped first). */
export async function cachedIcon(key: string, draw: () => Promise<Buffer>): Promise<Buffer> {
  const hit = cache.get(key);
  if (hit) return hit;
  const made = await inDrawSlot(draw);
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value as string);
  cache.set(key, made);
  return made;
}

export class IconsBusyError extends Error {}

const MAX_PARALLEL = 2;
const MAX_WAITING = 16;
let running = 0;
const waiting: (() => void)[] = [];

async function inDrawSlot<T>(work: () => Promise<T>): Promise<T> {
  if (running < MAX_PARALLEL) running++;
  else if (waiting.length >= MAX_WAITING) throw new IconsBusyError('busy');
  else await new Promise<void>((resolve) => waiting.push(resolve));
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running--;
  }
}

/** The headers every icon goes out with: cached for good, and only ever an image. */
export function iconResponse(body: Buffer, type: string): Response {
  return new Response(new Uint8Array(body), {
    headers: {
      'Content-Type': type,
      'Content-Length': String(body.length),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}

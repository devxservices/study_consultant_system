import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { renderClock } from './render-clock';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

/**
 * The host the browser asked for. The API decides which consultancy (or the
 * admin site) a request belongs to from this, exactly as it does for requests
 * the browser makes through the /api proxy.
 */
export async function requestHost(): Promise<string> {
  return (await headers()).get('host') ?? '';
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Server-side fetch to the NestJS API.
 *
 * Server components run on the Next server, not in the browser, so the session
 * cookie has to be forwarded by hand - it is not attached automatically.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  // Starts this render's clock on its first read, before any data arrives,
  // so the page's stamp is never later than what it shows.
  renderClock();
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

  // The visitor's address, as the edge proxy recorded it, so the audit trail
  // of a page view names them rather than this server.
  const realIp = (await headers()).get('x-real-ip');

  const res = await fetch(`${API_URL}/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
      ...(realIp ? { 'x-real-ip': realIp } : {}),
      ...init.headers,
      // Last, so nothing a caller passes can override which site this is.
      'x-tenant-host': await requestHost(),
    },
    // Case data changes constantly; a stale dashboard is worse than a slow one.
    cache: 'no-store',
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const body: unknown = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const payload = body as { message?: string; fieldErrors?: Record<string, string>; code?: string; module?: string } | null;
    // A feature the consultancy's plan does not include: a plain page that
    // says so, rather than an error screen. Callers that tolerate a failure
    // (.catch) swallow this like any other and carry on without the data.
    if (res.status === 403 && payload?.code === 'MODULE_OFF') {
      redirect(`/plan-required?module=${encodeURIComponent(payload.module ?? '')}`);
    }
    throw new ApiError(
      res.status,
      payload?.message ?? `Request failed (${res.status})`,
      payload?.fieldErrors,
    );
  }

  return body as T;
}

/** Query string builder that drops empty values instead of sending "?q=". */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

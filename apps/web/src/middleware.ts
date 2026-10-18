import { NextResponse, type NextRequest } from 'next/server';

const COOKIE_NAME = process.env.COOKIE_NAME ?? 'crm_session';
const PROTECTED = ['/desk', '/portal', '/overview', '/admin', '/security', '/partner'];

/**
 * The header that tells the API which site a request arrived at. Next's proxy
 * replaces Host with the API's own address, so the original travels here.
 */
const TENANT_HOST_HEADER = 'x-tenant-host';

/**
 * Two jobs.
 *
 * 1. Every /api request is stamped with the host the browser actually asked
 *    for, overwriting anything the browser sent under the same name. The API
 *    uses it to pick the consultancy (or the admin site) for a sign-in and to
 *    check a session is being used on the site it belongs to.
 *
 * 2. A cheap first gate on the portals: bounce anyone with no session straight
 *    to sign-in so a protected page never renders a flash of empty chrome.
 *    This only checks that a cookie exists. Whether it is valid, and what role
 *    and consultancy it carries, is decided by the API on every request.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname === '/api' || pathname.startsWith('/api/')) {
    const headers = new Headers(req.headers);
    headers.set(TENANT_HOST_HEADER, req.headers.get('host') ?? '');
    return NextResponse.next({ request: { headers } });
  }

  if (!PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  if (!req.cookies.get(COOKIE_NAME)) {
    const url = req.nextUrl.clone();
    url.pathname = '/sign-in';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/api/:path*',
    '/desk/:path*',
    '/portal/:path*',
    '/overview/:path*',
    '/admin/:path*',
    '/partner',
    '/partner/:path*',
    '/admin',
    '/security/:path*',
  ],
};

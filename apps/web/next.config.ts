import path from 'node:path';
import type { NextConfig } from 'next';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

/**
 * The web app compiles `@crm/shared` from its TypeScript source rather than
 * the CommonJS build the API runs. CommonJS cannot be tree-shaken, so a client
 * component importing one constant used to pull every module - and zod - into
 * the JavaScript of every page. From source, with the package marked
 * side-effect free, a page ships only the exports it actually uses.
 */
const SHARED_SRC = path.resolve(__dirname, '../../packages/shared/src/index.ts');

/**
 * The browser only ever talks to this origin. /api/* is proxied to the NestJS
 * server, which keeps the session cookie same-origin and means no CORS or
 * third-party-cookie handling in the browser at all.
 */
/**
 * Security headers applied to every response. Deliberately the conservative
 * set that hardens a data-sensitive app without breaking it:
 *  - clickjacking is closed two ways (X-Frame-Options + frame-ancestors), which
 *    matters when the screens show passport scans;
 *  - object-src/base-uri close plugin and <base>-injection vectors;
 *  - MIME sniffing is off, referrers never leak a full URL cross-site, and the
 *    only powerful feature the app uses (the camera, for document capture) is
 *    allowed to self while microphone/geolocation are denied outright.
 * The CSP intentionally does not restrict script/connect, so the realtime chat
 * socket keeps working regardless of which host the API is on.
 */
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
  },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
];

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: '/overview/team', destination: '/overview/consultants', permanent: false },
      { source: '/overview/team/:id/permissions', destination: '/overview/consultants/:id', permanent: false },
      { source: '/overview/team/:id/activity', destination: '/overview/consultants/:id?tab=activity', permanent: false },
      { source: '/overview/team/:id', destination: '/overview/consultants/:id', permanent: false },
    ];
  },
  async rewrites() {
    // Includes the realtime sockets (/api/socket.io), so they share the page's
    // origin and its host-only session cookie. The middleware stamps each API
    // request with the host the browser asked for before it is proxied.
    return [{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }];
  },
  async headers() {
    // A document opens inside the app's own preview (an iframe), so the two
    // routes that serve files may be framed - by this origin only. Every
    // other response still refuses to be framed at all. Later rules win.
    const sameOriginFrame = [
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'" },
    ];
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/api/documents/:id/file', headers: sameOriginFrame },
      { source: '/api/share/:token/files/:id', headers: sameOriginFrame },
    ];
  },
  transpilePackages: ['@crm/shared'],
  webpack(config) {
    config.resolve.alias = { ...config.resolve.alias, '@crm/shared$': SHARED_SRC };
    return config;
  },
  // Consultancies are served on subdomains (futurepath.localhost, admin.localhost)
  // in development; let the dev server answer them.
  allowedDevOrigins: ['*.localhost'],
  experimental: {
    optimizePackageImports: [],
    // Pages the browser has shown (dynamic) or prefetched on hover (static)
    // are kept for a minute, so going back to a tab or a filter is instant.
    // A kept page is never trusted as it is: components/freshness.tsx asks
    // the API whether anything changed since it was rendered, and re-renders
    // it at once if so. Any save in this tab already clears the keep
    // (router.refresh). Keep `static` equal to PREFETCH_KEPT_MS there.
    staleTimes: { dynamic: 60, static: 60 },
  },
};

export default nextConfig;

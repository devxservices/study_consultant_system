import { env } from '../config/env';

/**
 * Where the realtime sockets live, shared by every gateway (Socket.IO runs one
 * server per path).
 *
 * Under /api, so the browser reaches them on the page's own origin through the
 * same proxy as every other API call. That is what makes them work across
 * consultancies: each one's session cookie is host-only, so a socket opened
 * directly against the API's own address would arrive with no session at all.
 * No trailing slash, because the web server redirects /api/socket.io/ to
 * /api/socket.io and the handshake would not survive the redirect.
 */
export const SOCKET_OPTIONS = {
  path: '/api/socket.io',
  addTrailingSlash: false,
  cors: {
    origin: env().WEB_ORIGIN.split(',').map((o) => o.trim()),
    credentials: true,
  },
};

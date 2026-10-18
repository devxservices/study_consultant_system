import type { Socket } from 'socket.io-client';

/**
 * Opens a realtime connection on the page's own origin, through the same /api
 * proxy as every other request.
 *
 * Same-origin is what makes it work for every consultancy: each one's session
 * cookie belongs to its own address only, so a socket opened against the API's
 * separate address would arrive with no session. No trailing slash on the path,
 * because the web server redirects `/api/socket.io/` and the handshake would
 * not survive the redirect.
 *
 * The client library is loaded on demand rather than bundled into the page.
 * The bell is in every portal's chrome, so a static import put the whole
 * socket client into the first load of every screen, ahead of anything the
 * person could see or click. The realtime layer only ever saves a refresh -
 * the page is complete without it - so it arrives just after the page is
 * interactive instead.
 *
 * `setup` runs once the socket exists and may return its own teardown. The
 * returned function disconnects, and is safe to call before the library has
 * finished loading.
 */
export function connectSocket(
  namespace: '/chat' | '/notifications',
  setup: (socket: Socket) => void | (() => void),
  onUnavailable?: () => void,
): () => void {
  let disposed = false;
  let socket: Socket | null = null;
  let teardown: void | (() => void);

  import('socket.io-client')
    .then(({ io }) => {
      if (disposed) return;
      socket = io(namespace, {
        path: '/api/socket.io',
        addTrailingSlash: false,
        withCredentials: true,
        transports: ['websocket', 'polling'],
      });
      teardown = setup(socket);
    })
    .catch(() => {
      // The chunk could not be fetched (offline, a deploy mid-session). The
      // page still works over plain HTTP; say so rather than hang.
      if (!disposed) onUnavailable?.();
    });

  return () => {
    disposed = true;
    if (typeof teardown === 'function') teardown();
    socket?.close();
  };
}

import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { NOTIFICATION_EVENTS, type AuthUser, type NotificationView } from '@crm/shared';
import { env } from '../config/env';
import { SOCKET_OPTIONS } from '../messages/socket-options';
import { AuthService } from '../auth/auth.service';

interface AuthedSocket extends Socket {
  data: { user?: AuthUser };
}

const userRoom = (userId: string) => `user:${userId}`;

/**
 * Pushes notifications to whoever they belong to.
 *
 * A room per user, not per socket, so someone with the app open on a phone and
 * a laptop sees the same badge update on both. This namespace is separate from
 * chat because the bell lives in the app chrome on every page, while a chat
 * thread only exists on the pages that show one.
 *
 * There are no inbound events: the client cannot ask for anyone's
 * notifications over the socket, it only receives its own.
 */
@WebSocketGateway({ namespace: '/notifications', ...SOCKET_OPTIONS })
export class NotificationsGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;

  constructor(private readonly auth: AuthService) {}

  async handleConnection(client: AuthedSocket): Promise<void> {
    try {
      const token = tokenFrom(client);
      if (!token) throw new Error('no session');
      const user = await this.auth.verify(token);
      client.data.user = user;
      // The only room this socket will ever be in is its owner's.
      await client.join(userRoom(user.id));
    } catch {
      client.disconnect(true);
    }
  }

  /** Called after a notification row is written. */
  emitToUser(userId: string, notification: NotificationView): void {
    this.server?.to(userRoom(userId)).emit(NOTIFICATION_EVENTS.created, notification);
  }

  /** Keeps other tabs in sync when one of them clears the bell. */
  emitReadAll(userId: string): void {
    this.server?.to(userRoom(userId)).emit(NOTIFICATION_EVENTS.readAll, {});
  }
}

function tokenFrom(client: Socket): string | null {
  const raw = client.handshake.headers.cookie;
  if (raw) {
    for (const part of raw.split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (name === env().COOKIE_NAME) return decodeURIComponent(rest.join('='));
    }
  }
  return (client.handshake.auth as { token?: string } | undefined)?.token ?? null;
}

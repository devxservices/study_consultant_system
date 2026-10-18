import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import {
  CHAT_EVENTS,
  sendMessageSchema,
  type AuthUser,
  type ReadPayload,
  type SendMessageInput,
  type TypingPayload,
} from '@crm/shared';
import { env } from '../config/env';
import { SOCKET_OPTIONS } from './socket-options';
import { AuthService } from '../auth/auth.service';
import { MessagesService } from './messages.service';
import { SyncService } from '../sync/sync.service';
import { clientIp, runWithRequestContext } from '../common/request-context';

/** A socket that has completed the handshake carries its resolved identity. */
interface AuthedSocket extends Socket {
  data: { user?: AuthUser };
}

const room = (caseId: string) => `case:${caseId}`;

/**
 * Live chat, one room per case.
 *
 * Two rules make this safe:
 *
 * 1. The connection is authenticated at handshake from the same session cookie
 *    the REST API uses. An unauthenticated socket is disconnected immediately -
 *    it never reaches a handler.
 * 2. Joining a room goes through the same case-access check as the HTTP
 *    endpoints. A socket can never subscribe to a conversation its owner could
 *    not already read, so the realtime layer adds no new attack surface.
 */
@WebSocketGateway({ namespace: '/chat', ...SOCKET_OPTIONS })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly auth: AuthService,
    private readonly messages: MessagesService,
    private readonly sync: SyncService,
  ) {}

  /**
   * Socket writes do not pass the HTTP interceptor that marks every other
   * change, so they mark their own. A failure is only logged: the message
   * itself has been saved.
   */
  private markChanged(user: AuthUser): Promise<void> {
    if (!user.tenantId) return Promise.resolve();
    return this.sync.touch(user.tenantId).catch((err: unknown) => {
      this.logger.warn(`change marker not recorded: ${(err as Error).message}`);
    });
  }

  async handleConnection(client: AuthedSocket): Promise<void> {
    try {
      const token = tokenFrom(client);
      if (!token) throw new Error('no session');
      client.data.user = await this.auth.verify(token);
    } catch {
      // Never explain why - an unauthenticated socket learns nothing.
      client.emit(CHAT_EVENTS.error, { message: 'Not signed in.' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthedSocket): void {
    const user = client.data.user;
    if (!user) return;
    // Clear any lingering typing indicator this socket was showing.
    for (const r of client.rooms) {
      if (r.startsWith('case:')) {
        client.to(r).emit(CHAT_EVENTS.typingState, {
          caseId: r.slice(5),
          userId: user.id,
          name: user.fullName,
          typing: false,
        } satisfies TypingPayload);
      }
    }
  }

  /**
   * The identity as it stands now, not as it stood at the handshake: a socket
   * can stay open for hours, and a permission taken away, a login switched off
   * or a consultancy suspended must bite on the next message, not the next
   * reconnect.
   */
  private async fresh(client: AuthedSocket): Promise<AuthUser | null> {
    const id = client.data.user?.id;
    if (!id) return null;
    const user = await this.auth.loadUser(id).catch(() => null);
    if (!user || user.mfaSetupRequired) {
      client.emit(CHAT_EVENTS.error, { message: 'Please sign in again.' });
      client.disconnect(true);
      return null;
    }
    client.data.user = user;
    return user;
  }

  /** Runs a handler with where the socket connected from, for the audit log. */
  private withContext<T>(client: AuthedSocket, fn: () => Promise<T>): Promise<T> {
    const ua = client.handshake.headers['user-agent'];
    return runWithRequestContext(
      {
        ip: clientIp(client.handshake.headers, client.handshake.address ?? null),
        userAgent: typeof ua === 'string' ? ua.slice(0, 300) : null,
      },
      fn,
    );
  }

  @SubscribeMessage(CHAT_EVENTS.join)
  async join(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() payload: { caseId?: string },
  ) {
    if (!payload?.caseId) return { ok: false };
    const user = await this.fresh(client);
    if (!user) return { ok: false };

    try {
      // The access check that matters.
      await this.messages.assertCaseAccess(user, payload.caseId);
    } catch {
      client.emit(CHAT_EVENTS.error, { message: 'You do not have access to that conversation.' });
      return { ok: false };
    }

    await client.join(room(payload.caseId));
    return { ok: true };
  }

  @SubscribeMessage(CHAT_EVENTS.leave)
  async leave(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() payload: { caseId?: string },
  ) {
    if (payload?.caseId) await client.leave(room(payload.caseId));
    return { ok: true };
  }

  @SubscribeMessage(CHAT_EVENTS.send)
  async send(@ConnectedSocket() client: AuthedSocket, @MessageBody() payload: unknown) {
    const user = await this.fresh(client);
    if (!user) return { ok: false };

    const parsed = sendMessageSchema.safeParse(payload);
    if (!parsed.success) {
      client.emit(CHAT_EVENTS.error, {
        message: parsed.error.issues[0]?.message ?? 'That message could not be sent.',
      });
      return { ok: false };
    }

    const input: SendMessageInput = parsed.data;

    try {
      // send() re-checks access itself; the socket's room membership is never
      // treated as proof of anything.
      const saved = await this.withContext(client, () => this.messages.send(user, input));
      await this.markChanged(user);
      this.server.to(room(input.caseId)).emit(CHAT_EVENTS.message, saved);
      return { ok: true, message: saved };
    } catch (err) {
      this.logger.warn(`chat send failed for case ${input.caseId}: ${(err as Error).message}`);
      const denied = (err as { response?: { code?: string } }).response?.code === 'PERMISSION_DENIED';
      client.emit(CHAT_EVENTS.error, {
        message: denied
          ? 'You do not have permission to message clients. Ask a manager if you need it.'
          : 'Message could not be sent. Try again.',
      });
      return { ok: false };
    }
  }

  @SubscribeMessage(CHAT_EVENTS.typing)
  typing(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() payload: { caseId?: string; typing?: boolean },
  ) {
    const user = client.data.user;
    if (!user || !payload?.caseId) return { ok: false };
    if (!client.rooms.has(room(payload.caseId))) return { ok: false };

    // Broadcast to the room except the sender.
    client.to(room(payload.caseId)).emit(CHAT_EVENTS.typingState, {
      caseId: payload.caseId,
      userId: user.id,
      name: user.fullName,
      typing: Boolean(payload.typing),
    } satisfies TypingPayload);
    return { ok: true };
  }

  @SubscribeMessage(CHAT_EVENTS.read)
  async read(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() payload: { caseId?: string },
  ) {
    if (!payload?.caseId) return { ok: false };
    const user = await this.fresh(client);
    if (!user) return { ok: false };

    try {
      const {
        result: { readAt },
        marked,
      } = await this.messages.markReadCounting(user, payload.caseId);
      if (marked > 0) await this.markChanged(user);
      client.to(room(payload.caseId)).emit(CHAT_EVENTS.readState, {
        caseId: payload.caseId,
        readerId: user.id,
        readAt,
      } satisfies ReadPayload);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }
}

/**
 * The session cookie first (what a browser sends automatically on the
 * handshake), then an explicit auth token for non-browser clients.
 */
function tokenFrom(client: Socket): string | null {
  const raw = client.handshake.headers.cookie;
  if (raw) {
    for (const part of raw.split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (name === env().COOKIE_NAME) return decodeURIComponent(rest.join('='));
    }
  }

  const authToken = (client.handshake.auth as { token?: string } | undefined)?.token;
  return authToken ?? null;
}

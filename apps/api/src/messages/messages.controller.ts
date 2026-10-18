import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  listMessagesQuerySchema,
  sendMessageSchema,
  type AuthUser,
  type ListMessagesQuery,
  type SendMessageInput,
} from '@crm/shared';
import { zodPipe } from '../common/zod.pipe';
import { AllowWhenLapsed, CurrentUser } from '../auth/auth.guard';
import { RequirePermission } from '../auth/permissions';
import { MessagesService } from './messages.service';

/**
 * REST alongside the socket, not instead of it.
 *
 * History loads over HTTP (cacheable, paginated, works before the socket
 * connects), and sending has an HTTP path too so a client on a flaky
 * connection can still get a message out when the websocket is down.
 */
@AllowWhenLapsed()
@Controller('messages')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @RequirePermission('chat.view')
  @Get()
  history(
    @CurrentUser() actor: AuthUser,
    @Query(zodPipe(listMessagesQuerySchema)) query: ListMessagesQuery,
  ) {
    return this.messages.history(actor, query);
  }

  /** The inbox: one row per case with a conversation. */
  @RequirePermission('chat.view')
  @Get('threads')
  threads(@CurrentUser() actor: AuthUser) {
    return this.messages.threads(actor);
  }

  @Get('unread')
  async unread(@CurrentUser() actor: AuthUser) {
    return { total: await this.messages.unreadTotal(actor) };
  }

  @RequirePermission('chat.send')
  @Post()
  send(@CurrentUser() actor: AuthUser, @Body(zodPipe(sendMessageSchema)) body: SendMessageInput) {
    return this.messages.send(actor, body);
  }

  @RequirePermission('chat.view')
  @Post(':caseId/read')
  @HttpCode(200)
  markRead(@CurrentUser() actor: AuthUser, @Param('caseId', ParseUUIDPipe) caseId: string) {
    return this.messages.markRead(actor, caseId);
  }
}

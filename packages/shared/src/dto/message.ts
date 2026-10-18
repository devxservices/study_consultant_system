import { z } from 'zod';
import { ROLES } from '../roles';
import { uuidSchema } from './common';

export const sendMessageSchema = z.object({
  caseId: uuidSchema,
  body: z.string().trim().min(1, 'Write a message.').max(4000, 'That message is too long.'),
  /** Optionally pins a document into the conversation. */
  documentId: uuidSchema.optional(),
  /**
   * Client-generated id, echoed back on the saved message so an optimistic
   * bubble can be replaced rather than duplicated when the socket delivers it.
   */
  clientRef: z.string().max(64).optional(),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const listMessagesQuerySchema = z.object({
  caseId: uuidSchema,
  /** Cursor: fetch messages sent before this ISO timestamp, newest first. */
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;

export interface MessageView {
  id: string;
  caseId: string;
  senderId: string;
  senderName: string;
  senderRole: (typeof ROLES)[number];
  body: string;
  documentId: string | null;
  documentName: string | null;
  sentAt: string;
  readAt: string | null;
  clientRef?: string | null;
}

export interface ThreadSummary {
  caseId: string;
  reference: string;
  clientId: string;
  clientName: string;
  consultantName: string | null;
  targetCountry: string;
  lastMessage: string | null;
  lastMessageAt: string | null;
  lastSenderRole: string | null;
  unread: number;
}

/** Socket.IO event names, shared so client and server cannot drift. */
export const CHAT_EVENTS = {
  join: 'chat:join',
  leave: 'chat:leave',
  send: 'chat:send',
  message: 'chat:message',
  typing: 'chat:typing',
  typingState: 'chat:typing-state',
  read: 'chat:read',
  readState: 'chat:read-state',
  error: 'chat:error',
} as const;

export interface TypingPayload {
  caseId: string;
  userId: string;
  name: string;
  typing: boolean;
}

export interface ReadPayload {
  caseId: string;
  readerId: string;
  readAt: string;
}

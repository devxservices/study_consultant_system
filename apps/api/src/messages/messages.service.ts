import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, lt, ne, sql, type SQL } from 'drizzle-orm';
import type {
  AuthUser,
  ListMessagesQuery,
  MessageView,
  SendMessageInput,
  ThreadSummary,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { cases, clients, consultants, documents, messages, users } from '../db/schema';
import { CasesService } from '../cases/cases.service';
import { NotificationsService } from '../notifications/notifications.service';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { AuditService } from '../audit/audit.service';
import { assertCan, seesAll, staffCan } from '../auth/permissions';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/** The outer query's case, written out in full so it stays qualified inside the lateral subquery. */
const OUTER_CASE_ID = sql.raw('"cases"."id"');

@Injectable()
export class MessagesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly cases: CasesService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Chat is scoped to a case, so case access IS chat access. Both the REST
   * endpoints and the socket gateway resolve through here, which means a
   * socket can never join a room its owner could not read over HTTP.
   */
  async assertCaseAccess(actor: AuthUser, caseId: string) {
    // The socket never passes the HTTP guard, so the permission is checked here too.
    assertCan(actor, 'chat.view');
    return this.cases.findAccessible(actor, caseId);
  }

  /**
   * History, newest first, cursor-paginated. Reversed before returning so the
   * caller renders oldest-to-newest without another sort.
   */
  async history(actor: AuthUser, query: ListMessagesQuery): Promise<MessageView[]> {
    await this.assertCaseAccess(actor, query.caseId);

    const conditions: (SQL | undefined)[] = [eq(messages.caseId, query.caseId)];
    if (query.before) conditions.push(lt(messages.sentAt, new Date(query.before)));

    const rows = await this.db
      .select(this.selection())
      .from(messages)
      .innerJoin(users, eq(users.id, messages.senderId))
      .leftJoin(documents, eq(documents.id, messages.documentId))
      .where(and(...conditions.filter(Boolean)))
      .orderBy(desc(messages.sentAt))
      .limit(query.limit);

    return rows.map(toView).reverse();
  }

  async send(actor: AuthUser, input: SendMessageInput): Promise<MessageView> {
    assertCan(actor, 'chat.send');
    const kase = await this.assertCaseAccess(actor, input.caseId);

    const [created] = await this.db
      .insert(messages)
      .values({
        tenantId: kase.case.tenantId,
        caseId: input.caseId,
        senderId: actor.id,
        senderRole: actor.role,
        body: input.body,
        documentId: input.documentId ?? null,
      })
      .returning();

    if (!created) throw new Error('Message insert returned no row');

    await this.cases.touch(input.caseId);
    await this.notifyCounterpart(actor, kase, input.body);
    // That a message was sent, and by whom - never what it said.
    await this.audit.record(actor, {
      action: 'message.sent',
      entityType: 'message',
      entityId: created.id,
      caseId: input.caseId,
      clientId: kase.case.clientId,
      metadata: { reference: kase.case.reference, length: input.body.length, attachment: Boolean(input.documentId) },
    });

    const [row] = await this.db
      .select(this.selection())
      .from(messages)
      .innerJoin(users, eq(users.id, messages.senderId))
      .leftJoin(documents, eq(documents.id, messages.documentId))
      .where(eq(messages.id, created.id))
      .limit(1);

    if (!row) throw new NotFoundException('Message not found.');
    return { ...toView(row), clientRef: input.clientRef ?? null };
  }

  /**
   * Marks everything the other side sent as read. Deliberately not "mark this
   * one message" - people read a thread, not individual lines.
   */
  async markRead(actor: AuthUser, caseId: string): Promise<{ readAt: string }> {
    return (await this.markReadCounting(actor, caseId)).result;
  }

  /**
   * As markRead, also saying how many messages it marked. Opening a thread
   * marks it read every time; only a mark that changed something is news
   * worth telling the rest of the consultancy's pages about.
   */
  async markReadCounting(
    actor: AuthUser,
    caseId: string,
  ): Promise<{ result: { readAt: string }; marked: number }> {
    await this.assertCaseAccess(actor, caseId);
    const readAt = new Date();

    const marked = await this.db
      .update(messages)
      .set({ readAt })
      .where(
        and(
          eq(messages.caseId, caseId),
          ne(messages.senderId, actor.id),
          isNull(messages.readAt),
        ),
      )
      .returning({ id: messages.id });

    return { result: { readAt: readAt.toISOString() }, marked: marked.length };
  }

  /** Unread count for one case, for badges next to a thread. */
  async unreadForCase(actor: AuthUser, caseId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(messages)
      .where(
        and(
          eq(messages.tenantId, tenantOf(actor)),
          eq(messages.caseId, caseId),
          ne(messages.senderId, actor.id),
          isNull(messages.readAt),
        ),
      );
    return row?.n ?? 0;
  }

  /** Total unread across everything this actor can see - the nav badge. */
  async unreadTotal(actor: AuthUser): Promise<number> {
    // A consultant who may not read conversations has no unread badge either.
    if (actor.role === 'consultant' && !staffCan(actor, 'chat.view')) return 0;
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(messages)
      .innerJoin(cases, eq(cases.id, messages.caseId))
      .innerJoin(clients, eq(clients.id, cases.clientId))
      .where(
        and(
          ne(messages.senderId, actor.id),
          isNull(messages.readAt),
          this.threadScope(actor),
        ),
      );
    return row?.n ?? 0;
  }

  /**
   * The inbox: one row per case that has a conversation, most recent first.
   * Cases nobody has messaged about are omitted - an empty inbox of 50 silent
   * threads is noise, not information.
   */
  async threads(actor: AuthUser, limit = 50): Promise<ThreadSummary[]> {
    assertCan(actor, 'chat.view');
    // The newest message of each case, found once per case through the
    // (case_id, sent_at desc) index. An inner lateral join also drops cases
    // nobody has messaged about. Previously three correlated subqueries per
    // case, one of them evaluated again in the filter and again in the sort.
    const last = this.db
      .select({ body: messages.body, sentAt: messages.sentAt, senderRole: messages.senderRole })
      .from(messages)
      .where(sql`${messages.caseId} = ${OUTER_CASE_ID}`)
      .orderBy(desc(messages.sentAt))
      .limit(1)
      .as('last_message');

    const rows = await this.db
      .select({
        caseId: cases.id,
        reference: cases.reference,
        clientId: cases.clientId,
        clientName: clients.fullName,
        consultantName: users.fullName,
        targetCountry: cases.targetCountry,
        lastMessage: last.body,
        lastMessageAt: last.sentAt,
        lastSenderRole: last.senderRole,
      })
      .from(cases)
      .innerJoin(clients, eq(clients.id, cases.clientId))
      .leftJoin(consultants, eq(consultants.id, cases.consultantId))
      .leftJoin(users, eq(users.id, consultants.userId))
      .innerJoinLateral(last, sql`true`)
      .where(this.threadScope(actor))
      .orderBy(desc(last.sentAt))
      .limit(limit);

    // Unread counts for the threads on the page only, in one grouped query.
    const unreadBy = new Map<string, number>();
    if (rows.length > 0) {
      const counts = await this.db
        .select({ caseId: messages.caseId, n: sql<number>`count(*)::int` })
        .from(messages)
        .where(
          and(
            inArray(messages.caseId, rows.map((r) => r.caseId)),
            ne(messages.senderId, actor.id),
            isNull(messages.readAt),
          ),
        )
        .groupBy(messages.caseId);
      for (const c of counts) unreadBy.set(c.caseId, c.n);
    }

    return rows.map((r) => ({
      ...r,
      lastMessageAt: r.lastMessageAt ? new Date(r.lastMessageAt).toISOString() : null,
      unread: unreadBy.get(r.caseId) ?? 0,
    }));
  }

  /** Row scoping for thread lists, matching the case rules exactly. */
  private threadScope(actor: AuthUser): SQL | undefined {
    return and(eq(cases.tenantId, tenantOf(actor)), this.roleScope(actor));
  }

  private roleScope(actor: AuthUser): SQL | undefined {
    switch (actor.role) {
      case 'manager':
        return undefined;
      case 'consultant':
        if (seesAll(actor)) return undefined;
        return eq(cases.consultantId, actor.consultantId ?? NIL_UUID);
      case 'client':
        return eq(cases.clientId, actor.clientId ?? NIL_UUID);
      default:
        return sql`false`;
    }
  }

  /** Tells the other party a message is waiting, never the sender. */
  private async notifyCounterpart(
    actor: AuthUser,
    kase: Awaited<ReturnType<CasesService['findAccessible']>>,
    body: string,
  ): Promise<void> {
    const preview = body.length > 90 ? `${body.slice(0, 89)}...` : body;

    if (actor.role === 'client') {
      if (!kase.case.consultantId) return;
      const [row] = await this.db
        .select({ userId: consultants.userId })
        .from(consultants)
        .where(eq(consultants.id, kase.case.consultantId))
        .limit(1);
      await this.notifications.push(
        row?.userId
          ? {
              userId: row.userId,
              type: 'message_received',
              title: `${kase.clientName} sent you a message`,
              body: preview,
              link: `/desk/cases/${kase.case.id}`,
              caseId: kase.case.id,
            }
          : null,
      );
      return;
    }

    if (!kase.clientUserId) return;
    await this.notifications.push({
      userId: kase.clientUserId,
      type: 'message_received',
      title: 'Your consultant sent you a message',
      body: preview,
      link: '/portal',
      caseId: kase.case.id,
    });
  }

  private selection() {
    return {
      id: messages.id,
      caseId: messages.caseId,
      senderId: messages.senderId,
      senderName: users.fullName,
      senderRole: messages.senderRole,
      body: messages.body,
      documentId: messages.documentId,
      documentName: documents.fileName,
      sentAt: messages.sentAt,
      readAt: messages.readAt,
    };
  }
}

interface RawMessage {
  id: string;
  caseId: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  body: string;
  documentId: string | null;
  documentName: string | null;
  sentAt: Date | string;
  readAt: Date | string | null;
}

function toView(r: RawMessage): MessageView {
  return {
    id: r.id,
    caseId: r.caseId,
    senderId: r.senderId,
    senderName: r.senderName,
    senderRole: r.senderRole as MessageView['senderRole'],
    body: r.body,
    documentId: r.documentId,
    documentName: r.documentName,
    sentAt: iso(r.sentAt),
    readAt: r.readAt ? iso(r.readAt) : null,
  };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}


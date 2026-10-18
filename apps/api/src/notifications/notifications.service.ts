import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { AuthUser, NotificationFeed, NotificationType, NotificationView } from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { notifications, tenants, users } from '../db/schema';
import { NotificationsGateway } from './notifications.gateway';
import { MailService, textToHtml, type MailAttachment } from '../mail/mail.service';
import { tenantIdentity } from '../tenancy/tenant-links';

export interface NewNotification {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  link?: string | null;
  caseId?: string | null;
  /**
   * Also email it - when the consultancy has that type's emails on. Off for
   * chatter that only makes sense inside the app (a typing colleague, a chat
   * message already pushed live).
   */
  email?: boolean;
  /** Files to attach to that email: a receipt, a statement. */
  attachments?: MailAttachment[];
}

/**
 * In-app notifications.
 *
 * Like the audit log, a failure here must never break the action that caused
 * it - nobody should see "verify failed" because a notification could not be
 * written or a socket was down.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(forwardRef(() => NotificationsGateway))
    private readonly gateway: NotificationsGateway,
    private readonly mail: MailService,
  ) {}

  async push(entry: NewNotification | null): Promise<void> {
    if (!entry) return;
    try {
      const [row] = await this.db
        .insert(notifications)
        .values({
          // Always the recipient's own consultancy, taken from their user row
          // rather than from the caller, so a notification can never be filed
          // under a tenant its reader does not belong to.
          tenantId: sql`(select ${users.tenantId} from ${users} where ${users.id} = ${entry.userId})`,
          userId: entry.userId,
          type: entry.type,
          title: entry.title,
          body: entry.body ?? null,
          link: entry.link ?? null,
          caseId: entry.caseId ?? null,
        })
        .returning();

      // Deliver live if they are online; the row is the source of truth either way.
      if (row) this.gateway.emitToUser(entry.userId, toView(row));
      if (row && entry.email) await this.email(entry, row.tenantId);
    } catch (err) {
      this.logger.error(`Failed to write notification ${entry.type}`, err as Error);
    }
  }

  /** Several people at once - the managers, the accountants. */
  async pushMany(userIds: string[], entry: Omit<NewNotification, 'userId'>): Promise<void> {
    for (const userId of new Set(userIds)) await this.push({ ...entry, userId });
  }

  /**
   * The same notification by email, from the consultancy's name, with a link
   * back to its own address. Skipped when the consultancy switched this type's
   * emails off, or the person has no address.
   */
  private async email(entry: NewNotification, tenantId: string | null): Promise<void> {
    if (!tenantId) return;
    const [who] = await this.db
      .select({ email: users.email, name: users.fullName, settings: tenants.emailNotifications })
      .from(users)
      .innerJoin(tenants, eq(tenants.id, users.tenantId))
      .where(eq(users.id, entry.userId))
      .limit(1);
    if (!who?.email || who.settings?.[entry.type] === false) return;
    const site = await tenantIdentity(this.db, tenantId);
    const link = entry.link ? `${site.origin}${entry.link}` : site.origin;
    const text = [
      `Hello ${who.name.split(' ')[0]},`,
      entry.title + (entry.body ? `\n${entry.body}` : ''),
      `Open it: ${link}`,
      `${site.name}${site.contactPhone ? ` · ${site.contactPhone}` : ''}`,
    ].join('\n\n');
    await this.mail.send({
      to: who.email,
      subject: entry.title,
      text,
      html: textToHtml(text),
      fromName: site.name,
      replyTo: site.contactEmail ?? undefined,
      attachments: entry.attachments,
    });
  }

  async list(actor: AuthUser, limit = 20): Promise<NotificationFeed> {
    // Loaded on every page, so the badge count rides along with the feed in
    // one round trip. It is a count of everything unread, not of the rows on
    // this page; with no rows at all there is nothing unread either.
    const rows = await this.db
      .select({
        row: notifications,
        unread: sql<number>`(
          select count(*)::int from notifications u
          where u.user_id = ${actor.id}::uuid and u.read_at is null
        )`,
      })
      .from(notifications)
      .where(eq(notifications.userId, actor.id))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);

    return { items: rows.map((r) => toView(r.row)), unread: rows[0]?.unread ?? 0 };
  }

  /** Scoped to the owner, so an id from elsewhere simply matches nothing. */
  async markRead(actor: AuthUser, id: string): Promise<void> {
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, actor.id)));
  }

  async markAllRead(actor: AuthUser): Promise<void> {
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, actor.id), isNull(notifications.readAt)));

    // Other tabs belonging to the same person should clear too.
    this.gateway.emitReadAll(actor.id);
  }
}

function toView(row: typeof notifications.$inferSelect): NotificationView {
  return {
    id: row.id,
    type: row.type as NotificationType,
    title: row.title,
    body: row.body,
    link: row.link,
    caseId: row.caseId,
    readAt: row.readAt ? iso(row.readAt) : null,
    createdAt: iso(row.createdAt),
  };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

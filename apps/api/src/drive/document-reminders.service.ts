import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { clients, consultants, documents, tenants } from '../db/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { RemindersService } from '../reminders/reminders.service';
import { DocumentsService } from '../documents/documents.service';
import { DriveSettingsService } from '../documents/drive-settings.service';
import { UploadsService } from './uploads.service';
import { today } from '../common/db-helpers';

/**
 * The documents module's part of the hourly sweep:
 *  - expiry reminders at each of the consultancy's windows (90, 30, 7 days,
 *    the day itself by default), to the student and their consultant;
 *  - emptying the trash once the retention period has passed;
 *  - throwing away resumable uploads nobody finished.
 */
@Injectable()
export class DocumentRemindersService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly reminders: RemindersService,
    private readonly notifications: NotificationsService,
    private readonly documents: DocumentsService,
    private readonly settings: DriveSettingsService,
    private readonly uploads: UploadsService,
  ) {}

  onModuleInit(): void {
    this.reminders.register('document-expiry', () => this.expiry());
    this.reminders.register('trash-purge', () => this.purge());
    this.reminders.register('upload-cleanup', () => this.uploads.cleanExpired());
  }

  async expiry(): Promise<number> {
    let sent = 0;
    const all = await this.db.select({ id: tenants.id }).from(tenants).where(eq(tenants.status, 'active'));
    for (const t of all) {
      const windows = [...(await this.settings.get(t.id)).expiryReminderDays].sort((a, b) => a - b);
      if (!windows.length) continue;
      const rows = await this.db
        .select({
          id: documents.id,
          typeKey: documents.typeKey,
          expiresOn: documents.expiresOn,
          notified: documents.expiryNotifiedDays,
          clientId: documents.clientId,
          studentUserId: clients.userId,
          studentName: clients.fullName,
          consultantUserId: consultants.userId,
        })
        .from(documents)
        .innerJoin(clients, eq(clients.id, documents.clientId))
        .leftJoin(consultants, eq(consultants.id, clients.assignedConsultantId))
        .where(
          and(
            eq(documents.tenantId, t.id),
            isNotNull(documents.expiresOn),
            isNull(documents.deletedAt),
            isNull(documents.trashedAt),
            isNull(documents.supersededBy),
            sql`${documents.expiresOn} <= current_date + ${windows.at(-1)!}::int`,
          ),
        );

      for (const r of rows) {
        const daysLeft = Math.round((Date.parse(`${r.expiresOn}T00:00:00Z`) - Date.parse(`${today()}T00:00:00Z`)) / 86_400_000);
        const window = windows.find((w) => daysLeft <= w);
        if (window === undefined) continue;
        if (r.notified !== null && r.notified <= window) continue;
        // Claim it first, so a second instance running the same sweep sends nothing.
        const [claimed] = await this.db
          .update(documents)
          .set({ expiryNotifiedDays: window })
          .where(
            and(
              eq(documents.id, r.id),
              sql`(${documents.expiryNotifiedDays} is null or ${documents.expiryNotifiedDays} > ${window})`,
            ),
          )
          .returning({ id: documents.id });
        if (!claimed) continue;

        const label = await this.documents.labelFor(t.id, r.typeKey);
        const when =
          daysLeft < 0 ? `expired on ${r.expiresOn}` : daysLeft === 0 ? 'expires today' : `expires on ${r.expiresOn} (in ${daysLeft} days)`;
        if (r.studentUserId) {
          await this.notifications.push({
            userId: r.studentUserId,
            type: 'document_expiring',
            title: `Your ${label} ${when}`,
            body: 'Upload the renewed one as soon as you have it - an expired document can hold up your application.',
            link: '/portal/documents',
            email: true,
          });
        }
        if (r.consultantUserId) {
          await this.notifications.push({
            userId: r.consultantUserId,
            type: 'document_expiring',
            title: `${r.studentName}’s ${label} ${when}`,
            body: null,
            link: `/desk/documents?clientId=${r.clientId}`,
            email: true,
          });
        }
        sent++;
      }
    }
    return sent;
  }

  async purge(): Promise<number> {
    let purged = 0;
    const all = await this.db.select({ id: tenants.id }).from(tenants);
    for (const t of all) {
      const { retentionDays } = await this.settings.get(t.id);
      purged += await this.documents.purgeExpiredTrash(t.id, retentionDays);
    }
    return purged;
  }
}

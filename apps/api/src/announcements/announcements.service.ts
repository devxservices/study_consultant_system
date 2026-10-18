import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNull, or } from 'drizzle-orm';
import type {
  AnnouncementView,
  Audience,
  AuthUser,
  CreateAnnouncementInput,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { announcements, users } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { localIsoDate } from '@crm/shared';

/**
 * Notices from the consultancy to its clients, its staff, or both. A manager
 * writes them; everyone else only ever sees the ones addressed to them.
 */
@Injectable()
export class AnnouncementsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** What this person should see now: their audience, not yet expired, pinned first. */
  async feed(actor: AuthUser, limit = 10): Promise<AnnouncementView[]> {
    const audiences: Audience[] =
      actor.role === 'client' ? ['everyone', 'clients'] : ['everyone', 'staff'];
    const today = localIsoDate();
    return this.query(
      and(
        eq(announcements.tenantId, tenantOf(actor)),
        inArray(announcements.audience, audiences),
        or(isNull(announcements.expiresOn), gte(announcements.expiresOn, today)),
      ),
      limit,
    );
  }

  /** Everything, including expired and client-only notices - the manager's page. */
  async all(actor: AuthUser): Promise<AnnouncementView[]> {
    this.assertManager(actor);
    return this.query(eq(announcements.tenantId, tenantOf(actor)), 200);
  }

  async create(actor: AuthUser, input: CreateAnnouncementInput): Promise<AnnouncementView> {
    this.assertManager(actor);
    const tenantId = tenantOf(actor);
    const [row] = await this.db
      .insert(announcements)
      .values({
        tenantId,
        title: input.title,
        body: input.body,
        audience: input.audience,
        pinned: input.pinned,
        expiresOn: input.expiresOn ?? null,
        createdBy: actor.id,
      })
      .returning({ id: announcements.id });

    await this.audit.record(actor, {
      action: 'announcement.published',
      entityType: 'announcement',
      entityId: row!.id,
      metadata: { title: input.title, audience: input.audience },
    });

    // Everyone it is for hears about it once, in the bell.
    const roles =
      input.audience === 'clients'
        ? (['client'] as const)
        : input.audience === 'staff'
          ? (['manager', 'consultant'] as const)
          : input.audience === 'partners'
            ? (['partner'] as const)
            : (['manager', 'consultant', 'client'] as const);
    const recipients = await this.db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), inArray(users.role, [...roles]), eq(users.isActive, true)));
    const home = { client: '/portal', consultant: '/desk', manager: '/overview', partner: '/partner' } as const;
    for (const r of recipients) {
      if (r.id === actor.id) continue;
      await this.notifications.push({
        userId: r.id,
        type: 'announcement',
        title: input.title,
        body: input.body.length > 140 ? `${input.body.slice(0, 139)}…` : input.body,
        link: home[r.role as keyof typeof home] ?? null,
      });
    }

    const [view] = await this.query(eq(announcements.id, row!.id), 1);
    return view!;
  }

  async remove(actor: AuthUser, id: string): Promise<void> {
    this.assertManager(actor);
    const [row] = await this.db
      .delete(announcements)
      .where(and(eq(announcements.id, id), eq(announcements.tenantId, tenantOf(actor))))
      .returning({ title: announcements.title });
    if (!row) throw new NotFoundException('Announcement not found.');
    await this.audit.record(actor, {
      action: 'announcement.deleted',
      entityType: 'announcement',
      entityId: id,
      metadata: { title: row.title },
    });
  }

  private assertManager(actor: AuthUser): void {
    if (actor.role !== 'manager') throw new ForbiddenException('Only a manager can do this.');
  }

  private async query(where: ReturnType<typeof and>, limit: number): Promise<AnnouncementView[]> {
    const rows = await this.db
      .select({ a: announcements, authorName: users.fullName })
      .from(announcements)
      .leftJoin(users, eq(users.id, announcements.createdBy))
      .where(where)
      .orderBy(desc(announcements.pinned), desc(announcements.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.a.id,
      title: r.a.title,
      body: r.a.body,
      audience: r.a.audience as Audience,
      pinned: r.a.pinned,
      expiresOn: r.a.expiresOn,
      authorName: r.authorName,
      createdAt: new Date(r.a.createdAt).toISOString(),
    }));
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  DEFAULT_DRIVE_SETTINGS,
  UPLOAD_TYPES,
  type AuthUser,
  type DriveSettingsInput,
  type DriveSettingsView,
  type UploadTypeKey,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { driveSettings } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { tenantOf } from '../tenancy/tenant-resolver.service';

/**
 * A consultancy's upload rules - which file types, how large - and its
 * document housekeeping: the download naming pattern, how long the trash
 * keeps things, and when expiry reminders go out. A consultancy that never
 * changed anything gets the defaults.
 */
@Injectable()
export class DriveSettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async get(tenantId: string): Promise<DriveSettingsView> {
    const [row] = await this.db.select().from(driveSettings).where(eq(driveSettings.tenantId, tenantId)).limit(1);
    if (!row) return { ...DEFAULT_DRIVE_SETTINGS };
    return {
      acceptedTypes: (row.acceptedTypes as UploadTypeKey[]).filter((k) => UPLOAD_TYPES.some((t) => t.key === k)),
      maxFileMb: row.maxFileMb,
      renamePattern: row.renamePattern,
      retentionDays: row.retentionDays,
      expiryReminderDays: [...(row.expiryReminderDays ?? [])].sort((a, b) => b - a),
    };
  }

  /** What validateUpload checks a file against, for this consultancy. */
  async uploadRules(tenantId: string): Promise<{ maxBytes: number; accepted: string[] }> {
    const s = await this.get(tenantId);
    return {
      maxBytes: s.maxFileMb * 1024 * 1024,
      accepted: UPLOAD_TYPES.filter((t) => s.acceptedTypes.includes(t.key)).map((t) => t.mime),
    };
  }

  async update(actor: AuthUser, input: DriveSettingsInput): Promise<DriveSettingsView> {
    const tenantId = tenantOf(actor);
    const before = await this.get(tenantId);
    const values = {
      acceptedTypes: [...new Set(input.acceptedTypes)],
      maxFileMb: input.maxFileMb,
      renamePattern: input.renamePattern,
      retentionDays: input.retentionDays,
      expiryReminderDays: [...new Set(input.expiryReminderDays)].sort((a, b) => b - a),
      updatedBy: actor.id,
      updatedAt: new Date(),
    };
    await this.db
      .insert(driveSettings)
      .values({ tenantId, ...values })
      .onConflictDoUpdate({ target: driveSettings.tenantId, set: values });
    const after = await this.get(tenantId);
    await this.audit.record(actor, {
      action: 'drive.settings_changed',
      entityType: 'settings',
      metadata: { before, after },
    });
    return after;
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { inArray, sql } from 'drizzle-orm';
import {
  platformBillingSchema,
  platformLegalSchema,
  type AuthUser,
  type LegalDocsView,
  type PlatformBilling,
  type PlatformLegal,
  type PlatformSettingsView,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { platformSettings } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { iso } from '../common/db-helpers';

type Group = 'billing' | 'legal';

interface Loaded {
  billing: PlatformBilling;
  legal: PlatformLegal;
  legalUpdatedAt: string | null;
}

/**
 * The platform admin's own settings: how consultancies pay for the platform,
 * and the terms and privacy policy everyone is shown. Read on every request
 * that checks a consultancy's subscription, so they are kept for a short
 * while; a change made here clears that at once.
 */
@Injectable()
export class PlatformSettingsService {
  private cache: { at: number; value: Loaded } | null = null;
  private static readonly TTL_MS = 30_000;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async billing(): Promise<PlatformBilling> {
    return (await this.load()).billing;
  }

  async view(): Promise<PlatformSettingsView> {
    const v = await this.load();
    return { billing: v.billing, legal: { ...v.legal, updatedAt: v.legalUpdatedAt } };
  }

  /** What anyone may read: the published documents, or null where there is none. */
  async legalDocs(): Promise<LegalDocsView> {
    const v = await this.load();
    return {
      operatorName: v.legal.operatorName,
      terms: v.legal.terms || null,
      privacy: v.legal.privacy || null,
      updatedAt: v.legalUpdatedAt,
    };
  }

  async setBilling(actor: AuthUser, input: PlatformBilling): Promise<PlatformSettingsView> {
    await this.save(actor, 'billing', platformBillingSchema.parse(input));
    return this.view();
  }

  async setLegal(actor: AuthUser, input: PlatformLegal): Promise<PlatformSettingsView> {
    await this.save(actor, 'legal', platformLegalSchema.parse(input));
    return this.view();
  }

  private async save(actor: AuthUser, key: Group, value: Record<string, unknown>): Promise<void> {
    await this.db
      .insert(platformSettings)
      .values({ key, value, updatedBy: actor.id })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value, updatedBy: actor.id, updatedAt: sql`now()` },
      });
    this.cache = null;
    await this.audit.record(actor, {
      action: 'platform.settings_changed',
      entityType: 'platform',
      tenantId: null,
      // The texts themselves can be long; which group changed is the record.
      metadata: { group: key },
    });
  }

  private async load(): Promise<Loaded> {
    if (this.cache && Date.now() - this.cache.at < PlatformSettingsService.TTL_MS) return this.cache.value;
    const rows = await this.db
      .select()
      .from(platformSettings)
      .where(inArray(platformSettings.key, ['billing', 'legal']));
    const by = new Map(rows.map((r) => [r.key, r]));
    // Parsing with the schemas fills defaults and drops anything stale.
    const billing = platformBillingSchema.safeParse(by.get('billing')?.value ?? {});
    const legal = platformLegalSchema.safeParse(by.get('legal')?.value ?? {});
    const value: Loaded = {
      billing: billing.success ? billing.data : platformBillingSchema.parse({}),
      legal: legal.success ? legal.data : platformLegalSchema.parse({}),
      legalUpdatedAt: by.get('legal') ? iso(by.get('legal')!.updatedAt) : null,
    };
    this.cache = { at: Date.now(), value };
    return value;
  }
}

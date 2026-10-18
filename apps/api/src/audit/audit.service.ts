import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { AuditAction, AuthUser } from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { auditLog } from '../db/schema';
import { currentRequest } from '../common/request-context';

export interface AuditEntry {
  action: AuditAction;
  entityType:
    | 'client'
    | 'case'
    | 'document'
    | 'user'
    | 'message'
    | 'tenant'
    | 'domain'
    | 'invoice'
    | 'payment'
    | 'task'
    | 'announcement'
    | 'permission'
    | 'export'
    | 'role'
    | 'folder'
    | 'share'
    | 'grant'
    | 'settings'
    | 'country'
    | 'workflow'
    | 'automation'
    | 'quote'
    | 'credit_note'
    | 'expense'
    | 'bill'
    | 'journal'
    | 'journal_entry'
    | 'ledger_account'
    | 'finance_settings'
    | 'tax_rate'
    | 'promo_code'
    | 'refund_request'
    | 'payment_submission'
    | 'online_payment'
    | 'day_close'
    | 'bank_import'
    | 'bank'
    | 'institution'
    | 'agreement'
    | 'commission'
    | 'claim'
    | 'partner'
    | 'payout'
    | 'course'
    | 'batch'
    | 'enrollment'
    | 'assessment'
    | 'test_result'
    | 'homework'
    | 'enquiry'
    | 'platform';
  /**
   * The consultancy the event belongs to. Defaults to the actor's; given
   * explicitly when there is no actor (a system job, a failed sign-in) or the
   * actor is a platform admin acting on a consultancy.
   */
  tenantId?: string | null;
  entityId?: string | null;
  caseId?: string | null;
  clientId?: string | null;
  metadata?: Record<string, unknown>;
}

/** A second view of the same record by the same person inside this window is not news. */
const VIEW_WINDOW_MS = 15 * 60 * 1000;

/**
 * Append-only history of everything worth disputing later - and, since the
 * owner asked for it, of who looked at what.
 *
 * Rows can only ever be added: the database itself refuses an UPDATE or
 * DELETE on audit_log (see migration 0003). Each row carries the IP address
 * and browser the request came from.
 *
 * Audit writes must never break the action they describe, so failures are
 * logged rather than thrown - a consultant should not see "verify failed"
 * because the log table hiccuped.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  async record(actor: AuthUser | null, entry: AuditEntry): Promise<void> {
    const ctx = currentRequest();
    try {
      await this.db.insert(auditLog).values({
        tenantId: entry.tenantId !== undefined ? entry.tenantId : (actor?.tenantId ?? null),
        actorId: actor?.id ?? null,
        actorRole: actor?.role ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        caseId: entry.caseId ?? null,
        clientId: entry.clientId ?? null,
        metadata: entry.metadata ?? null,
        ipAddress: ctx?.ip ?? null,
        userAgent: ctx?.userAgent ?? null,
      });
    } catch (err) {
      this.logger.error(`Failed to write audit entry ${entry.action}`, err as Error);
    }
  }

  /**
   * A member of staff opening a record. Clients reading their own file are
   * not recorded - the question this answers is "which of our people looked at
   * this passport". Repeat views within fifteen minutes are folded into the
   * first, so opening a page and refreshing it is one event, not five.
   */
  async recordView(actor: AuthUser, entry: AuditEntry & { entityId: string }): Promise<void> {
    if (actor.role !== 'manager' && actor.role !== 'consultant') return;
    const ctx = currentRequest();
    const tenantId = entry.tenantId !== undefined ? entry.tenantId : actor.tenantId;
    const since = new Date(Date.now() - VIEW_WINDOW_MS);
    try {
      // One round trip: the row is written only if the same person has not
      // opened the same record in the window. Served by audit_actor_idx.
      await this.db.execute(sql`
        insert into audit_log
          (tenant_id, actor_id, actor_role, action, entity_type, entity_id, case_id, client_id, metadata, ip_address, user_agent)
        select ${tenantId}::uuid, ${actor.id}::uuid, ${actor.role}::role, ${entry.action}, ${entry.entityType},
               ${entry.entityId}::uuid, ${entry.caseId ?? null}::uuid, ${entry.clientId ?? null}::uuid,
               ${entry.metadata ? JSON.stringify(entry.metadata) : null}::jsonb, ${ctx?.ip ?? null}, ${ctx?.userAgent ?? null}
        where not exists (
          select 1 from audit_log
          where actor_id = ${actor.id}::uuid
            and action = ${entry.action}
            and entity_id = ${entry.entityId}::uuid
            and created_at >= ${since.toISOString()}::timestamptz
        )`);
    } catch (err) {
      this.logger.error(`Failed to write audit entry ${entry.action}`, err as Error);
    }
  }
}

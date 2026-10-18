import { Inject, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { and, desc, eq, isNotNull, isNull, ne, or } from 'drizzle-orm';
import {
  addCalendarDays,
  addCalendarMonths,
  formatMoney,
  subscriptionState,
  type AuthUser,
  type Currency,
  type MySubscriptionView,
  type PaymentMethod,
  type SubscriptionPaymentInput,
  type SubscriptionPaymentView,
  type SubscriptionState,
  type SubscriptionStatus,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { plans, subscriptionPayments, tenants, users } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { MailService, textToHtml } from '../mail/mail.service';
import { RemindersService } from '../reminders/reminders.service';
import { iso, today } from '../common/db-helpers';
import { EntitlementsService } from './entitlements.service';
import { PlatformSettingsService } from './platform-settings.service';
import { tenantIdentity } from './tenant-links';

/**
 * Paying for the platform: the payments a consultancy makes, the date they
 * are paid until, and the reminders before and after it.
 *
 * Access follows the date (see subscriptionState): the platform admin records
 * a payment and the consultancy is open again on its next request.
 */
@Injectable()
export class SubscriptionsService implements OnModuleInit {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly reminders: RemindersService,
    private readonly entitlements: EntitlementsService,
    private readonly settings: PlatformSettingsService,
  ) {}

  onModuleInit(): void {
    this.reminders.register('subscription-renewals', () => this.remind());
  }

  /**
   * A payment received from a consultancy. It extends the paid-until date by
   * `months` from where it stood - or, after a long lapse, from the day the
   * money came in, so nobody pays for months they had no use of.
   */
  async recordPayment(actor: AuthUser, tenantId: string, input: SubscriptionPaymentInput): Promise<SubscriptionPaymentView> {
    const { graceDays } = await this.settings.billing();
    const row = await this.db.transaction(async (tx) => {
      // Locked, so two payments recorded at once both count.
      const [t] = await tx
        .select({ id: tenants.id, periodEnd: tenants.currentPeriodEnd })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .for('update');
      if (!t) throw new NotFoundException('Consultancy not found.');

      const continues = t.periodEnd !== null && addCalendarDays(t.periodEnd, graceDays) >= input.receivedOn;
      const periodFrom = continues ? addCalendarDays(t.periodEnd!, 1) : input.receivedOn;
      const periodTo = addCalendarDays(addCalendarMonths(periodFrom, input.months), -1);

      const [payment] = await tx
        .insert(subscriptionPayments)
        .values({
          tenantId,
          amount: input.amount,
          currency: input.currency,
          months: input.months,
          receivedOn: input.receivedOn,
          method: input.method,
          reference: input.reference || null,
          note: input.note || null,
          periodFrom,
          periodTo,
          recordedBy: actor.id,
        })
        .returning();
      await tx
        .update(tenants)
        .set({ subscriptionStatus: 'active', currentPeriodEnd: periodTo, renewalNoticeKey: null, updatedAt: new Date() })
        .where(eq(tenants.id, tenantId));
      return payment!;
    });
    this.entitlements.invalidate();

    await this.audit.record(actor, {
      action: 'tenant.subscription_paid',
      entityType: 'tenant',
      entityId: tenantId,
      tenantId,
      metadata: {
        amount: formatMoney(row.amount, row.currency),
        months: row.months,
        from: row.periodFrom,
        to: row.periodTo,
        reference: row.reference,
      },
    });
    await this.sendReceipt(tenantId, row);
    return this.toView(row, actor.fullName);
  }

  async payments(tenantId: string): Promise<SubscriptionPaymentView[]> {
    const rows = await this.db
      .select({ p: subscriptionPayments, by: users.fullName })
      .from(subscriptionPayments)
      .leftJoin(users, eq(users.id, subscriptionPayments.recordedBy))
      .where(eq(subscriptionPayments.tenantId, tenantId))
      .orderBy(desc(subscriptionPayments.receivedOn), desc(subscriptionPayments.createdAt))
      .limit(100);
    return rows.map((r) => this.toView(r.p, r.by));
  }

  /** The consultancy's manager: their plan, where they stand and how to pay. */
  async mine(user: AuthUser): Promise<MySubscriptionView> {
    const tenantId = user.tenantId!;
    const [[row], plan, billing, legal, payments] = await Promise.all([
      this.db
        .select({
          status: tenants.subscriptionStatus,
          periodEnd: tenants.currentPeriodEnd,
          planName: plans.name,
          price: plans.priceMonthly,
          currency: plans.currency,
        })
        .from(tenants)
        .leftJoin(plans, eq(plans.id, tenants.planId))
        .where(eq(tenants.id, tenantId))
        .limit(1),
      this.entitlements.plan(tenantId),
      this.settings.billing(),
      this.settings.legalDocs(),
      this.payments(tenantId),
    ]);
    return {
      planName: row?.planName ?? null,
      priceMonthly: row?.price ?? null,
      currency: (row?.currency as Currency | null) ?? null,
      status: (row?.status as SubscriptionStatus) ?? 'active',
      state: plan.subscription,
      paymentInstructions: billing.paymentInstructions,
      operatorName: legal.operatorName,
      // Who on the platform's side recorded it is not the consultancy's business.
      payments: payments.map((p) => ({ ...p, recordedBy: null })),
    };
  }

  /* ---------------------------------------------------------------- */
  /* Reminders                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Emails each consultancy's managers when its paid-until date comes close,
   * when it passes (the grace days start) and when the grace days are over.
   * Each one goes once per date: the stage sent is claimed in
   * renewal_notice_key with a conditional update first.
   */
  async remind(): Promise<number> {
    const { graceDays, paymentInstructions } = await this.settings.billing();
    const day = today();
    const due = await this.db
      .select({
        id: tenants.id,
        status: tenants.subscriptionStatus,
        periodEnd: tenants.currentPeriodEnd,
        key: tenants.renewalNoticeKey,
      })
      .from(tenants)
      .where(and(eq(tenants.status, 'active'), isNotNull(tenants.currentPeriodEnd)));

    let sent = 0;
    for (const t of due) {
      const state = subscriptionState(t.status as SubscriptionStatus, t.periodEnd, day, graceDays);
      const stage = state.access === 'read_only' ? 'read_only' : state.daysLeft! < 0 ? 'grace' : state.endingSoon ? 'ending' : null;
      // A cancelled subscription that runs out is not chased for payment.
      if (!stage || (t.status === 'cancelled' && stage !== 'ending')) continue;
      const key = `${t.periodEnd}:${stage}`;
      if (t.key === key) continue;

      const claimed = await this.db
        .update(tenants)
        .set({ renewalNoticeKey: key })
        .where(and(eq(tenants.id, t.id), or(isNull(tenants.renewalNoticeKey), ne(tenants.renewalNoticeKey, key))))
        .returning({ id: tenants.id });
      if (!claimed.length) continue;

      try {
        await this.notifyManagers(t.id, stage, state, paymentInstructions);
        sent++;
      } catch (err) {
        this.logger.error(`renewal reminder for ${t.id} not sent`, err as Error);
      }
    }
    return sent;
  }

  private async notifyManagers(
    tenantId: string,
    stage: 'ending' | 'grace' | 'read_only',
    state: SubscriptionState,
    paymentInstructions: string,
  ): Promise<void> {
    const [site, managers, legal] = await Promise.all([
      tenantIdentity(this.db, tenantId),
      this.managers(tenantId),
      this.settings.legalDocs(),
    ]);
    const platform = legal.operatorName || 'the platform';
    const until = longDate(state.paidUntil!);
    const page = `${site.origin}/overview/subscription`;
    const how = paymentInstructions ? `\n\nHow to pay:\n${paymentInstructions}` : '';
    const subject =
      stage === 'ending'
        ? `${site.name}: your subscription runs until ${until}`
        : stage === 'grace'
          ? `${site.name}: your subscription payment is overdue`
          : `${site.name}: your records are read-only until the subscription is renewed`;
    const body =
      stage === 'ending'
        ? `Your ${site.name} subscription is paid until ${until}. To keep everything running without a break, renew it before then.`
        : stage === 'grace'
          ? `Your ${site.name} subscription ended on ${until}. Everything still works until ${longDate(state.graceEndsOn!)}; after that your team can still sign in, see and export everything, but cannot add or change records until a payment is recorded.`
          : `Your ${site.name} subscription ended on ${until} and the grace days are over. Your team can still sign in, see and export everything and reply to students, but cannot add or change records until a payment is recorded. Students and partners are not affected.`;

    for (const m of managers) {
      const text = `Hello ${m.fullName.split(' ')[0]},\n\n${body}${how}\n\nYour plan and payments: ${page}\n\n${platform}`;
      await this.mail.send({ to: m.email, subject, text, html: textToHtml(text) });
    }
  }

  private async sendReceipt(tenantId: string, p: typeof subscriptionPayments.$inferSelect): Promise<void> {
    const [site, managers, legal] = await Promise.all([
      tenantIdentity(this.db, tenantId),
      this.managers(tenantId),
      this.settings.legalDocs(),
    ]);
    const platform = legal.operatorName || 'the platform';
    for (const m of managers) {
      const text = `Hello ${m.fullName.split(' ')[0]},\n\nThank you - we received ${formatMoney(p.amount, p.currency)} on ${longDate(p.receivedOn)}${p.reference ? ` (reference ${p.reference})` : ''} for ${site.name}'s subscription.\n\nIt covers ${longDate(p.periodFrom)} to ${longDate(p.periodTo)}.\n\nYour plan and payments: ${site.origin}/overview/subscription\n\n${platform}`;
      await this.mail.send({ to: m.email, subject: `${site.name}: subscription paid until ${longDate(p.periodTo)}`, text, html: textToHtml(text) });
    }
  }

  private managers(tenantId: string) {
    return this.db
      .select({ email: users.email, fullName: users.fullName })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.role, 'manager'), eq(users.isActive, true)));
  }

  private toView(p: typeof subscriptionPayments.$inferSelect, recordedBy: string | null): SubscriptionPaymentView {
    return {
      id: p.id,
      amount: p.amount,
      currency: p.currency as Currency,
      months: p.months,
      receivedOn: p.receivedOn,
      method: p.method as PaymentMethod,
      reference: p.reference,
      note: p.note,
      periodFrom: p.periodFrom,
      periodTo: p.periodTo,
      recordedBy,
      createdAt: iso(p.createdAt),
    };
  }
}

/** 2026-11-01 -> 1 November 2026: unambiguous in an email read anywhere. */
function longDate(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}


import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { allocateInstallments, formatMoney } from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { clients, consultants, financeReminders, financeSettings, installments, invoices } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RemindersService } from '../reminders/reminders.service';
import { addDays, today } from '../common/db-helpers';
import { BillingService } from '../billing/billing.service';

/** A placeholder that claims an installment's late fee while the fee invoice is written. */
const CLAIMING = '00000000-0000-0000-0000-00000000fee0';

interface Due {
  tenantId: string;
  invoiceId: string;
  number: string;
  clientId: string;
  currency: string;
  installmentId: string | null;
  label: string;
  dueDate: string;
  left: number;
}

/**
 * Money that falls due: reminders to the student before and after each due
 * date (the consultancy's own offsets, e.g. 3 days before, on the day, a
 * week late), and a late fee once the grace period has passed - once per
 * installment, or per invoice when it is not in parts.
 *
 * Both run from the hourly sweep. Each reminder is claimed by inserting its
 * (invoice, installment, offset) row and each late fee by a conditional
 * update, so several API instances never send or charge anything twice.
 */
@Injectable()
export class FinanceRemindersService implements OnModuleInit {
  private readonly logger = new Logger(FinanceRemindersService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly reminders: RemindersService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly billing: BillingService,
  ) {}

  onModuleInit(): void {
    this.reminders.register('payment-reminders', () => this.remind());
    this.reminders.register('late-fees', () => this.lateFees());
  }

  /**
   * What is still owed, per installment (or per invoice without them), on
   * issued invoices whose due dates fall between `from` and `to`.
   */
  private async dues(tenantId: string, from: string, to: string): Promise<Due[]> {
    const rows = await this.db
      .select({
        id: invoices.id,
        number: invoices.number,
        clientId: invoices.clientId,
        currency: invoices.currency,
        dueDate: invoices.dueDate,
        total: invoices.total,
        parent: invoices.parentInvoiceId,
        settled: sql<string>`coalesce((select sum(case when p.kind = 'payment' then p.amount else -p.amount end) from payments p where p.invoice_id = ${invoices.id} and p.voided_at is null), 0)
          + coalesce((select sum(cn.amount) from credit_notes cn where cn.invoice_id = ${invoices.id} and cn.voided_at is null), 0)`,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.tenantId, tenantId),
          eq(invoices.status, 'issued'),
          sql`(
            (not exists (select 1 from installments x where x.invoice_id = ${invoices.id}) and ${invoices.dueDate} between ${from} and ${to})
            or exists (select 1 from installments x where x.invoice_id = ${invoices.id} and x.due_date between ${from} and ${to})
          )`,
        ),
      );
    if (!rows.length) return [];
    const plans = await this.db.select().from(installments).where(inArray(installments.invoiceId, rows.map((r) => r.id))).orderBy(asc(installments.seq));
    const out: Due[] = [];
    const day = today();
    for (const r of rows) {
      const settled = Number(r.settled);
      const plan = plans.filter((p) => p.invoiceId === r.id);
      if (plan.length) {
        for (const i of allocateInstallments(plan, settled, day)) {
          if (i.amount - i.paid > 0 && i.dueDate >= from && i.dueDate <= to) {
            out.push({ tenantId, invoiceId: r.id, number: r.number, clientId: r.clientId, currency: r.currency, installmentId: i.id, label: i.label ?? `installment ${i.seq}`, dueDate: i.dueDate, left: i.amount - i.paid });
          }
        }
      } else if (r.total - settled > 0) {
        out.push({ tenantId, invoiceId: r.id, number: r.number, clientId: r.clientId, currency: r.currency, installmentId: null, label: 'payment', dueDate: r.dueDate, left: r.total - settled });
      }
    }
    return out;
  }

  /** Reminders whose day is today (or was in the last two days, for a sweep that missed one). */
  async remind(): Promise<number> {
    const settings = await this.db.select({ tenantId: financeSettings.tenantId, offsets: financeSettings.reminderOffsets }).from(financeSettings);
    const day = today();
    let sent = 0;
    for (const s of settings) {
      const offsets = (s.offsets ?? []).filter((o) => Number.isInteger(o));
      if (!offsets.length) continue;
      // Due dates that some offset makes "today": due = today - offset.
      const from = addDays(day, -Math.max(...offsets) - 2);
      const to = addDays(day, -Math.min(...offsets));
      const dues = await this.dues(s.tenantId, from, to);
      for (const d of dues) {
        for (const offset of offsets) {
          const when = addDays(d.dueDate, offset);
          if (when > day || when < addDays(day, -2)) continue;
          const [claimed] = await this.db
            .insert(financeReminders)
            .values({ tenantId: d.tenantId, invoiceId: d.invoiceId, installmentId: d.installmentId, offsetDays: offset })
            .onConflictDoNothing()
            .returning({ id: financeReminders.id });
          if (!claimed) continue;
          await this.send(d, offset);
          sent++;
        }
      }
    }
    return sent;
  }

  private async send(d: Due, offset: number): Promise<void> {
    const amount = formatMoney(d.left, d.currency);
    const late = offset > 0;
    const title = late
      ? `${amount} is ${offset} day${offset === 1 ? '' : 's'} overdue on invoice ${d.number}`
      : offset === 0
        ? `${amount} is due today on invoice ${d.number}`
        : `${amount} is due on ${d.dueDate} (invoice ${d.number})`;
    await this.billing.deliverToClient(d.tenantId, d.clientId, late ? 'payment_overdue' : 'installment_due', {
      title,
      body: `This is your ${d.label}. Pay online, or upload proof of a transfer, from your portal.`,
      link: `/portal/payments/invoices/${d.invoiceId}`,
    });
    if (late) {
      // Their consultant hears about money that is late, once per reminder.
      const [c] = await this.db
        .select({ userId: consultants.userId, name: clients.fullName })
        .from(clients)
        .leftJoin(consultants, eq(consultants.id, clients.assignedConsultantId))
        .where(eq(clients.id, d.clientId))
        .limit(1);
      if (c?.userId) {
        await this.notifications.push({ userId: c.userId, type: 'payment_overdue', title: `${c.name}: ${title}`, body: null, link: `/desk/invoices/${d.invoiceId}` });
      }
    }
  }

  /** Late fees for everything past due plus the grace period, charged once each. */
  async lateFees(): Promise<number> {
    const settings = await this.db.select().from(financeSettings).where(sql`${financeSettings.lateFeeKind} <> 'none' and ${financeSettings.lateFeeValue} > 0`);
    const day = today();
    let charged = 0;
    for (const s of settings) {
      const cutoff = addDays(day, -s.lateFeeGraceDays - 1);
      // Anything due up to a year back that is still owed.
      const dues = await this.dues(s.tenantId, addDays(cutoff, -365), cutoff);
      for (const d of dues) {
        // A late fee does not earn its own late fee.
        const [inv] = await this.db.select({ parent: invoices.parentInvoiceId, caseId: invoices.caseId }).from(invoices).where(eq(invoices.id, d.invoiceId)).limit(1);
        if (!inv || inv.parent) continue;
        const claimed = d.installmentId
          ? await this.db
              .update(installments)
              .set({ lateFeeInvoiceId: CLAIMING })
              .where(and(eq(installments.id, d.installmentId), isNull(installments.lateFeeInvoiceId)))
              .returning({ id: installments.id })
          : await this.db
              .update(invoices)
              .set({ lateFeeInvoiceId: CLAIMING })
              .where(and(eq(invoices.id, d.invoiceId), isNull(invoices.lateFeeInvoiceId)))
              .returning({ id: invoices.id });
        if (!claimed.length) continue;
        const fee = s.lateFeeKind === 'percent' ? Math.max(1, Math.round((d.left * s.lateFeeValue) / 10_000)) : s.lateFeeValue;
        try {
          const priced = await this.billing.price(s.tenantId, d.currency, [
            { description: `Late payment fee: ${d.number}${d.installmentId ? `, ${d.label}` : ''} (due ${d.dueDate})`, quantity: 1, unitAmount: fee, category: 'late_fee', taxRateId: null },
          ]);
          const feeInvoice = await this.billing.issue(s.tenantId, {
            clientId: d.clientId,
            caseId: inv.caseId,
            currency: d.currency,
            issueDate: day,
            dueDate: addDays(day, 7),
            priced,
            status: 'issued',
            notes: `Charged because ${formatMoney(d.left, d.currency)} was still owed ${s.lateFeeGraceDays} days after it fell due.`,
            discountReason: null,
            fxRate: d.currency === s.baseCurrency ? 1 : null,
            createdBy: null,
            installments: [],
            parentInvoiceId: d.invoiceId,
          });
          if (d.installmentId) await this.db.update(installments).set({ lateFeeInvoiceId: feeInvoice.id }).where(eq(installments.id, d.installmentId));
          else await this.db.update(invoices).set({ lateFeeInvoiceId: feeInvoice.id }).where(eq(invoices.id, d.invoiceId));
          await this.audit.record(null, {
            tenantId: s.tenantId,
            action: 'late_fee.charged',
            entityType: 'invoice',
            entityId: feeInvoice.id,
            clientId: d.clientId,
            metadata: { on: d.number, installment: d.installmentId, fee, currency: d.currency, owed: d.left },
          });
          await this.billing.announceInvoice(s.tenantId, feeInvoice.id);
          charged++;
        } catch (err) {
          // Released, so the next sweep tries again.
          if (d.installmentId) await this.db.update(installments).set({ lateFeeInvoiceId: null }).where(eq(installments.id, d.installmentId));
          else await this.db.update(invoices).set({ lateFeeInvoiceId: null }).where(eq(invoices.id, d.invoiceId));
          this.logger.error(`late fee on ${d.number} not charged`, err as Error);
        }
      }
    }
    return charged;
  }
}

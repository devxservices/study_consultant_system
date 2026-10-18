import { Inject, Injectable } from '@nestjs/common';
import { aliasedTable, and, desc, eq, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import {
  localIsoDate,
  AUDIT_ACTION_LABEL,
  EXPORT_META,
  STAGE_DEFINITIONS,
  describeAudit,
  hasPermission,
  type AuditAction,
  type AuthUser,
  type ExportDataset,
  type Stage,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { auditLog, cases, clients, consultants, invoices, payments, users } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { EntitlementsService } from '../tenancy/entitlements.service';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { permissionDenied, seesAll } from '../auth/permissions';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/** Far more than any consultancy has; a ceiling so one click cannot exhaust the server. */
const MAX_ROWS = 50_000;

type Cell = string | number | boolean | null | undefined | Date;

export interface ExportFile {
  fileName: string;
  body: string;
  rows: number;
}

export interface ExportRange {
  from?: string;
  to?: string;
}

const INVOICE_ID = sql.raw('"invoices"."id"');
const paidSql = sql<number>`coalesce((
  select sum(case when p.kind = 'payment' then p.amount else -p.amount end)
  from payments p
  where p.invoice_id = ${INVOICE_ID} and p.voided_at is null
), 0)::bigint`;

const stageLabel = (s: string) => STAGE_DEFINITIONS[s as Stage]?.label ?? s;
const major = (minor: number | null | undefined) => (minor == null ? '' : (Number(minor) / 100).toFixed(2));
const day = (v: Date | string | null | undefined) =>
  v ? (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10) : '';
const stamp = (v: Date | string | null | undefined) =>
  v ? (v instanceof Date ? v : new Date(v)).toISOString().replace('T', ' ').slice(0, 19) : '';

/**
 * Spreadsheets as a consultancy takes its data away.
 *
 * - Only people with "export data" (every manager) - checked by the route -
 *   and money and the audit trail need their own permissions on top.
 * - What a consultant exports is exactly what they could see on screen: their
 *   own clients, unless they may see every client.
 * - Every export is itself recorded in the audit trail, with its row count.
 * - Cells that a spreadsheet would treat as a formula are neutralised, so a
 *   client who types `=HYPERLINK(...)` as their city cannot run anything on
 *   the machine of whoever opens the file.
 */
@Injectable()
export class ExportService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async export(actor: AuthUser, dataset: ExportDataset, range: ExportRange): Promise<ExportFile> {
    const meta = EXPORT_META[dataset];
    for (const p of meta.alsoRequires) {
      if (!hasPermission(actor, p)) throw permissionDenied(p);
    }
    const tenantId = tenantOf(actor);
    if (meta.billing) await this.entitlements.assertModule(tenantId, 'billing');

    const table = await this.build(actor, dataset, range);
    const body = toCsv(table.header, table.rows);
    const rows = table.rows.length;

    await this.audit.record(actor, {
      action: 'data.exported',
      entityType: 'export',
      metadata: {
        dataset: meta.label.toLowerCase(),
        key: dataset,
        rows,
        from: range.from ?? null,
        to: range.to ?? null,
        truncated: rows >= MAX_ROWS,
      },
    });

    const suffix = [range.from, range.to].filter(Boolean).join('-to-');
    return {
      fileName: `${dataset}${suffix ? `-${suffix}` : ''}-${localIsoDate()}.csv`,
      body,
      rows,
    };
  }

  private build(actor: AuthUser, dataset: ExportDataset, range: ExportRange) {
    switch (dataset) {
      case 'clients':
        return this.clients(actor, range);
      case 'applications':
        return this.applications(actor, range);
      case 'invoices':
        return this.invoices(actor, range);
      case 'payments':
        return this.payments(actor, range);
      case 'audit':
        return this.auditTrail(actor, range);
    }
  }

  /* ---------------------------------------------------------------- */

  /** Their own clients, unless they may see every client. */
  private mine(actor: AuthUser): SQL | undefined {
    return seesAll(actor) ? undefined : eq(clients.assignedConsultantId, actor.consultantId ?? NIL_UUID);
  }

  private between(column: SQLWrapper, range: ExportRange): SQL[] {
    const out: SQL[] = [];
    if (range.from) out.push(sql`${column} >= ${range.from}::date`);
    if (range.to) out.push(sql`${column} < (${range.to}::date + 1)`);
    return out;
  }

  private async clients(actor: AuthUser, range: ExportRange) {
    const rows = await this.db
      .select({ c: clients, consultantName: users.fullName })
      .from(clients)
      .leftJoin(consultants, eq(consultants.id, clients.assignedConsultantId))
      .leftJoin(users, eq(users.id, consultants.userId))
      .where(and(eq(clients.tenantId, tenantOf(actor)), this.mine(actor), ...this.between(clients.createdAt, range)))
      .orderBy(desc(clients.createdAt))
      .limit(MAX_ROWS);

    return {
      header: [
        'Name', 'Email', 'Phone', 'City', 'Consultant', 'Archived', 'Added',
        'Date of birth', 'Nationality', 'Passport number', 'Passport expiry',
        'Highest qualification', 'Last institution', 'Grade', 'Graduation year',
        'English test', 'English score', 'English test date',
        'Intended level', 'Intended field', 'Preferred countries', 'Budget', 'Lead source',
        'Emergency contact', 'Emergency phone',
      ],
      rows: rows.map(({ c, consultantName }): Cell[] => [
        c.fullName, c.email, c.phone, c.city, consultantName, c.archived ? 'Yes' : 'No', day(c.createdAt),
        c.dateOfBirth, c.nationality, c.passportNumber, c.passportExpiry,
        c.highestQualification, c.lastInstitution, c.lastGrade, c.graduationYear,
        c.englishTest, c.englishScore, c.englishTestDate,
        c.intendedLevel, c.intendedField, (c.preferredCountries ?? []).join('; '), c.budget, c.leadSource,
        c.emergencyContactName, c.emergencyContactPhone,
      ]),
    };
  }

  private async applications(actor: AuthUser, range: ExportRange) {
    const scope = seesAll(actor)
      ? undefined
      : or(
          eq(cases.consultantId, actor.consultantId ?? NIL_UUID),
          eq(clients.assignedConsultantId, actor.consultantId ?? NIL_UUID),
        );
    const rows = await this.db
      .select({ k: cases, clientName: clients.fullName, consultantName: users.fullName })
      .from(cases)
      .innerJoin(clients, eq(clients.id, cases.clientId))
      .leftJoin(consultants, eq(consultants.id, cases.consultantId))
      .leftJoin(users, eq(users.id, consultants.userId))
      .where(and(eq(cases.tenantId, tenantOf(actor)), scope, ...this.between(cases.createdAt, range)))
      .orderBy(desc(cases.createdAt))
      .limit(MAX_ROWS);

    return {
      header: [
        'Reference', 'Client', 'Consultant', 'Country', 'University', 'Programme', 'Intake',
        'Stage', 'Status', 'Opened', 'In stage since', 'Last activity', 'Closed',
        'Application deadline', 'Offer', 'Offer deadline', 'Visa appointment', 'Travel date',
      ],
      rows: rows.map(({ k, clientName, consultantName }): Cell[] => [
        k.reference, clientName, consultantName, k.targetCountry, k.targetUniversity, k.targetProgram, k.intake,
        k.currentStageName ?? stageLabel(k.currentStage), k.status, day(k.createdAt), day(k.stageEnteredAt), day(k.lastActivityAt),
        day(k.closedAt), k.applicationDeadline, k.offerType, k.offerDeadline, stamp(k.visaAppointmentAt), k.travelDate,
      ]),
    };
  }

  private async invoices(actor: AuthUser, range: ExportRange) {
    const rows = await this.db
      .select({
        number: invoices.number,
        clientName: clients.fullName,
        reference: cases.reference,
        currency: invoices.currency,
        issueDate: invoices.issueDate,
        dueDate: invoices.dueDate,
        status: invoices.status,
        total: invoices.total,
        paid: paidSql,
        voidReason: invoices.voidReason,
      })
      .from(invoices)
      .innerJoin(clients, eq(clients.id, invoices.clientId))
      .leftJoin(cases, eq(cases.id, invoices.caseId))
      .where(
        and(
          eq(invoices.tenantId, tenantOf(actor)),
          this.mine(actor),
          ...this.between(invoices.issueDate, range),
        ),
      )
      .orderBy(desc(invoices.issueDate), desc(invoices.number))
      .limit(MAX_ROWS);

    return {
      header: ['Invoice', 'Client', 'Application', 'Currency', 'Issued', 'Due', 'Status', 'Total', 'Paid', 'Balance', 'Void reason'],
      rows: rows.map((r): Cell[] => {
        const paid = Number(r.paid ?? 0);
        const balance = r.status === 'void' ? 0 : Math.max(0, Number(r.total) - paid);
        return [
          r.number, r.clientName, r.reference, r.currency, r.issueDate, r.dueDate, r.status,
          major(r.total), major(paid), major(balance), r.voidReason,
        ];
      }),
    };
  }

  private async payments(actor: AuthUser, range: ExportRange) {
    const recorder = aliasedTable(users, 'recorder');
    const rows = await this.db
      .select({
        number: payments.number,
        kind: payments.kind,
        invoice: invoices.number,
        clientName: clients.fullName,
        currency: payments.currency,
        amount: payments.amount,
        method: payments.method,
        reference: payments.reference,
        receivedOn: payments.receivedOn,
        recordedBy: recorder.fullName,
        voidedAt: payments.voidedAt,
        voidReason: payments.voidReason,
      })
      .from(payments)
      .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
      .innerJoin(clients, eq(clients.id, payments.clientId))
      .leftJoin(recorder, eq(recorder.id, payments.recordedBy))
      .where(
        and(
          eq(payments.tenantId, tenantOf(actor)),
          this.mine(actor),
          ...this.between(payments.receivedOn, range),
        ),
      )
      .orderBy(desc(payments.receivedOn), desc(payments.number))
      .limit(MAX_ROWS);

    return {
      header: ['Receipt', 'Kind', 'Invoice', 'Client', 'Currency', 'Amount', 'Method', 'Reference', 'Received', 'Recorded by', 'Voided', 'Void reason'],
      rows: rows.map((r): Cell[] => [
        r.number, r.kind, r.invoice, r.clientName, r.currency,
        major(r.kind === 'refund' ? -Number(r.amount) : r.amount), r.method, r.reference, r.receivedOn,
        r.recordedBy, day(r.voidedAt), r.voidReason,
      ]),
    };
  }

  private async auditTrail(actor: AuthUser, range: ExportRange) {
    const rows = await this.db
      .select({
        action: auditLog.action,
        actorName: users.fullName,
        actorRole: auditLog.actorRole,
        clientName: clients.fullName,
        metadata: auditLog.metadata,
        ipAddress: auditLog.ipAddress,
        userAgent: auditLog.userAgent,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorId))
      .leftJoin(clients, eq(clients.id, auditLog.clientId))
      .where(and(eq(auditLog.tenantId, tenantOf(actor)), ...this.between(auditLog.createdAt, range)))
      .orderBy(desc(auditLog.createdAt))
      .limit(MAX_ROWS);

    return {
      header: ['When (UTC)', 'Who', 'Role', 'Event', 'What happened', 'Client', 'IP address', 'Browser'],
      rows: rows.map((r): Cell[] => [
        stamp(r.createdAt),
        r.actorName ?? (r.actorRole ? '' : 'System'),
        r.actorRole,
        AUDIT_ACTION_LABEL[r.action as AuditAction] ?? r.action,
        describeAudit({
          action: r.action,
          clientName: r.clientName,
          metadata: (r.metadata as Record<string, unknown> | null) ?? null,
        }),
        r.clientName,
        r.ipAddress,
        r.userAgent,
      ]),
    };
  }
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

/**
 * A cell a spreadsheet would evaluate - starting with = + - @, a tab or a
 * carriage return - gets a leading apostrophe, which Excel, Numbers and
 * Sheets all display as plain text. Plain negative numbers are left alone so
 * refunds still add up.
 */
export function safeCell(value: Cell): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  const s = String(value);
  if (typeof value === 'number' || /^-?\d+(\.\d+)?$/.test(s)) return s;
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function quote(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180, CRLF line endings, with a byte-order mark so Excel reads it as UTF-8. */
export function toCsv(header: string[], rows: Cell[][]): string {
  const lines = [header, ...rows].map((r) => r.map((c) => quote(safeCell(c))).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import PDFDocument from 'pdfkit';
import {
  FEE_CATEGORY_LABEL,
  INSTALLMENT_STATUS_LABEL,
  PARTNER_AGREEMENT_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  PAYOUT_STATUS_LABEL,
  formatMoney,
  type ClaimView,
  type InvoiceView,
  type PartnerAgreementView,
  type PaymentView,
  type PayoutView,
  type QuoteView,
  type StatementView,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { financeSettings, tenants } from '../db/schema';
import { STORAGE, type StorageDriver } from '../storage/storage.driver';
import { tenantIdentity } from '../tenancy/tenant-links';

interface Brand {
  name: string;
  origin: string;
  email: string | null;
  phone: string | null;
  logo: Buffer | null;
  color: string;
  bankDetails: string | null;
  terms: string | null;
}

type Doc = PDFKit.PDFDocument;

const INK = '#14213d';
const MUTED = '#6b7385';
const LINE = '#dfe3ea';

/**
 * Invoices, receipts, quotes and statements as PDFs - attached to the emails
 * that go out and downloadable from every invoice. Printed with the
 * consultancy's own name, logo, colour, contacts, bank details and terms.
 *
 * The built-in PDF fonts cover Western European text; anything outside it
 * (a name written in Urdu, say) is printed as "?" rather than as garbage.
 */
@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: StorageDriver,
  ) {}

  async brand(tenantId: string): Promise<Brand> {
    const [[t], [s], site] = await Promise.all([
      this.db
        .select({ name: tenants.name, logoKey: tenants.logoKey, color: tenants.primaryColor, email: tenants.contactEmail, phone: tenants.contactPhone })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1),
      this.db
        .select({ bankDetails: financeSettings.bankDetails, terms: financeSettings.invoiceTerms })
        .from(financeSettings)
        .where(eq(financeSettings.tenantId, tenantId))
        .limit(1),
      tenantIdentity(this.db, tenantId),
    ]);
    let logo: Buffer | null = null;
    if (t?.logoKey) {
      try {
        const buf = await this.storage.read(t.logoKey);
        // PDF can embed PNG and JPEG; anything else (SVG, WebP) is left out.
        if (buf.subarray(0, 4).toString('hex') === '89504e47' || buf.subarray(0, 2).toString('hex') === 'ffd8') logo = buf;
      } catch (err) {
        this.logger.warn(`logo not readable: ${(err as Error).message}`);
      }
    }
    return {
      name: t?.name ?? site.name,
      origin: site.origin,
      email: t?.email ?? null,
      phone: t?.phone ?? null,
      logo,
      color: t?.color && /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : '#3d5af1',
      bankDetails: s?.bankDetails ?? null,
      terms: s?.terms ?? null,
    };
  }

  async invoice(tenantId: string, inv: InvoiceView): Promise<Buffer> {
    const brand = await this.brand(tenantId);
    return render((doc) => {
      header(doc, brand, inv.status === 'pending_approval' ? 'DRAFT INVOICE' : 'INVOICE', inv.number, [
        ['Issued', inv.issueDate],
        ['Due', inv.dueDate],
        ...(inv.caseReference ? ([['Application', inv.caseReference]] as [string, string][]) : []),
      ]);
      billTo(doc, inv.clientName, [inv.clientEmail, inv.clientPhone]);
      if (inv.status === 'void') stamp(doc, 'VOID', '#c0392b');
      else if (inv.paymentStatus === 'paid') stamp(doc, 'PAID', '#1e8e5a');
      lineTable(
        doc,
        brand,
        inv.items.map((i) => ({
          description: i.description,
          detail: [FEE_CATEGORY_LABEL[i.category], i.taxRateName ? `${i.taxRateName}${i.taxInclusive ? ' (included)' : ''}` : null].filter(Boolean).join(' · '),
          quantity: i.quantity,
          unit: formatMoney(i.unitAmount, inv.currency),
          discount: i.discount ? `−${formatMoney(i.discount, inv.currency)}` : '',
          tax: i.tax ? formatMoney(i.tax, inv.currency) : '',
          total: formatMoney(i.total, inv.currency),
        })),
      );
      totals(doc, [
        ['Subtotal', formatMoney(inv.subtotal, inv.currency)],
        ...(inv.discount ? ([[`Discount${inv.promoCode ? ` (${inv.promoCode})` : ''}`, `−${formatMoney(inv.discount, inv.currency)}`]] as [string, string][]) : []),
        ...(inv.tax ? ([['Tax', formatMoney(inv.tax, inv.currency)]] as [string, string][]) : []),
        ['Total', formatMoney(inv.total, inv.currency), true],
        ...(inv.credited ? ([['Credit notes', `−${formatMoney(inv.credited, inv.currency)}`]] as [string, string][]) : []),
        ['Paid', `−${formatMoney(inv.paid, inv.currency)}`],
        ['Balance due', formatMoney(Math.max(0, inv.balance), inv.currency), true],
      ]);
      if (inv.installments.length) {
        section(doc, 'Payment schedule');
        for (const i of inv.installments) {
          row(doc, [
            [`${i.seq}. ${i.label ?? 'Installment'}`, 200],
            [i.dueDate, 100],
            [formatMoney(i.amount, inv.currency), 110, 'right'],
            [INSTALLMENT_STATUS_LABEL[i.status], 90, 'right'],
          ]);
        }
      }
      if (inv.notes) {
        section(doc, 'Notes');
        para(doc, inv.notes);
      }
      footer(doc, brand, true);
    });
  }

  async receipt(tenantId: string, inv: InvoiceView, p: PaymentView): Promise<Buffer> {
    const brand = await this.brand(tenantId);
    const refund = p.kind === 'refund';
    return render((doc) => {
      header(doc, brand, refund ? 'REFUND RECEIPT' : 'RECEIPT', p.number, [
        ['Date', p.receivedOn],
        ['Invoice', inv.number],
      ]);
      billTo(doc, inv.clientName, [inv.clientEmail, inv.clientPhone], refund ? 'Paid to' : 'Received from');
      if (p.voided) stamp(doc, 'VOID', '#c0392b');
      doc.moveDown(1);
      doc.font('Helvetica-Bold').fontSize(22).fillColor(INK).text(clean(`${refund ? '−' : ''}${formatMoney(p.amount, p.currency)}`), { align: 'left' });
      doc.moveDown(0.4);
      doc.font('Helvetica').fontSize(10).fillColor(MUTED);
      doc.text(clean(`${PAYMENT_METHOD_LABEL[p.method]}${p.reference ? ` · reference ${p.reference}` : ''}`));
      if (p.note) doc.text(clean(p.note));
      doc.moveDown(1);
      totals(doc, [
        ['Invoice total', formatMoney(inv.total, inv.currency)],
        ...(inv.credited ? ([['Credit notes', `−${formatMoney(inv.credited, inv.currency)}`]] as [string, string][]) : []),
        ['Paid to date', formatMoney(inv.paid, inv.currency)],
        ['Still to pay', formatMoney(Math.max(0, inv.balance), inv.currency), true],
      ]);
      if (p.recordedByName) {
        doc.moveDown(1).font('Helvetica').fontSize(9).fillColor(MUTED).text(clean(`Recorded by ${p.recordedByName}`));
      }
      footer(doc, brand, false);
    });
  }

  async quote(tenantId: string, q: QuoteView): Promise<Buffer> {
    const brand = await this.brand(tenantId);
    return render((doc) => {
      header(doc, brand, q.proforma ? 'PROFORMA INVOICE' : 'QUOTE', q.number, [
        ['Date', q.issueDate],
        ['Valid until', q.validUntil],
        ...(q.caseReference ? ([['Application', q.caseReference]] as [string, string][]) : []),
      ]);
      billTo(doc, q.clientName, [q.clientEmail]);
      lineTable(
        doc,
        brand,
        q.items.map((i) => ({
          description: i.description,
          detail: [FEE_CATEGORY_LABEL[i.category], i.taxRateName].filter(Boolean).join(' · '),
          quantity: i.quantity,
          unit: formatMoney(i.unitAmount, q.currency),
          discount: i.discount ? `−${formatMoney(i.discount, q.currency)}` : '',
          tax: i.tax ? formatMoney(i.tax, q.currency) : '',
          total: formatMoney(i.total, q.currency),
        })),
      );
      totals(doc, [
        ['Subtotal', formatMoney(q.subtotal, q.currency)],
        ...(q.discount ? ([[`Discount${q.promoCode ? ` (${q.promoCode})` : ''}`, `−${formatMoney(q.discount, q.currency)}`]] as [string, string][]) : []),
        ...(q.tax ? ([['Tax', formatMoney(q.tax, q.currency)]] as [string, string][]) : []),
        ['Total', formatMoney(q.total, q.currency), true],
      ]);
      if (q.notes) {
        section(doc, 'Notes');
        para(doc, q.notes);
      }
      if (q.proforma) {
        doc.moveDown(0.8).font('Helvetica').fontSize(9).fillColor(MUTED).text('This is a proforma invoice: a statement of fees, not a demand for payment.');
      }
      footer(doc, brand, q.proforma);
    });
  }

  /** A commission claim: an invoice to the institution, student by student. */
  async claim(tenantId: string, c: ClaimView): Promise<Buffer> {
    const brand = await this.brand(tenantId);
    return render((doc) => {
      header(doc, brand, 'COMMISSION CLAIM', c.number, [
        ['Period', c.periodLabel],
        ...(c.submittedOn ? ([['Sent', c.submittedOn]] as [string, string][]) : []),
        ...(c.dueOn ? ([['Due', c.dueOn]] as [string, string][]) : []),
      ]);
      billTo(doc, c.institutionName, [], 'Claim to');
      doc.moveDown(0.4);
      row(doc, [['Student', 150], ['Intake / year', 90], ['Tuition', 90, 'right'], ['Rate', 50, 'right'], ['Commission', 119, 'right']], true);
      for (const m of c.commissions.filter((x) => x.status !== 'cancelled')) {
        row(doc, [
          [m.kind === 'bonus' ? 'Volume bonus' : (m.clientName ?? m.number), 150],
          [[m.intake, m.kind === 'student' ? `year ${m.yearNo}` : null].filter(Boolean).join(', ') || '-', 90],
          [m.tuition ? formatMoney(m.tuition, m.currency) : '-', 90, 'right'],
          [m.rateBp ? `${m.rateBp / 100}%` : 'fixed', 50, 'right'],
          [formatMoney(m.amount, m.currency), 119, 'right'],
        ]);
      }
      doc.moveDown(0.6);
      totals(doc, [
        ['Total claimed', formatMoney(c.total, c.currency), true],
        ...(c.received ? ([['Received', `-${formatMoney(c.received, c.currency)}`], ['Outstanding', formatMoney(c.outstanding, c.currency), true]] as ([string, string] | [string, string, boolean])[]) : []),
      ]);
      if (c.notes) {
        section(doc, 'Notes');
        para(doc, c.notes);
      }
      footer(doc, brand, true);
    });
  }

  async statement(tenantId: string, s: StatementView): Promise<Buffer> {
    const brand = await this.brand(tenantId);
    return render((doc) => {
      header(doc, brand, 'STATEMENT', s.currency, [
        ['From', s.from ?? 'the start'],
        ['To', s.to],
      ]);
      billTo(doc, s.clientName, []);
      doc.moveDown(0.6);
      row(doc, [['Date', 70], ['Reference', 100], ['Details', 160], ['Charges', 60, 'right'], ['Paid', 60, 'right'], ['Balance', 60, 'right']], true);
      row(doc, [['', 70], ['', 100], ['Balance brought forward', 160], ['', 60], ['', 60], [formatMoney(s.opening, s.currency), 60, 'right']]);
      for (const l of s.lines) {
        row(doc, [
          [l.date, 70],
          [l.reference, 100],
          [l.description, 160],
          [l.debit ? formatMoney(l.debit, s.currency) : '', 60, 'right'],
          [l.credit ? formatMoney(l.credit, s.currency) : '', 60, 'right'],
          [formatMoney(l.balance, s.currency), 60, 'right'],
        ]);
      }
      doc.moveDown(0.6);
      totals(doc, [['Balance', formatMoney(s.closing, s.currency), true]]);
      footer(doc, brand, true);
    });
  }

  /** What a payout to a partner was made of: each earning, tax withheld, the advance taken back, and what was paid. */
  async payoutStatement(tenantId: string, p: PayoutView, partner: { name: string; number: string; taxId: string | null; bankLine: string | null }): Promise<Buffer> {
    const brand = await this.brand(tenantId);
    return render((doc) => {
      header(doc, brand, 'PAYOUT STATEMENT', p.number, [
        ['Period', p.periodLabel],
        ['Status', PAYOUT_STATUS_LABEL[p.status]],
        ...(p.paidOn ? ([['Paid', p.paidOn]] as [string, string][]) : []),
      ]);
      billTo(doc, partner.name, [partner.number, partner.taxId ? `Tax ID ${partner.taxId}` : null, partner.bankLine], 'Paid to');
      doc.moveDown(0.4);
      row(doc, [['Date', 62], ['Reference', 78], ['Student', 120], ['What for', 160], ['Amount', 79, 'right']], true);
      for (const e of p.earnings) {
        row(doc, [
          [e.earnedOn, 62],
          [e.number, 78],
          [e.clientName ?? '-', 120],
          [e.description, 160],
          [formatMoney(e.amount, e.currency), 79, 'right'],
        ]);
      }
      doc.moveDown(0.6);
      totals(doc, [
        ['Earned', formatMoney(p.gross, p.currency)],
        ...(p.withholding ? ([[`Tax withheld (${p.withholdingBp / 100}%)`, `-${formatMoney(p.withholding, p.currency)}`]] as [string, string][]) : []),
        ...(p.advanceRecovered ? ([['Advance taken back', `-${formatMoney(p.advanceRecovered, p.currency)}`]] as [string, string][]) : []),
        [p.status === 'paid' ? 'Paid' : 'To pay', formatMoney(p.net, p.currency), true],
      ]);
      if (p.status === 'paid') {
        section(doc, 'Payment');
        para(doc, [p.paidOn, p.method ? PAYMENT_METHOD_LABEL[p.method] : null, p.reference ? `reference ${p.reference}` : null].filter(Boolean).join(', '));
      }
      if (p.withholding) {
        section(doc, 'Tax withheld');
        para(doc, `${formatMoney(p.withholding, p.currency)} was withheld from this payout and is paid to the tax authority on the partner's behalf. Keep this statement as the record of it.`);
      }
      if (p.status === 'void') stamp(doc, 'VOID', '#c0392b');
    });
  }

  /** A certificate of completion for a course, on the consultancy's letterhead. */
  async courseCertificate(
    tenantId: string,
    c: { number: string; studentName: string; courseName: string; batchCode: string; from: string; to: string; attendancePercent: number | null; completedOn: string },
  ): Promise<Buffer> {
    const brand = await this.brand(tenantId);
    return render((doc) => {
      doc.rect(30, 30, 535, 782).lineWidth(2).strokeColor(brand.color).stroke();
      doc.rect(38, 38, 519, 766).lineWidth(0.5).strokeColor(LINE).stroke();
      let y = 90;
      if (brand.logo) {
        try {
          doc.image(brand.logo, 257, y, { fit: [80, 80] });
          y += 96;
        } catch {
          /* an unreadable logo is left out */
        }
      }
      doc.font('Helvetica-Bold').fontSize(14).fillColor(INK).text(clean(brand.name), 48, y, { width: 499, align: 'center' });
      doc.moveDown(2.2);
      doc.font('Helvetica-Bold').fontSize(30).fillColor(brand.color).text('Certificate of Completion', 48, doc.y, { width: 499, align: 'center' });
      doc.moveDown(1.6);
      doc.font('Helvetica').fontSize(12).fillColor(MUTED).text('This is to certify that', 48, doc.y, { width: 499, align: 'center' });
      doc.moveDown(0.8);
      doc.font('Helvetica-Bold').fontSize(24).fillColor(INK).text(clean(c.studentName), 48, doc.y, { width: 499, align: 'center' });
      doc.moveDown(0.8);
      doc.font('Helvetica').fontSize(12).fillColor(MUTED).text('has completed', 48, doc.y, { width: 499, align: 'center' });
      doc.moveDown(0.8);
      doc.font('Helvetica-Bold').fontSize(18).fillColor(INK).text(clean(c.courseName), 48, doc.y, { width: 499, align: 'center' });
      doc.moveDown(0.6);
      doc
        .font('Helvetica')
        .fontSize(11)
        .fillColor(MUTED)
        .text(clean(`Batch ${c.batchCode}, ${c.from} to ${c.to}${c.attendancePercent !== null ? `, with ${c.attendancePercent}% attendance` : ''}.`), 48, doc.y, { width: 499, align: 'center' });
      doc.font('Helvetica').fontSize(9.5).fillColor(MUTED);
      doc.text(clean(`Certificate ${c.number} · issued ${c.completedOn}`), 48, 730, { width: 499, align: 'center' });
      doc.text(clean(brand.origin.replace(/^https?:\/\//, '')), 48, doc.y, { width: 499, align: 'center' });
    });
  }

  /**
   * The partner agreement as signed: the terms, the signature, and a
   * certificate of who signed, when, from where, and the fingerprint of the
   * terms they saw.
   */
  async partnerAgreement(tenantId: string, a: PartnerAgreementView, partner: { name: string; number: string; address: string }): Promise<Buffer> {
    const brand = await this.brand(tenantId);
    return render((doc) => {
      header(doc, brand, 'PARTNER AGREEMENT', `${partner.number} v${a.version}`, [
        ['From', a.validFrom],
        ...(a.validTo ? ([['Until', a.validTo]] as [string, string][]) : []),
        ['Status', PARTNER_AGREEMENT_STATUS_LABEL[a.status]],
      ]);
      billTo(doc, partner.name, [partner.address], 'Partner');
      doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text(clean(a.title), 48, doc.y, { width: 499 });
      doc.moveDown(0.6);
      for (const p of a.body.split(/\n\s*\n/)) {
        if (doc.y > 740) doc.addPage();
        para(doc, p.trim());
        doc.moveDown(0.5);
      }
      if (a.status === 'void') stamp(doc, 'WITHDRAWN', '#c0392b');
      if (a.status !== 'signed') return;

      section(doc, 'Signed for the partner');
      if (a.signatureKind === 'drawn' && a.signature?.startsWith('data:image/png;base64,')) {
        try {
          const img = Buffer.from(a.signature.slice('data:image/png;base64,'.length), 'base64');
          if (doc.y > 680) doc.addPage();
          doc.image(img, 48, doc.y, { fit: [220, 70] });
          doc.y += 74;
        } catch {
          para(doc, '(signature image could not be shown)');
        }
      } else if (a.signature) {
        doc.font('Helvetica-Oblique').fontSize(20).fillColor(INK).text(clean(a.signature), 48, doc.y, { width: 499 });
      }
      para(doc, `${a.signerName ?? ''}, ${a.signerTitle ?? ''}`);

      doc.addPage();
      doc.font('Helvetica-Bold').fontSize(14).fillColor(brand.color).text('Signature certificate', 48, 48);
      doc.moveDown(0.6);
      const facts: [string, string][] = [
        ['Agreement', `${a.title} (version ${a.version})`],
        ['Partner', `${partner.name} (${partner.number})`],
        ['Sent for signature', `${a.sentAt ?? '-'}${a.sentByName ? ` by ${a.sentByName}` : ''}`],
        ['Signed', a.signedAt ?? '-'],
        ['Signed by', `${a.signerName ?? '-'}, ${a.signerTitle ?? '-'}`],
        ['How', a.signatureKind === 'drawn' ? 'Drawn on screen' : 'Typed name'],
        ['From IP address', a.signerIp ?? 'not recorded'],
        ['Browser', a.signerUserAgent ?? 'not recorded'],
        ['Fingerprint of the terms (SHA-256)', a.documentHash ?? '-'],
      ];
      for (const [k, v] of facts) {
        doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(k.toUpperCase(), 48, doc.y, { characterSpacing: 0.5 });
        doc.font('Helvetica').fontSize(10).fillColor(INK).text(clean(v), 48, doc.y, { width: 499 });
        doc.moveDown(0.5);
      }
      doc.moveDown(0.4);
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(MUTED)
        .text(
          'The signer signed in to their own account in the partner portal, read the terms above and confirmed they agreed to them before signing. The fingerprint is calculated from the terms exactly as they were sent; any change to them would change it. Signing and sending are recorded in the consultancy\'s audit trail.',
          48,
          doc.y,
          { width: 499 },
        );
    });
  }
}

/* ------------------------------------------------------------------ */
/* Drawing                                                              */
/* ------------------------------------------------------------------ */

function render(draw: (doc: Doc) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Producer: 'Consultancy CRM' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      draw(doc);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/** Keeps what the built-in fonts can print (Windows-1252), swaps the rest for "?". */
function clean(text: string): string {
  const cp1252 = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
  return text
    .replace(/−/g, '-')
    .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, (c) => (cp1252.includes(c) ? c : '?'));
}

function header(doc: Doc, brand: Brand, title: string, number: string, meta: [string, string][]) {
  const top = doc.y;
  let left = 48;
  if (brand.logo) {
    try {
      doc.image(brand.logo, 48, top, { fit: [64, 64] });
      left = 124;
    } catch {
      /* an unreadable logo is left out */
    }
  }
  doc.font('Helvetica-Bold').fontSize(16).fillColor(INK).text(clean(brand.name), left, top, { width: 260 });
  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  for (const line of [brand.email, brand.phone, brand.origin.replace(/^https?:\/\//, '')].filter(Boolean) as string[]) {
    doc.text(clean(line), left, doc.y, { width: 260 });
  }
  doc.font('Helvetica-Bold').fontSize(20).fillColor(brand.color).text(title, 300, top, { width: 247, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(clean(number), 300, doc.y, { width: 247, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  for (const [k, v] of meta) doc.text(clean(`${k}: ${v}`), 300, doc.y, { width: 247, align: 'right' });
  doc.y = Math.max(doc.y, top + 72) + 16;
  doc.x = 48;
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor(LINE).lineWidth(1).stroke();
  doc.moveDown(0.8);
}

function billTo(doc: Doc, name: string, lines: (string | null | undefined)[], label = 'Bill to') {
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(label.toUpperCase(), 48, doc.y, { characterSpacing: 0.6 });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(clean(name), 48);
  doc.font('Helvetica').fontSize(9.5).fillColor(MUTED);
  for (const l of lines.filter(Boolean) as string[]) doc.text(clean(l), 48);
  doc.moveDown(0.6);
}

function stamp(doc: Doc, text: string, color: string) {
  const y = doc.y;
  doc.save();
  doc.rotate(-12, { origin: [470, 150] });
  doc.font('Helvetica-Bold').fontSize(30).fillColor(color).opacity(0.35).text(text, 400, 130, { width: 150, align: 'center' });
  doc.restore();
  doc.opacity(1);
  doc.y = y;
  doc.x = 48;
}

interface TableLine {
  description: string;
  detail: string;
  quantity: number;
  unit: string;
  discount: string;
  tax: string;
  total: string;
}

function lineTable(doc: Doc, brand: Brand, lines: TableLine[]) {
  const anyDiscount = lines.some((l) => l.discount);
  const anyTax = lines.some((l) => l.tax);
  const cols: [string, number, 'left' | 'right'][] = [
    ['Description', anyDiscount && anyTax ? 190 : anyDiscount || anyTax ? 250 : 310, 'left'],
    ['Qty', 30, 'right'],
    ['Unit price', 80, 'right'],
    ...(anyDiscount ? ([['Discount', 70, 'right']] as [string, number, 'left' | 'right'][]) : []),
    ...(anyTax ? ([['Tax', 60, 'right']] as [string, number, 'left' | 'right'][]) : []),
    ['Amount', 79, 'right'],
  ];
  const y0 = doc.y;
  doc.rect(48, y0 - 4, 499, 20).fill(`${brand.color}14`);
  doc.fillColor(INK);
  row(doc, cols.map(([label, w, a]) => [label, w, a] as [string, number, 'left' | 'right']), true);
  for (const l of lines) {
    const values = [l.description, String(l.quantity), l.unit, ...(anyDiscount ? [l.discount] : []), ...(anyTax ? [l.tax] : []), l.total];
    row(doc, cols.map(([, w, a], i) => [values[i] ?? '', w, a] as [string, number, 'left' | 'right']), false, l.detail);
  }
  doc.moveDown(0.4);
}

function row(doc: Doc, cells: ([string, number] | [string, number, 'left' | 'right'])[], head = false, detail?: string) {
  if (doc.y > 760) doc.addPage();
  const y = doc.y;
  let x = 48;
  let bottom = y;
  doc.font(head ? 'Helvetica-Bold' : 'Helvetica').fontSize(head ? 8.5 : 9.5).fillColor(head ? MUTED : INK);
  cells.forEach(([text, w, align], i) => {
    doc.text(clean(text), x, y, { width: w - 6, align: align ?? 'left' });
    if (i === 0 && detail) {
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(clean(detail), x, doc.y, { width: w - 6 });
      doc.font(head ? 'Helvetica-Bold' : 'Helvetica').fontSize(head ? 8.5 : 9.5).fillColor(head ? MUTED : INK);
    }
    bottom = Math.max(bottom, doc.y);
    x += w;
  });
  doc.y = bottom + 5;
  doc.x = 48;
  if (!head) doc.moveTo(48, doc.y - 2).lineTo(547, doc.y - 2).strokeColor(LINE).lineWidth(0.5).stroke();
}

function totals(doc: Doc, rows: ([string, string] | [string, string, boolean])[]) {
  for (const [label, value, strong] of rows) {
    if (doc.y > 770) doc.addPage();
    const y = doc.y;
    doc.font(strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(strong ? 11 : 9.5).fillColor(strong ? INK : MUTED);
    doc.text(clean(label), 320, y, { width: 130, align: 'right' });
    doc.fillColor(INK).text(clean(value), 450, y, { width: 97, align: 'right' });
    doc.y = Math.max(doc.y, y + 14) + 2;
  }
  doc.x = 48;
}

function section(doc: Doc, title: string) {
  doc.moveDown(0.8);
  if (doc.y > 740) doc.addPage();
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(title, 48);
  doc.moveDown(0.3);
}

function para(doc: Doc, text: string) {
  doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(clean(text), 48, doc.y, { width: 499 });
}

function footer(doc: Doc, brand: Brand, withBank: boolean) {
  if (withBank && brand.bankDetails) {
    section(doc, 'How to pay');
    para(doc, brand.bankDetails);
  }
  if (brand.terms) {
    section(doc, 'Terms');
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(clean(brand.terms), 48, doc.y, { width: 499 });
  }
}


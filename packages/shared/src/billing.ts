/**
 * Money.
 *
 * Every amount the ledger stores is an integer in the currency's minor unit
 * (paisa, pence, cents), so sums are exact - no 0.1 + 0.2 in a receipt.
 * Formatting happens only at the edge, here, for everyone.
 */
export const CURRENCIES = ['PKR', 'USD', 'GBP', 'EUR', 'CAD', 'AUD'] as const;
export type Currency = (typeof CURRENCIES)[number];

export function formatMoney(minor: number, currency: string): string {
  const major = minor / 100;
  const whole = Number.isInteger(major);
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
      currencyDisplay: currency === 'PKR' ? 'code' : 'symbol',
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    return `${currency} ${major.toFixed(whole ? 0 : 2)}`;
  }
}

/** "12,500.50" -> 1250050. Null for anything that is not a non-negative amount. */
export function parseMoney(input: string): number | null {
  const cleaned = input.replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

export const PAYMENT_METHODS = ['cash', 'bank_transfer', 'card', 'online', 'cheque', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  card: 'Card',
  online: 'Online (JazzCash / Easypaisa)',
  cheque: 'Cheque',
  other: 'Other',
};

/** A refund is its own ledger entry, never a negative payment or an edit. */
export const PAYMENT_KINDS = ['payment', 'refund'] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

/**
 * `pending_approval`: issued with a discount above the consultancy's limit,
 * waiting for someone with approval rights. The student does not see it and
 * nothing can be paid against it until then.
 */
export const INVOICE_STATUSES = ['issued', 'void', 'pending_approval'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Derived from the ledger, never stored - so it can never disagree with it. */
export type PaymentStatus = 'unpaid' | 'partial' | 'paid' | 'overpaid' | 'void' | 'awaiting_approval';
export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  awaiting_approval: 'Awaiting approval',
  unpaid: 'Unpaid',
  partial: 'Part paid',
  paid: 'Paid',
  overpaid: 'Overpaid',
  void: 'Void',
};
export const PAYMENT_STATUS_TONE: Record<PaymentStatus, 'ok' | 'warn' | 'bad' | 'neutral' | 'info'> = {
  awaiting_approval: 'neutral',
  unpaid: 'warn',
  partial: 'info',
  paid: 'ok',
  overpaid: 'bad',
  void: 'neutral',
};

/**
 * `total` is what is owed after credit notes: an invoice of 100 with a credit
 * note of 30 is paid once 70 has come in.
 */
export function paymentStatus(
  total: number,
  paid: number,
  invoiceStatus: InvoiceStatus,
): PaymentStatus {
  if (invoiceStatus === 'void') return 'void';
  if (invoiceStatus === 'pending_approval') return 'awaiting_approval';
  if (paid > total) return 'overpaid';
  if (paid === total && total > 0) return 'paid';
  if (paid > 0) return 'partial';
  return total === 0 ? 'paid' : 'unpaid';
}

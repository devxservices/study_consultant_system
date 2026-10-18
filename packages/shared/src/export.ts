import type { Permission } from './permissions';

/**
 * What a consultancy can take away with it as a spreadsheet. The owner's data
 * is the owner's: a manager can always export all of it, and a consultant only
 * when a manager has given them "export data" - and then only what they could
 * already see on screen.
 */
export const EXPORT_DATASETS = ['clients', 'applications', 'invoices', 'payments', 'audit'] as const;
export type ExportDataset = (typeof EXPORT_DATASETS)[number];

export interface ExportDatasetMeta {
  key: ExportDataset;
  label: string;
  description: string;
  /** Needed on top of data.export. */
  alsoRequires: Permission[];
  /** Needs the billing module on the consultancy's plan. */
  billing?: boolean;
  /** Whether the date range applies, and to which date. */
  dateField: string;
}

export const EXPORT_META: Record<ExportDataset, ExportDatasetMeta> = {
  clients: {
    key: 'clients',
    label: 'Clients',
    description: 'Contact details, student profile and assigned consultant.',
    alsoRequires: [],
    dateField: 'date added',
  },
  applications: {
    key: 'applications',
    label: 'Applications',
    description: 'Every application with its stage, status and key dates.',
    alsoRequires: [],
    dateField: 'date opened',
  },
  invoices: {
    key: 'invoices',
    label: 'Invoices',
    description: 'Invoice totals, what has been paid and what is still owed.',
    alsoRequires: ['billing.view'],
    billing: true,
    dateField: 'issue date',
  },
  payments: {
    key: 'payments',
    label: 'Payments',
    description: 'Money received and refunded, with receipt numbers.',
    alsoRequires: ['billing.view'],
    billing: true,
    dateField: 'date received',
  },
  audit: {
    key: 'audit',
    label: 'Audit trail',
    description: 'Everything everyone did, with the address it came from.',
    alsoRequires: ['audit.view'],
    dateField: 'date',
  },
};

export function isExportDataset(value: unknown): value is ExportDataset {
  return typeof value === 'string' && (EXPORT_DATASETS as readonly string[]).includes(value);
}

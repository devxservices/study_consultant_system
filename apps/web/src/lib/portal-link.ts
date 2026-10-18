import type { Role } from '@crm/shared';

/*
 * A notification's link is written once, for one portal, but whoever reads it
 * may work in the other: a consultant who checks payments gets a link into
 * the manager's finance pages, a manager who shares in a commission gets one
 * to the consultant's workload. These are the pages that exist in both,
 * mapped across; anything else is left as written.
 */
const END = String.raw`(?=\/|$|\?)`;
const rule = (from: string, to: string): [RegExp, string] => [new RegExp(`^${from}${END}`), to];

const FINANCE_PAGES = 'approvals|bank|bills|books|expenses|reports|settings|verify';
const SHARED = 'courses|partners|commissions|universities|cases|clients|documents|workflows|countries|pipeline|tasks|audit|export';

const TO_DESK: [RegExp, string][] = [
  rule(String.raw`\/overview\/finance\/invoices`, '/desk/invoices'),
  rule(String.raw`\/overview\/finance\/receipts`, '/desk/invoices/receipts'),
  rule(String.raw`\/overview\/finance\/quotes`, '/desk/invoices/quotes'),
  rule(String.raw`\/overview\/finance\/statement`, '/desk/invoices/statement'),
  rule(String.raw`\/overview\/finance\/new`, '/desk/invoices/new'),
  rule(String.raw`\/overview\/finance\/(${FINANCE_PAGES})`, '/desk/finance/$1'),
  [/^\/overview\/finance(?=$|\?)/, '/desk/finance'],
  rule(String.raw`\/overview\/(${SHARED})`, '/desk/$1'),
];

const TO_OVERVIEW: [RegExp, string][] = [
  rule(String.raw`\/desk\/invoices\/receipts`, '/overview/finance/receipts'),
  rule(String.raw`\/desk\/invoices\/quotes`, '/overview/finance/quotes'),
  rule(String.raw`\/desk\/invoices\/statement`, '/overview/finance/statement'),
  rule(String.raw`\/desk\/invoices\/new`, '/overview/finance/new'),
  rule(String.raw`\/desk\/invoices`, '/overview/finance/invoices'),
  // A manager's own incentives are on the commissions overview.
  [/^\/desk\/workload(?=$|\?)/, '/overview/commissions'],
  rule(String.raw`\/desk\/(finance|${SHARED})`, '/overview/$1'),
];

export function portalLink(link: string, role: Role): string {
  const rules = role === 'manager' ? TO_OVERVIEW : role === 'consultant' ? TO_DESK : [];
  for (const [pattern, to] of rules) {
    if (pattern.test(link)) return link.replace(pattern, to);
  }
  return link;
}

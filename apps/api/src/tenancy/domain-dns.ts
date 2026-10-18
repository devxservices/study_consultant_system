import { Resolver } from 'node:dns/promises';
import {
  DOMAIN_VERIFICATION_PREFIX,
  DOMAIN_VERIFICATION_VALUE_PREFIX,
  type DnsRecord,
} from '@crm/shared';
import { env } from '../config/env';

/**
 * Public DNS answers about a consultancy's own domain: does it prove
 * ownership, and does it lead to this platform.
 *
 * Asked of public resolvers first, because the server's own resolver may
 * remember "no such record" from before the consultancy added it; the
 * system resolver is the fallback where outbound DNS is blocked.
 */
const PUBLIC_RESOLVERS = ['1.1.1.1', '8.8.8.8'];

type Lookup<T> = (r: Resolver) => Promise<T>;

/** "There is no such record" is an answer; a timeout or refusal is not. */
function isAnswer(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code;
  return code === 'ENOTFOUND' || code === 'ENODATA' || code === 'ENONAME' || code === 'NXDOMAIN';
}

async function ask<T>(lookup: Lookup<T>, empty: T): Promise<T> {
  const servers: (string[] | null)[] = [PUBLIC_RESOLVERS, null];
  for (const s of servers) {
    const r = new Resolver({ timeout: 4_000, tries: 2 });
    if (s) r.setServers(s);
    try {
      return await lookup(r);
    } catch (err) {
      if (isAnswer(err)) return empty;
      // Unreachable or timed out: try the next resolver.
    }
  }
  return empty;
}

const norm = (h: string) => h.trim().toLowerCase().replace(/\.$/, '');

async function txtValues(name: string): Promise<string[]> {
  return ask((r) => r.resolveTxt(name).then((rows) => rows.map((chunks) => chunks.join(''))), [] as string[]);
}

async function cnameOf(host: string): Promise<string[]> {
  return ask((r) => r.resolveCname(host).then((xs) => xs.map(norm)), [] as string[]);
}

async function addressesOf(host: string): Promise<string[]> {
  const [v4, v6] = await Promise.all([
    ask((r) => r.resolve4(host), [] as string[]),
    ask((r) => r.resolve6(host), [] as string[]),
  ]);
  return [...v4, ...v6];
}

/** The lookups, in one object so the test suite can stand in for public DNS. */
export const lookups = { txtValues, cnameOf, addressesOf };

/** The server's public addresses, as the operator configured them (PUBLIC_IP). */
export function configuredAddresses(): string[] {
  return (env().PUBLIC_IP ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface DomainCheck {
  /** The TXT token is published, or the CNAME leads to the consultancy's own address. */
  owned: boolean;
  /** It resolves to this platform. */
  pointsHere: boolean;
  txtFound: string[];
  cname: string[];
  addresses: string[];
}

/**
 * One look at public DNS for a domain. `platformHost` is the consultancy's own
 * address on the platform (slug.platform.com): a CNAME to it both points the
 * domain here and says which consultancy it belongs to, so it proves
 * ownership on its own.
 */
export async function checkDomain(hostname: string, token: string, platformHost: string): Promise<DomainCheck> {
  const expectedTxt = `${DOMAIN_VERIFICATION_VALUE_PREFIX}${token}`;
  const [txtFound, cname, addresses, platformAddresses] = await Promise.all([
    lookups.txtValues(`${DOMAIN_VERIFICATION_PREFIX}.${hostname}`),
    lookups.cnameOf(hostname),
    lookups.addressesOf(hostname),
    lookups.addressesOf(platformHost),
  ]);
  const ours = new Set([...configuredAddresses(), ...platformAddresses]);
  const cnameToUs = cname.includes(norm(platformHost));
  const pointsHere = cnameToUs || addresses.some((a) => ours.has(a));
  return { owned: cnameToUs || txtFound.includes(expectedTxt), pointsHere, txtFound, cname, addresses };
}

/* ------------------------------------------------------------------ */
/* What to tell the consultancy to add                                */
/* ------------------------------------------------------------------ */

/**
 * Second-level labels under which registrations happen one level deeper:
 * example.com.pk, example.co.uk. Enough to name records the way DNS
 * providers ask for them; a wrong guess still shows the full name.
 */
const SECOND_LEVEL = new Set(['com', 'net', 'org', 'edu', 'gov', 'co', 'ac', 'gen', 'web', 'biz', 'info', 'ltd', 'plc', 'or', 'ne', 'go']);

/** The registrable domain (example.com, example.com.pk) a hostname sits under. */
export function zoneOf(hostname: string): string {
  const parts = hostname.split('.');
  if (parts.length <= 2) return hostname;
  const tld = parts[parts.length - 1]!;
  const sld = parts[parts.length - 2]!;
  const deeper = tld.length === 2 && SECOND_LEVEL.has(sld);
  return parts.slice(deeper ? -3 : -2).join('.');
}

/** "portal" for portal.example.com, "@" for example.com itself. */
function relativeName(fqdn: string, zone: string): string {
  if (fqdn === zone) return '@';
  return fqdn.endsWith(`.${zone}`) ? fqdn.slice(0, -(zone.length + 1)) : fqdn;
}

export function setupRecords(hostname: string, token: string, platformHost: string) {
  const zone = zoneOf(hostname);
  const apex = hostname === zone;
  const txtName = `${DOMAIN_VERIFICATION_PREFIX}.${hostname}`;
  const txt: DnsRecord = {
    type: 'TXT',
    name: relativeName(txtName, zone),
    fqdn: txtName,
    value: `${DOMAIN_VERIFICATION_VALUE_PREFIX}${token}`,
  };
  const ips = configuredAddresses();
  const v4 = ips.filter((ip) => !ip.includes(':'));
  const v6 = ips.filter((ip) => ip.includes(':'));
  const addressRecords: DnsRecord[] = [
    ...(v4.length ? v4 : ['']).map((ip): DnsRecord => ({ type: 'A', name: relativeName(hostname, zone), fqdn: hostname, value: ip })),
    ...v6.map((ip): DnsRecord => ({ type: 'AAAA', name: relativeName(hostname, zone), fqdn: hostname, value: ip })),
  ];
  const cname: DnsRecord = { type: 'CNAME', name: relativeName(hostname, zone), fqdn: hostname, value: platformHost };
  return apex
    ? { apex, records: [...addressRecords, txt], alternative: [] }
    : { apex, records: [cname], alternative: [...addressRecords, txt] };
}

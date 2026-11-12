/**
 * The per-account request ceiling: the bucket arithmetic, without booting the
 * API (the suites that do boot it run with the limiter off, so they measure
 * the app rather than the limiter).
 *
 * Run with:  npm test --workspace @crm/api
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ExecutionContext, HttpException } from '@nestjs/common';
import { TokenBuckets } from '../src/common/rate-limit';

describe('rate limit buckets', () => {
  test('a burst goes through at once, then requests wait for the refill', () => {
    const buckets = new TokenBuckets(60, 3); // one a second, three at once
    const t0 = 1_000_000;
    assert.equal(buckets.take('u:1', t0), 0);
    assert.equal(buckets.take('u:1', t0), 0);
    assert.equal(buckets.take('u:1', t0), 0);

    const wait = buckets.take('u:1', t0);
    assert.ok(wait > 0 && wait <= 1000, `waits up to a second, got ${wait}ms`);

    assert.equal(buckets.take('u:1', t0 + 1000), 0, 'one token back after a second');
    assert.ok(buckets.take('u:1', t0 + 1000) > 0);
  });

  test('a refused request does not push the wait further out', () => {
    const buckets = new TokenBuckets(60, 1);
    assert.equal(buckets.take('u:1', 0), 0);
    const first = buckets.take('u:1', 0);
    for (let i = 0; i < 50; i++) buckets.take('u:1', 0);
    assert.equal(buckets.take('u:1', 0), first, 'hammering while limited costs nothing extra');
    assert.equal(buckets.take('u:1', first), 0, 'and the stated wait is honoured');
  });

  test('every account has its own budget', () => {
    const buckets = new TokenBuckets(60, 1);
    assert.equal(buckets.take('u:1', 0), 0);
    assert.ok(buckets.take('u:1', 0) > 0);
    assert.equal(buckets.take('u:2', 0), 0, 'a busy colleague never limits anyone else');
  });

  test('idle accounts are forgotten, so memory follows active use', () => {
    const buckets = new TokenBuckets(60, 2);
    buckets.take('u:1', 0);
    buckets.take('u:2', 0);
    assert.equal(buckets.size, 2);
    buckets.take('u:3', 10 * 60_000);
    assert.equal(buckets.size, 1, 'the two refilled buckets were swept');
  });
});

describe('logo limits', () => {
  // Requests in these tests come "from" the socket address, as they would with
  // no edge proxy header configured.
  delete process.env.CLIENT_IP_HEADER;
  /* eslint-disable @typescript-eslint/no-require-imports -- after the env above */
  const { LogoWriteThrottleGuard, PublicImageThrottleGuard } =
    require('../src/tenancy/logo-throttle.guard') as typeof import('../src/tenancy/logo-throttle.guard');
  /* eslint-enable @typescript-eslint/no-require-imports */

  const context = (req: Record<string, unknown>) => {
    const headers: Record<string, string> = {};
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({ setHeader: (k: string, v: string) => (headers[k] = v) }),
      }),
    } as unknown as ExecutionContext;
    return { ctx, headers };
  };
  const status = (fn: () => unknown): number => {
    try {
      fn();
      return 200;
    } catch (err) {
      return (err as HttpException).getStatus();
    }
  };

  test('a person gets ten logo changes at once, then has to wait, with a Retry-After', () => {
    const guard = new LogoWriteThrottleGuard();
    const req = { user: { id: 'manager-1', tenantId: 'tenant-1' }, params: {} };
    for (let i = 0; i < 10; i++) assert.equal(status(() => guard.canActivate(context(req).ctx)), 200, `change ${i + 1}`);
    const { ctx, headers } = context(req);
    assert.equal(status(() => guard.canActivate(ctx)), 429);
    assert.ok(Number(headers['Retry-After']) > 0, 'says when to come back');
  });

  test('a consultancy gets twenty changes between everyone, so extra accounts do not multiply it', () => {
    const guard = new LogoWriteThrottleGuard();
    const as = (id: string) => context({ user: { id, tenantId: 'tenant-2' }, params: {} }).ctx;
    for (let i = 0; i < 10; i++) guard.canActivate(as('manager-a'));
    for (let i = 0; i < 10; i++) guard.canActivate(as('manager-b'));
    assert.equal(status(() => guard.canActivate(as('manager-c'))), 429, 'a third manager meets the consultancy budget');
    // The platform admin names the consultancy in the path - and shares its budget.
    const admin = context({ user: { id: 'root', tenantId: null }, params: { id: 'tenant-2' } }).ctx;
    assert.equal(status(() => guard.canActivate(admin)), 429);
    const elsewhere = context({ user: { id: 'manager-y', tenantId: 'tenant-3' }, params: {} }).ctx;
    assert.equal(status(() => guard.canActivate(elsewhere)), 200, 'another consultancy is untouched');
  });

  test('public logo files: 120 at once per address, then 429; the web server itself is never limited', () => {
    const guard = new PublicImageThrottleGuard();
    const from = (ip: string) => context({ headers: {}, socket: { remoteAddress: ip } }).ctx;
    for (let i = 0; i < 120; i++) assert.equal(status(() => guard.canActivate(from('203.0.113.7'))), 200);
    assert.equal(status(() => guard.canActivate(from('203.0.113.7'))), 429);
    assert.equal(status(() => guard.canActivate(from('198.51.100.4'))), 200, 'another visitor is unaffected');
    for (let i = 0; i < 500; i++) assert.equal(status(() => guard.canActivate(from('127.0.0.1'))), 200);
  });
});

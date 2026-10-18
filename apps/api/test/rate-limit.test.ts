/**
 * The per-account request ceiling: the bucket arithmetic, without booting the
 * API (the suites that do boot it run with the limiter off, so they measure
 * the app rather than the limiter).
 *
 * Run with:  npm test --workspace @crm/api
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
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

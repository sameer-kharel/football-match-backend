import { describe, expect, it, vi } from 'vitest';
import { UpstreamBudget } from '../src/lib/budget.js';
import { CacheMissError, SwrCache } from '../src/lib/cache.js';
import { NotFoundError, PlanRestrictedError, UpstreamRateLimitedError } from '../src/lib/errors.js';
import { checkIpLimit, clientIp } from '../src/lib/ip-limit.js';
import { silentLogger } from '../src/lib/logger.js';
import type { KeyValueStore } from '../src/lib/store.js';
import { MemoryStore } from '../src/lib/store.js';

function setup(start = 1_000_000) {
  let now = start;
  const clock = { now: () => now, advance: (s: number) => (now += s * 1000) };
  const store = new MemoryStore(clock.now);
  const cache = new SwrCache(store, { now: clock.now, logger: silentLogger, hardTtlSeconds: 3600, lockSeconds: 10, waitAttempts: 0, waitDelayMs: 0 });
  return { clock, store, cache };
}

describe('SwrCache', () => {
  it('serves fresh entries without calling the fetcher again', async () => {
    const { cache } = setup();
    const fetcher = vi.fn().mockResolvedValue({ n: 1 });
    await cache.get('k', fetcher, { ttl: 60 });
    const second = await cache.get('k', fetcher, { ttl: 60 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ data: { n: 1 }, stale: false });
  });

  it('refreshes after the soft TTL', async () => {
    const { cache, clock } = setup();
    const fetcher = vi.fn().mockResolvedValueOnce('old').mockResolvedValueOnce('new');
    await cache.get('k', fetcher, { ttl: 60 });
    clock.advance(61);
    const r = await cache.get('k', fetcher, { ttl: 60 });
    expect(r).toMatchObject({ data: 'new', stale: false });
  });

  it('falls back to the stale value with stale=true when the provider is rate limited', async () => {
    const { cache, clock } = setup();
    await cache.get('k', () => Promise.resolve('cached'), { ttl: 60 });
    clock.advance(600);
    const r = await cache.get('k', () => Promise.reject(new UpstreamRateLimitedError(30, 'x')), { ttl: 60 });
    expect(r.data).toBe('cached');
    expect(r.stale).toBe(true);
    expect(r.error).toBeInstanceOf(UpstreamRateLimitedError);
  });

  it('falls back to stale data on any upstream error and keeps it for the hard TTL', async () => {
    const { cache, clock } = setup();
    await cache.get('k', () => Promise.resolve('cached'), { ttl: 60 });
    clock.advance(3000);
    const r = await cache.get('k', () => Promise.reject(new Error('500')), { ttl: 60 });
    expect(r).toMatchObject({ data: 'cached', stale: true });
    clock.advance(1000); // beyond soft + hard TTL
    await expect(cache.get('k', () => Promise.reject(new Error('500')), { ttl: 60 })).rejects.toThrow('500');
  });

  it('throws when there is nothing cached to fall back on', async () => {
    const { cache } = setup();
    await expect(cache.get('k', () => Promise.reject(new UpstreamRateLimitedError(30, 'x')), { ttl: 60 })).rejects.toBeInstanceOf(
      UpstreamRateLimitedError,
    );
  });

  it('remembers 404s so bad ids do not spend the request budget', async () => {
    const { cache, clock } = setup();
    const fetcher = vi.fn().mockRejectedValue(new NotFoundError());
    await expect(cache.get('k', fetcher, { ttl: 60, notFoundTtl: 300 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(cache.get('k', fetcher, { ttl: 60, notFoundTtl: 300 })).rejects.toBeInstanceOf(NotFoundError);
    expect(fetcher).toHaveBeenCalledTimes(1);
    clock.advance(301);
    await expect(cache.get('k', fetcher, { ttl: 60, notFoundTtl: 300 })).rejects.toBeInstanceOf(NotFoundError);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('remembers "not on your plan" answers too, and rethrows them as such', async () => {
    const { cache } = setup();
    const fetcher = vi.fn().mockRejectedValue(new PlanRestrictedError('Not on the free tier'));
    await expect(cache.get('k', fetcher, { ttl: 60, notFoundTtl: 300 })).rejects.toBeInstanceOf(PlanRestrictedError);
    await expect(cache.get('k', fetcher, { ttl: 60, notFoundTtl: 300 })).rejects.toThrow('Not on the free tier');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps serving a stale value instead of caching a later 404 over it', async () => {
    const { cache, clock } = setup();
    await cache.get('k', () => Promise.resolve('v1'), { ttl: 60, notFoundTtl: 300 });
    clock.advance(120);
    expect(await cache.get('k', () => Promise.reject(new NotFoundError()), { ttl: 60, notFoundTtl: 300 })).toMatchObject({ data: 'v1', stale: true });
  });

  it('derives the TTL from the value', async () => {
    const { cache, clock } = setup();
    const fetcher = vi.fn().mockResolvedValue({ live: true });
    await cache.get('k', fetcher, { ttl: (v: { live: boolean }) => (v.live ? 30 : 3600) });
    clock.advance(31);
    await cache.get('k', fetcher, { ttl: (v: { live: boolean }) => (v.live ? 30 : 3600) });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('serves stale data instead of refetching while another instance holds the refresh lock', async () => {
    const { cache, clock, store } = setup();
    await cache.get('k', () => Promise.resolve('v1'), { ttl: 60 });
    clock.advance(61);
    await store.setIfAbsent('lock:k', '1', 10);
    const fetcher = vi.fn().mockResolvedValue('v2');
    const r = await cache.get('k', fetcher, { ttl: 60 });
    expect(fetcher).not.toHaveBeenCalled();
    expect(r).toMatchObject({ data: 'v1', stale: true });
  });

  it('cacheOnly returns stale data without refreshing', async () => {
    const { cache, clock } = setup();
    await cache.get('k', () => Promise.resolve('v1'), { ttl: 60 });
    clock.advance(120);
    const fetcher = vi.fn();
    expect(await cache.get('k', fetcher, { ttl: 60, cacheOnly: true })).toMatchObject({ data: 'v1', stale: true });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('cacheOnly never fetches, even on a miss', async () => {
    const { cache } = setup();
    const fetcher = vi.fn();
    await expect(cache.get('nothing', fetcher, { ttl: 60, cacheOnly: true })).rejects.toBeInstanceOf(CacheMissError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps working when Redis is unreachable', async () => {
    const broken: KeyValueStore = {
      kind: 'redis',
      getJson: () => Promise.reject(new Error('ECONNRESET')),
      setJson: () => Promise.reject(new Error('ECONNRESET')),
      setIfAbsent: () => Promise.reject(new Error('ECONNRESET')),
      del: () => Promise.reject(new Error('ECONNRESET')),
      incrWithExpiry: () => Promise.reject(new Error('ECONNRESET')),
      ping: () => Promise.reject(new Error('ECONNRESET')),
    };
    const cache = new SwrCache(broken, { now: () => 0, logger: silentLogger, hardTtlSeconds: 1, lockSeconds: 1, waitAttempts: 0, waitDelayMs: 0 });
    expect(await cache.get('k', () => Promise.resolve('direct'), { ttl: 60 })).toMatchObject({ data: 'direct', stale: false });
  });
});

describe('UpstreamBudget', () => {
  it('allows up to the per-minute limit, then refuses until the next minute', async () => {
    let now = Date.parse('2026-10-18T12:00:05Z');
    const budget = new UpstreamBudget(new MemoryStore(() => now), { name: 'fd', perMinute: 3 }, () => now, silentLogger);
    for (let i = 0; i < 3; i++) expect((await budget.tryAcquire()).ok).toBe(true);
    const denied = await budget.tryAcquire();
    expect(denied).toEqual({ ok: false, reason: 'minute', retryAfterSeconds: 55 });
    now += 60_000;
    expect((await budget.tryAcquire()).ok).toBe(true);
  });

  it('enforces a daily cap', async () => {
    let now = Date.parse('2026-10-18T23:00:00Z');
    const budget = new UpstreamBudget(new MemoryStore(() => now), { name: 'af', perMinute: 100, perDay: 2 }, () => now, silentLogger);
    expect((await budget.tryAcquire()).ok).toBe(true);
    expect((await budget.tryAcquire()).ok).toBe(true);
    const denied = await budget.tryAcquire();
    expect(denied).toMatchObject({ ok: false, reason: 'day', retryAfterSeconds: 3600 });
    now = Date.parse('2026-10-19T00:00:01Z');
    expect((await budget.tryAcquire()).ok).toBe(true);
  });

  it('honours an explicit block from a 429 or quota header', async () => {
    let now = 0;
    const budget = new UpstreamBudget(new MemoryStore(() => now), { name: 'fd', perMinute: 10 }, () => now, silentLogger);
    await budget.blockFor(30, 'test');
    expect(await budget.tryAcquire()).toMatchObject({ ok: false, reason: 'blocked', retryAfterSeconds: 30 });
    now += 31_000;
    expect((await budget.tryAcquire()).ok).toBe(true);
  });
});

describe('per-IP limit', () => {
  it('counts per IP per minute', async () => {
    const store = new MemoryStore(() => 0);
    expect((await checkIpLimit(store, '1.1.1.1', 2, 0)).allowed).toBe(true);
    expect((await checkIpLimit(store, '1.1.1.1', 2, 0)).allowed).toBe(true);
    expect(await checkIpLimit(store, '1.1.1.1', 2, 0)).toMatchObject({ allowed: false, remaining: 0 });
    expect((await checkIpLimit(store, '2.2.2.2', 2, 0)).allowed).toBe(true);
  });

  it('takes the first x-forwarded-for address', () => {
    const h = new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' });
    expect(clientIp(h)).toBe('203.0.113.7');
    expect(clientIp(new Headers({ 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2');
  });
});

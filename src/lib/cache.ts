import type { AppError } from './errors.js';
import { NotFoundError, PlanRestrictedError } from './errors.js';
import type { Logger } from './logger.js';
import { errorMessage } from './logger.js';
import type { KeyValueStore } from './store.js';

export interface CacheEntry<T> {
  /** value */
  v: T;
  /** fetched at, epoch ms */
  t: number;
  /** soft TTL in seconds; after this the entry is stale but still servable */
  s: number;
}

/** Remembered "not there" answers: a 404, or a 403 for a resource outside the provider plan. */
interface NotFoundMarker {
  nf: true;
  t: number;
  /** 'restricted' for a remembered 403; absent for a 404. */
  why?: 'restricted';
  msg?: string;
}

export interface CacheResult<T> {
  data: T;
  stale: boolean;
  fetchedAt: number;
  /** Set when the value is stale because a refresh failed. */
  error?: AppError | Error;
}

export interface CacheOptions<T> {
  /** Soft TTL in seconds, or a function of the fetched value (e.g. shorter when a match is live). */
  ttl: number | ((value: T) => number);
  /** Seconds to remember a provider 404 (or a 403 "not on your plan") so it doesn't burn the request budget. */
  notFoundTtl?: number;
  /** Serve whatever is cached, even stale, without attempting a refresh; throws CacheMissError when empty. */
  cacheOnly?: boolean;
}

export interface SwrCacheConfig {
  now: () => number;
  logger: Logger;
  /** How long entries survive in Redis after their soft TTL, for stale fallback. */
  hardTtlSeconds: number;
  lockSeconds: number;
  /** Waiting for a concurrent refresh by another instance: attempts × delay. */
  waitAttempts: number;
  waitDelayMs: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A `cacheOnly` read found nothing. Not a failure: the caller just has no data yet. */
export class CacheMissError extends Error {
  constructor(key: string) {
    super(`No cached value for ${key}`);
    this.name = 'CacheMissError';
  }
}

/**
 * Stale-while-revalidate cache over Redis.
 *
 * fresh hit         → return it
 * stale hit         → refresh (one instance at a time via a lock); if the refresh
 *                     fails (429, budget exhausted, 5xx, timeout) return the stale
 *                     value with `stale: true`
 * miss              → fetch; concurrent misses wait briefly for the first fetch
 * Redis unavailable → behave as a miss and keep serving from the provider
 */
export class SwrCache {
  constructor(
    private readonly store: KeyValueStore,
    private readonly config: SwrCacheConfig,
  ) {}

  async peek<T>(key: string): Promise<CacheEntry<T> | null> {
    try {
      const raw = await this.store.getJson<CacheEntry<T> | NotFoundMarker>(key);
      if (!raw || 'nf' in raw) return null;
      return raw;
    } catch (e) {
      this.config.logger.warn('cache.read_failed', { key, error: errorMessage(e) });
      return null;
    }
  }

  async get<T>(key: string, fetcher: () => Promise<T>, options: CacheOptions<T>): Promise<CacheResult<T>> {
    const now = this.config.now();
    let raw: CacheEntry<T> | NotFoundMarker | null = null;
    try {
      raw = await this.store.getJson<CacheEntry<T> | NotFoundMarker>(key);
    } catch (e) {
      this.config.logger.warn('cache.read_failed', { key, error: errorMessage(e) });
    }

    if (raw && 'nf' in raw) {
      if (now - raw.t < (options.notFoundTtl ?? 0) * 1000) {
        throw raw.why === 'restricted' ? new PlanRestrictedError(raw.msg ?? 'Not available on the current plan.') : new NotFoundError();
      }
      raw = null;
    }
    const entry = raw;

    if (entry && now - entry.t < entry.s * 1000) {
      return { data: entry.v, stale: false, fetchedAt: entry.t };
    }
    if (options.cacheOnly) {
      if (entry) return { data: entry.v, stale: true, fetchedAt: entry.t };
      throw new CacheMissError(key);
    }

    const lockKey = `lock:${key}`;
    const locked = await this.tryLock(lockKey);

    if (!locked) {
      if (entry) return { data: entry.v, stale: true, fetchedAt: entry.t };
      // Someone else is fetching this key right now; give them a moment.
      for (let i = 0; i < this.config.waitAttempts; i++) {
        await sleep(this.config.waitDelayMs);
        const fresh = await this.peek<T>(key);
        if (fresh) return { data: fresh.v, stale: false, fetchedAt: fresh.t };
      }
    }

    try {
      const value = await fetcher();
      const fetchedAt = this.config.now();
      const ttl = typeof options.ttl === 'function' ? options.ttl(value) : options.ttl;
      await this.write(key, { v: value, t: fetchedAt, s: ttl } satisfies CacheEntry<T>, ttl + this.config.hardTtlSeconds);
      return { data: value, stale: false, fetchedAt };
    } catch (e) {
      if ((e instanceof NotFoundError || e instanceof PlanRestrictedError) && options.notFoundTtl && !entry) {
        const marker: NotFoundMarker = e instanceof PlanRestrictedError ? { nf: true, t: this.config.now(), why: 'restricted', msg: e.message } : { nf: true, t: this.config.now() };
        await this.write(key, marker, options.notFoundTtl);
        throw e;
      }
      if (entry) {
        this.config.logger.warn('cache.serving_stale', { key, error: errorMessage(e) });
        return { data: entry.v, stale: true, fetchedAt: entry.t, error: e instanceof Error ? e : new Error(String(e)) };
      }
      throw e;
    } finally {
      if (locked) await this.unlock(lockKey);
    }
  }

  /** Writes a value directly (used to fan out a batch response into per-item keys). */
  async put<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.write(key, { v: value, t: this.config.now(), s: ttlSeconds } satisfies CacheEntry<T>, ttlSeconds + this.config.hardTtlSeconds);
  }

  private async write(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.store.setJson(key, value, ttlSeconds);
    } catch (e) {
      this.config.logger.warn('cache.write_failed', { key, error: errorMessage(e) });
    }
  }

  private async tryLock(key: string): Promise<boolean> {
    try {
      return await this.store.setIfAbsent(key, '1', this.config.lockSeconds);
    } catch {
      return true;
    }
  }

  private async unlock(key: string): Promise<void> {
    try {
      await this.store.del(key);
    } catch {
      // The lock expires on its own.
    }
  }
}

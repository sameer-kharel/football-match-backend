import type { ResponseMeta, Source } from '../domain/types.js';
import type { CacheResult } from '../lib/cache.js';
import { UpstreamError, isAppError } from '../lib/errors.js';

/** Collects staleness, sources and warnings across the cache reads that build one response. */
export class MetaCollector {
  stale = false;
  partial = false;
  delayed = false;
  readonly sources = new Set<Source>();
  readonly warnings: string[] = [];
  private oldest = Number.POSITIVE_INFINITY;
  private successes = 0;
  private failures = 0;
  private lastError: unknown = null;

  /** `content: false` for lookups (competition lists, league ids) that don't count as loaded data. */
  add<T>(result: CacheResult<T>, source?: Source, content = true): T {
    if (content) this.successes++;
    if (result.stale) this.stale = true;
    this.oldest = Math.min(this.oldest, result.fetchedAt);
    if (source) this.sources.add(source);
    return result.data;
  }

  warn(message: string): void {
    if (!this.warnings.includes(message)) this.warnings.push(message);
  }

  missing(message: string): void {
    this.partial = true;
    this.warn(message);
  }

  /** A part of the response could not be loaded; the rest is still served. */
  fail(error: unknown, message: string): void {
    this.failures++;
    this.lastError = error;
    this.missing(message);
  }

  /** When nothing at all could be loaded, surface the error instead of an empty list. */
  throwIfNothingLoaded(): void {
    if (this.successes > 0 || this.failures === 0) return;
    if (isAppError(this.lastError)) throw this.lastError;
    throw new UpstreamError('The data provider is unavailable right now.');
  }

  toMeta(now: number): ResponseMeta {
    return {
      stale: this.stale,
      fetchedAt: new Date(Number.isFinite(this.oldest) ? this.oldest : now).toISOString(),
      sources: [...this.sources],
      delayed: this.delayed,
      partial: this.partial,
      warnings: this.warnings,
    };
  }
}

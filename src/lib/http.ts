import type { Context } from 'hono';
import { CDN } from '../config/ttl.js';
import type { Envelope } from '../domain/types.js';
import type { MetaCollector } from '../services/meta.js';
import type { AppError } from './errors.js';

export type CdnPolicy = (typeof CDN)[keyof typeof CDN];

/**
 * Vercel's CDN honours s-maxage and stale-while-revalidate on function responses.
 * max-age=0 keeps phones from caching on their own; the app has its own store.
 * Stale responses get a short edge life so a recovered provider shows up quickly.
 */
export function cacheControl(policy: CdnPolicy, stale: boolean): string {
  const p = stale ? CDN.stale : policy;
  return `public, max-age=0, s-maxage=${p.sMaxAge}, stale-while-revalidate=${p.swr}`;
}

export function sendData<T>(c: Context, data: T, meta: MetaCollector, policy: CdnPolicy, now: number) {
  const body: Envelope<T> = { data, meta: meta.toMeta(now) };
  c.header('Cache-Control', cacheControl(policy, body.meta.stale || body.meta.partial));
  return c.json(body, 200);
}

export function sendError(c: Context, error: AppError) {
  c.header('Cache-Control', 'no-store');
  if (error.retryAfterSeconds) c.header('Retry-After', String(error.retryAfterSeconds));
  return c.json(
    { error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } },
    error.status,
  );
}

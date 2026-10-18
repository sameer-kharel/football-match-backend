import type { KeyValueStore } from './store.js';

export interface IpLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}

/** Fixed-window per-IP limiter shared through Redis. Fails open if Redis is unreachable. */
export async function checkIpLimit(
  store: KeyValueStore,
  ip: string,
  limitPerMinute: number,
  nowMs: number,
): Promise<IpLimitDecision> {
  const window = Math.floor(nowMs / 60_000);
  const resetSeconds = 60 - Math.floor((nowMs % 60_000) / 1000);
  try {
    const count = await store.incrWithExpiry(`ip:${ip}:${window}`, 90);
    return { allowed: count <= limitPerMinute, limit: limitPerMinute, remaining: Math.max(0, limitPerMinute - count), resetSeconds };
  } catch {
    return { allowed: true, limit: limitPerMinute, remaining: limitPerMinute, resetSeconds };
  }
}

/** Vercel puts the client address first in x-forwarded-for and also sets x-real-ip. */
export function clientIp(headers: { get(name: string): string | null | undefined }): string {
  const forwarded = headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || headers.get('x-real-ip')?.trim() || 'unknown';
}

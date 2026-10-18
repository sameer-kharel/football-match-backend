import type { Logger } from './logger.js';
import { errorMessage } from './logger.js';
import type { KeyValueStore } from './store.js';

export interface BudgetConfig {
  /** Short provider tag used in Redis keys, e.g. "fd" or "af". */
  name: string;
  perMinute: number;
  perDay?: number;
}

export type BudgetDecision = { ok: true } | { ok: false; reason: 'minute' | 'day' | 'blocked'; retryAfterSeconds: number };

export interface BudgetSnapshot {
  minuteUsed: number;
  dayUsed: number | null;
  blockedUntil: number | null;
  perMinute: number;
  perDay: number | null;
}

/**
 * Shared outgoing request budget for a provider, counted in Redis so every
 * serverless instance sees the same numbers. Fixed one-minute and UTC-day windows.
 * The provider's own quota headers can additionally block calls until its reset.
 */
export class UpstreamBudget {
  constructor(
    private readonly store: KeyValueStore,
    readonly config: BudgetConfig,
    private readonly now: () => number,
    private readonly logger: Logger,
  ) {}

  private keys(at: number) {
    const minute = Math.floor(at / 60_000);
    const day = new Date(at).toISOString().slice(0, 10).replaceAll('-', '');
    return {
      minute: `budget:${this.config.name}:m:${minute}`,
      day: `budget:${this.config.name}:d:${day}`,
      blocked: `budget:${this.config.name}:blocked`,
    };
  }

  async tryAcquire(): Promise<BudgetDecision> {
    const at = this.now();
    const k = this.keys(at);
    try {
      const blockedUntil = await this.store.getJson<number>(k.blocked);
      if (blockedUntil && blockedUntil > at) {
        return { ok: false, reason: 'blocked', retryAfterSeconds: Math.ceil((blockedUntil - at) / 1000) };
      }
      const minuteCount = await this.store.incrWithExpiry(k.minute, 120);
      if (minuteCount > this.config.perMinute) {
        return { ok: false, reason: 'minute', retryAfterSeconds: 60 - Math.floor((at % 60_000) / 1000) };
      }
      if (this.config.perDay !== undefined) {
        const dayCount = await this.store.incrWithExpiry(k.day, 2 * 86_400);
        if (dayCount > this.config.perDay) {
          const nextMidnight = Math.ceil(at / 86_400_000) * 86_400_000;
          return { ok: false, reason: 'day', retryAfterSeconds: Math.ceil((nextMidnight - at) / 1000) };
        }
      }
      return { ok: true };
    } catch (e) {
      // Fail open: if Redis is down we would rather try the provider than show nothing.
      // The provider's 429 then blocks us through `blockFor`.
      this.logger.warn('budget.store_failed', { budget: this.config.name, error: errorMessage(e) });
      return { ok: true };
    }
  }

  /** Stop calling the provider for `seconds` (after a 429, or when its quota header says 0 left). */
  async blockFor(seconds: number, reason: string): Promise<void> {
    const at = this.now();
    const until = at + Math.max(1, seconds) * 1000;
    this.logger.warn('budget.blocked', { budget: this.config.name, seconds, reason });
    try {
      await this.store.setJson(this.keys(at).blocked, until, Math.max(1, seconds));
    } catch (e) {
      this.logger.warn('budget.store_failed', { budget: this.config.name, error: errorMessage(e) });
    }
  }

  async snapshot(): Promise<BudgetSnapshot> {
    const at = this.now();
    const k = this.keys(at);
    const [minuteUsed, dayUsed, blockedUntil] = await Promise.all([
      this.store.getJson<number>(k.minute),
      this.config.perDay !== undefined ? this.store.getJson<number>(k.day) : Promise.resolve(null),
      this.store.getJson<number>(k.blocked),
    ]);
    return {
      minuteUsed: minuteUsed ?? 0,
      dayUsed: this.config.perDay !== undefined ? (dayUsed ?? 0) : null,
      blockedUntil: blockedUntil && blockedUntil > at ? blockedUntil : null,
      perMinute: this.config.perMinute,
      perDay: this.config.perDay ?? null,
    };
  }
}

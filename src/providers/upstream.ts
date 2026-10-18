import type { UpstreamBudget } from '../lib/budget.js';
import { NotFoundError, PlanRestrictedError, UpstreamError, UpstreamRateLimitedError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import { errorMessage } from '../lib/logger.js';

export type FetchLike = (input: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;

export interface UpstreamClientConfig {
  providerName: string;
  baseUrl: string;
  headers: Record<string, string>;
  budget: UpstreamBudget;
  logger: Logger;
  fetch?: FetchLike;
  timeoutMs?: number;
  /** Reads provider quota headers after every response; returns seconds to block, if any. */
  inspectQuota?: (headers: Headers) => number | null;
}

/**
 * Budgeted JSON GET. Every outgoing provider call goes through here:
 * budget check → fetch with timeout → quota headers → status mapping.
 */
export class UpstreamClient {
  private readonly fetchImpl: FetchLike;

  constructor(private readonly config: UpstreamClientConfig) {
    this.fetchImpl = config.fetch ?? ((input, init) => fetch(input, init));
  }

  async getJson<T>(path: string, query: Record<string, string | number | undefined> = {}, extraHeaders: Record<string, string> = {}): Promise<T> {
    const decision = await this.config.budget.tryAcquire();
    if (!decision.ok) throw new UpstreamRateLimitedError(decision.retryAfterSeconds, this.config.providerName);

    const url = new URL(path.replace(/^\//, ''), this.config.baseUrl.endsWith('/') ? this.config.baseUrl : `${this.config.baseUrl}/`);
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));

    const started = Date.now();
    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), {
        headers: { Accept: 'application/json', ...this.config.headers, ...extraHeaders },
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 8_000),
      });
    } catch (e) {
      this.config.logger.warn('upstream.network_error', { provider: this.config.providerName, path: url.pathname, error: errorMessage(e) });
      throw new UpstreamError(`${this.config.providerName} did not respond.`);
    }

    const blockSeconds = this.config.inspectQuota?.(res.headers);
    if (blockSeconds) await this.config.budget.blockFor(blockSeconds, 'quota_header');

    this.config.logger.info('upstream.response', {
      provider: this.config.providerName,
      path: url.pathname,
      status: res.status,
      ms: Date.now() - started,
    });

    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after')) || 60;
      await this.config.budget.blockFor(retry, 'http_429');
      throw new UpstreamRateLimitedError(retry, this.config.providerName);
    }
    if (res.status === 404) throw new NotFoundError();
    if (res.status === 403) throw new PlanRestrictedError(`This resource isn't included in the current ${this.config.providerName} plan.`);
    if (res.status === 400) throw new UpstreamError(`${this.config.providerName} rejected the request.`);
    if (!res.ok) throw new UpstreamError(`${this.config.providerName} returned ${res.status}.`);

    try {
      return (await res.json()) as T;
    } catch {
      throw new UpstreamError(`${this.config.providerName} sent an unreadable response.`);
    }
  }
}

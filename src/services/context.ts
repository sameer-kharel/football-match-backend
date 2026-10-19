import type { Env } from '../env.js';
import { loadEnv } from '../env.js';
import { HARD_TTL } from '../config/ttl.js';
import { UpstreamBudget } from '../lib/budget.js';
import { SwrCache } from '../lib/cache.js';
import type { Logger } from '../lib/logger.js';
import { consoleLogger } from '../lib/logger.js';
import type { KeyValueStore } from '../lib/store.js';
import { createStore } from '../lib/store.js';
import type { AfLeagueInfo } from '../providers/api-football/provider.js';
import { ApiFootballProvider } from '../providers/api-football/provider.js';
import { FootballDataProvider } from '../providers/football-data/provider.js';
import { OpenLigaDbProvider } from '../providers/openligadb/provider.js';
import type { OlSeason } from '../providers/openligadb/raw.js';
import type { FetchLike } from '../providers/upstream.js';

export interface AppContext {
  env: Env;
  store: KeyValueStore;
  cache: SwrCache;
  logger: Logger;
  now: () => number;
  fd: FootballDataProvider | null;
  af: ApiFootballProvider | null;
  ol: OpenLigaDbProvider | null;
  budgets: { fd: UpstreamBudget; af: UpstreamBudget; ol: UpstreamBudget };
}

export interface ContextOverrides {
  env?: Env;
  store?: KeyValueStore;
  logger?: Logger;
  now?: () => number;
  fetch?: FetchLike;
  /** Lets tests skip the league lookups. */
  afLeagues?: () => Promise<Map<string, AfLeagueInfo>>;
  /** Lets tests hand OpenLigaDB seasons over directly. */
  olSeasons?: (shortcut: string) => Promise<OlSeason>;
  cacheWait?: { attempts: number; delayMs: number };
}

export function createContext(overrides: ContextOverrides = {}): AppContext {
  const env = overrides.env ?? loadEnv();
  const store = overrides.store ?? createStore(process.env);
  const logger = overrides.logger ?? consoleLogger;
  const now = overrides.now ?? Date.now;

  if (store.kind === 'memory' && env.isProduction) {
    logger.error('redis.missing', { hint: 'Connect Upstash Redis: caches and rate limits are per-instance without it.' });
  }

  const cache = new SwrCache(store, {
    now,
    logger,
    hardTtlSeconds: HARD_TTL,
    lockSeconds: 15,
    waitAttempts: overrides.cacheWait?.attempts ?? 4,
    waitDelayMs: overrides.cacheWait?.delayMs ?? 250,
  });

  const budgets = {
    fd: new UpstreamBudget(store, { name: 'fd', perMinute: env.footballDataRpm }, now, logger),
    af: new UpstreamBudget(store, { name: 'af', perMinute: env.apiFootballRpm, perDay: env.apiFootballDailyBudget }, now, logger),
    ol: new UpstreamBudget(store, { name: 'ol', perMinute: env.openLigaDbRpm }, now, logger),
  };

  const fd = env.footballDataKey
    ? new FootballDataProvider({
        apiKey: env.footballDataKey,
        budget: budgets.fd,
        logger,
        delayed: env.footballDataPlan === 'free',
        ...(overrides.fetch ? { fetch: overrides.fetch } : {}),
      })
    : null;

  const ctx: AppContext = { env, store, cache, logger, now, fd, af: null, ol: null, budgets };

  if (env.apiFootballEnabled && env.apiFootballKey) {
    ctx.af = new ApiFootballProvider({
      apiKey: env.apiFootballKey,
      budget: budgets.af,
      logger,
      // Imported lazily to avoid a cycle: the directory needs ctx.af to look leagues up.
      leagues: overrides.afLeagues ?? (async () => (await import('./availability.js')).apiFootballLeagues(ctx)),
      ...(overrides.fetch ? { fetch: overrides.fetch } : {}),
    });
  }

  if (env.openLigaDbEnabled) {
    ctx.ol = new OpenLigaDbProvider({
      budget: budgets.ol,
      logger,
      now,
      // Lazy for the same reason: the season loader caches through ctx and calls ctx.ol.
      seasons: overrides.olSeasons ?? (async (shortcut) => (await import('./openligadb.js')).olSeason(ctx, shortcut)),
      ...(overrides.fetch ? { fetch: overrides.fetch } : {}),
    });
  }

  return ctx;
}

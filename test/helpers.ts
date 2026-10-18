import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Env } from '../src/env.js';
import { silentLogger } from '../src/lib/logger.js';
import { MemoryStore } from '../src/lib/store.js';
import type { AfLeagueInfo } from '../src/providers/api-football/provider.js';
import type { FetchLike } from '../src/providers/upstream.js';
import type { AppContext, ContextOverrides } from '../src/services/context.js';
import { createContext } from '../src/services/context.js';

export function fixture<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${path}`, import.meta.url)), 'utf8')) as T;
}

export const NOW = Date.parse('2026-10-18T12:00:00Z');

export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    footballDataKey: 'test-key',
    footballDataPlan: 'free',
    footballDataRpm: 8,
    apiFootballEnabled: false,
    apiFootballKey: '',
    apiFootballDailyBudget: 90,
    apiFootballRpm: 8,
    ipLimitPerMinute: 120,
    cronSecret: 'cron-secret',
    isProduction: false,
    ...overrides,
  };
}

export interface Route {
  /** Matched against pathname + search, e.g. "/v4/matches?date=2026-10-18". */
  match: RegExp;
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface FakeFetch {
  fetch: FetchLike;
  calls: string[];
  routes: Route[];
}

export function fakeFetch(routes: Route[]): FakeFetch {
  const calls: string[] = [];
  const state: FakeFetch = {
    routes,
    calls,
    fetch: (input) => {
      const url = new URL(input);
      const target = url.pathname + url.search;
      calls.push(target);
      const route = state.routes.find((r) => r.match.test(target));
      if (!route) return Promise.resolve(new Response(JSON.stringify({ message: 'not found' }), { status: 404 }));
      return Promise.resolve(
        new Response(JSON.stringify(route.body ?? {}), {
          status: route.status ?? 200,
          headers: { 'content-type': 'application/json', ...(route.headers ?? {}) },
        }),
      );
    },
  };
  return state;
}

export function fdRoutes(): Route[] {
  return [
    { match: /^\/v4\/competitions$/, body: fixture('fd/competitions.json') },
    { match: /^\/v4\/matches\?date=2026-10-17/, body: fixture('fd/matches-2026-10-17.json') },
    { match: /^\/v4\/matches\?date=2026-10-18/, body: fixture('fd/matches-2026-10-18.json') },
    { match: /^\/v4\/matches\?date=2026-10-19/, body: fixture('fd/matches-2026-10-19.json') },
    { match: /^\/v4\/matches\?dateFrom=/, body: { matches: [
      ...fixture<{ matches: unknown[] }>('fd/matches-2026-10-18.json').matches,
      ...fixture<{ matches: unknown[] }>('fd/matches-2026-10-19.json').matches,
    ] } },
    { match: /^\/v4\/competitions\/PD\/standings/, body: fixture('fd/standings-PD.json') },
    { match: /^\/v4\/competitions\/PL\/teams/, body: fixture('fd/teams-PL.json') },
    { match: /^\/v4\/competitions\/[A-Z0-9]+\/teams/, body: { teams: [] } },
    { match: /^\/v4\/matches\/540003\/head2head/, body: fixture('fd/h2h-540003.json') },
  ];
}

export function makeCtx(options: { fetch: FetchLike; now?: () => number; env?: Partial<Env>; store?: MemoryStore; afLeagues?: Map<string, AfLeagueInfo> }): AppContext {
  let clock = NOW;
  const now = options.now ?? (() => clock);
  const overrides: ContextOverrides = {
    env: testEnv(options.env),
    store: options.store ?? new MemoryStore(now),
    logger: silentLogger,
    now,
    fetch: options.fetch,
    cacheWait: { attempts: 0, delayMs: 0 },
  };
  if (options.afLeagues) {
    const leagues = options.afLeagues;
    overrides.afLeagues = () => Promise.resolve(leagues);
  }
  const ctx = createContext(overrides);
  (ctx as AppContext & { setNow?: (t: number) => void }).setNow = (t: number) => {
    clock = t;
  };
  return ctx;
}

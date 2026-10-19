import { AF_TTL, TTL } from '../config/ttl.js';
import { localDayWindow, toUtcDate, utcDatesCovering } from '../domain/time.js';
import type { Match, Source } from '../domain/types.js';
import { CacheMissError } from '../lib/cache.js';
import { errorMessage } from '../lib/logger.js';
import type { ActiveCompetition } from './availability.js';
import { activeCompetitions, cachePrefix, hasProvider, providerFor } from './availability.js';
import type { AppContext } from './context.js';
import { DayCoverage, failureMessage } from './failover.js';
import type { FeaturedIndex } from './featured.js';
import { annotateMatch, featuredIndex } from './featured.js';
import type { MetaCollector } from './meta.js';

const HOUR = 3_600_000;

export function isActive(m: Match, now: number): boolean {
  if (m.status === 'live' || m.status === 'paused') return true;
  const kickoff = Date.parse(m.utcDate);
  // About to start, or should be in play but the (delayed) feed hasn't flipped yet.
  return m.status === 'scheduled' && kickoff - now < HOUR && now - kickoff < 3 * HOUR;
}

/** Cache lifetime for one UTC day's match list, driven by what's in it. */
export function dayTtl(source: Source, date: string, matches: readonly Match[], now: number): number {
  const t = source === 'api-football' ? AF_TTL : TTL;
  if (matches.some((m) => isActive(m, now))) return t.dayActive;
  const today = toUtcDate(now);
  if (date === today) return t.dayToday;
  return date > today ? t.dayFuture : t.dayPast;
}

/** One UTC day of matches for a provider, all competitions it serves. Throws when nothing is cached and the fetch fails. */
export async function loadDay(ctx: AppContext, source: Source, date: string, meta: MetaCollector, options: { cacheOnly?: boolean } = {}): Promise<Match[]> {
  const provider = providerFor(ctx, source);
  const res = await ctx.cache.get(`${cachePrefix(source)}:day:${date}`, () => provider.matchesOnDate(date), {
    ttl: (v) => dayTtl(source, date, v, ctx.now()),
    ...(options.cacheOnly ? { cacheOnly: true } : {}),
  });
  if (source === 'football-data' && ctx.env.footballDataPlan === 'free') meta.delayed = true;
  return meta.add(res, source);
}

/** Like loadDay, but a failure becomes a partial-response warning and an empty list. */
export async function dayMatches(ctx: AppContext, source: Source, date: string, meta: MetaCollector, options: { cacheOnly?: boolean } = {}): Promise<Match[]> {
  try {
    return await loadDay(ctx, source, date, meta, options);
  } catch (e) {
    if (e instanceof CacheMissError) return [];
    ctx.logger.warn('matches.day_failed', { source, date, error: errorMessage(e) });
    meta.fail(e, failureMessage(e));
    return [];
  }
}

export interface CoverOptions {
  /** Days to read from the cache only, never fetching (protects small daily quotas). */
  cacheOnly?: (source: Source, date: string) => boolean;
  /** Lists already loaded for every day (a ranged call). */
  preloaded?: { source: Source; matches: Match[] };
  /** A cache-only miss that counts as this failure, so backups step in. */
  missCountsAs?: (source: Source) => unknown;
}

/**
 * Day lists for several UTC days and the competitions' sources, with backups
 * loaded for any competition whose source failed. Only matches from the source
 * each competition ends up using are kept, so no match appears twice.
 */
export async function coveredDays(ctx: AppContext, comps: readonly ActiveCompetition[], dates: readonly string[], meta: MetaCollector, options: CoverOptions = {}): Promise<Match[]> {
  const coverage = new DayCoverage();
  const all: Match[] = [];
  if (options.preloaded) {
    all.push(...options.preloaded.matches);
    for (const d of dates) coverage.markLoaded(options.preloaded.source, d);
  }
  const load = async (source: Source, date: string) => {
    try {
      all.push(...(await loadDay(ctx, source, date, meta, options.cacheOnly?.(source, date) ? { cacheOnly: true } : {})));
      coverage.markLoaded(source, date);
    } catch (e) {
      // A cache-only miss isn't a failure by itself: the day just isn't loaded yet.
      const error = e instanceof CacheMissError ? options.missCountsAs?.(source) : e;
      if (!error) return;
      if (error === e) ctx.logger.warn('matches.day_failed', { source, date, error: errorMessage(e) });
      coverage.markFailed(source, date, error);
    }
  };

  const sources = [...new Set(comps.map((c) => c.source))].filter((s) => s !== options.preloaded?.source);
  for (const source of sources) for (const d of dates) await load(source, d);
  for (const d of dates) {
    for (let backups = coverage.backupsNeeded(comps, d); backups.length > 0; backups = coverage.backupsNeeded(comps, d)) {
      for (const b of backups) await load(b, d);
    }
  }

  coverage.report(comps, dates, meta);
  const byId = new Map(comps.map((c) => [c.config.id, c]));
  return dedupe(all).filter((m) => {
    const comp = byId.get(m.competitionId);
    return !!comp && coverage.keep(m, comp);
  });
}

export function sortByCompetitionThenKickoff(matches: Match[], active: readonly ActiveCompetition[]): Match[] {
  const prio = new Map(active.map((a) => [a.config.id, a.config.priority]));
  return matches.sort(
    (a, b) =>
      (prio.get(a.competitionId) ?? 999) - (prio.get(b.competitionId) ?? 999) ||
      a.utcDate.localeCompare(b.utcDate) ||
      a.id.localeCompare(b.id),
  );
}

export function dedupe(matches: readonly Match[]): Match[] {
  const byId = new Map<string, Match>();
  for (const m of matches) byId.set(m.id, m);
  return [...byId.values()];
}

/**
 * Replaces matches that may be live with the version from the (frequently
 * refreshed) day lists, so pinned/team/competition lists don't lag behind
 * their longer cache lifetimes.
 */
export async function overlayLive(ctx: AppContext, matches: Match[], meta: MetaCollector): Promise<Match[]> {
  const now = ctx.now();
  const candidates = matches.filter((m) => {
    const k = Date.parse(m.utcDate);
    return m.status !== 'finished' && k > now - 4 * HOUR && k < now + HOUR;
  });
  if (candidates.length === 0) return matches;

  const needed = new Map<string, { source: Source; date: string }>();
  for (const m of candidates) needed.set(`${m.source}|${m.utcDate.slice(0, 10)}`, { source: m.source, date: m.utcDate.slice(0, 10) });

  const fresh = new Map<string, Match>();
  for (const { source, date } of needed.values()) {
    if (!hasProvider(ctx, source)) continue;
    for (const m of await dayMatches(ctx, source, date, meta)) fresh.set(m.id, m);
  }
  return matches.map((m) => fresh.get(m.id) ?? m);
}

export interface LocalDayQuery {
  date: string;
  tz: string;
  competitionIds?: string[];
}

export async function matchesForLocalDate(ctx: AppContext, q: LocalDayQuery, meta: MetaCollector): Promise<{ matches: Match[]; active: ActiveCompetition[]; index: FeaturedIndex }> {
  const active = await activeCompetitions(ctx, meta);
  const wanted = q.competitionIds?.length
    ? active.filter((a) => q.competitionIds?.includes(a.config.id))
    : active.filter((a) => a.config.defaultEnabled);

  const { startMs, endMs } = localDayWindow(q.date, q.tz);
  const dates = utcDatesCovering(startMs, endMs);

  const index = await featuredIndex(ctx, active);
  const matches = (await coveredDays(ctx, wanted, dates, meta))
    .filter((m) => {
      const k = Date.parse(m.utcDate);
      return k >= startMs && k < endMs;
    })
    .map((m) => annotateMatch(m, index));

  return { matches: sortByCompetitionThenKickoff(matches, active), active, index };
}

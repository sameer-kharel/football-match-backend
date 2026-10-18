import { AF_TTL, TTL } from '../config/ttl.js';
import { localDayWindow, toUtcDate, utcDatesCovering } from '../domain/time.js';
import type { Match, Source } from '../domain/types.js';
import { CacheMissError } from '../lib/cache.js';
import { isAppError } from '../lib/errors.js';
import { errorMessage } from '../lib/logger.js';
import type { ActiveCompetition } from './availability.js';
import { activeCompetitions, cachePrefix, providerFor } from './availability.js';
import type { AppContext } from './context.js';
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
  const t = source === 'football-data' ? TTL : AF_TTL;
  if (matches.some((m) => isActive(m, now))) return t.dayActive;
  const today = toUtcDate(now);
  if (date === today) return t.dayToday;
  return date > today ? t.dayFuture : t.dayPast;
}

/** One UTC day of matches for a provider, all competitions it serves. */
export async function dayMatches(ctx: AppContext, source: Source, date: string, meta: MetaCollector, options: { cacheOnly?: boolean } = {}): Promise<Match[]> {
  const provider = providerFor(ctx, source);
  try {
    const res = await ctx.cache.get(`${cachePrefix(source)}:day:${date}`, () => provider.matchesOnDate(date), {
      ttl: (v) => dayTtl(source, date, v, ctx.now()),
      ...(options.cacheOnly ? { cacheOnly: true } : {}),
    });
    if (source === 'football-data' && ctx.env.footballDataPlan === 'free') meta.delayed = true;
    return meta.add(res, source);
  } catch (e) {
    if (e instanceof CacheMissError) return [];
    ctx.logger.warn('matches.day_failed', { source, date, error: errorMessage(e) });
    meta.fail(e, isAppError(e) && e.code === 'UPSTREAM_RATE_LIMITED' ? 'Some matches are missing while the data provider cools down.' : 'Some matches could not be loaded.');
    return [];
  }
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
    if (!(source === 'football-data' ? ctx.fd : ctx.af)) continue;
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
  const wantedIds = new Set(wanted.map((a) => a.config.id));
  const sources = [...new Set(wanted.map((a) => a.source))];

  const { startMs, endMs } = localDayWindow(q.date, q.tz);
  const dates = utcDatesCovering(startMs, endMs);

  const all: Match[] = [];
  for (const source of sources) for (const d of dates) all.push(...(await dayMatches(ctx, source, d, meta)));

  const index = await featuredIndex(ctx, active);
  const matches = dedupe(all)
    .filter((m) => wantedIds.has(m.competitionId))
    .filter((m) => {
      const k = Date.parse(m.utcDate);
      return k >= startMs && k < endMs;
    })
    .map((m) => annotateMatch(m, index));

  return { matches: sortByCompetitionThenKickoff(matches, active), active, index };
}

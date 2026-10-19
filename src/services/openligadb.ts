import { OL_TTL } from '../config/ttl.js';
import { NotFoundError } from '../lib/errors.js';
import { errorMessage } from '../lib/logger.js';
import type { OlMatch, OlSeason } from '../providers/openligadb/raw.js';
import type { AppContext } from './context.js';

const HOUR = 3_600_000;

const inPlayWindow = (m: OlMatch, now: number) => {
  const k = Date.parse(m.matchDateTimeUTC);
  return !m.matchIsFinished && k > now - 3 * HOUR && k < now + HOUR;
};

/** Matchdays worth refetching on their own: an unfinished match from the last 12 hours or the next hour. */
export function liveMatchdays(season: OlSeason, now: number): number[] {
  const out = new Set<number>();
  for (const m of season.matches) {
    const k = Date.parse(m.matchDateTimeUTC);
    const day = m.group?.groupOrderID;
    if (day != null && !m.matchIsFinished && k > now - 12 * HOUR && k < now + HOUR) out.add(day);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * A league's season as the provider sees it: the season file (cached for hours)
 * with any matchday being played refetched on its own (cached for a minute while
 * a match is on) and laid over it. A matchday that fails keeps the season's version.
 */
export async function olSeason(ctx: AppContext, shortcut: string): Promise<OlSeason> {
  const ol = ctx.ol;
  if (!ol) throw new NotFoundError('OpenLigaDB is turned off.');
  const base = (await ctx.cache.get(`ol:season:${shortcut}`, () => ol.fetchSeason(shortcut), { ttl: OL_TTL.season })).data;
  const days = liveMatchdays(base, ctx.now());
  if (days.length === 0) return base;

  const fresh = new Map<number, OlMatch>();
  for (const day of days) {
    try {
      const res = await ctx.cache.get(`ol:md:${shortcut}:${base.season}:${day}`, () => ol.fetchMatchday(shortcut, base.season, day), {
        ttl: (v) => (v.some((m) => inPlayWindow(m, ctx.now())) ? OL_TTL.matchdayActive : OL_TTL.matchday),
      });
      for (const m of res.data) fresh.set(m.matchID, m);
    } catch (e) {
      ctx.logger.warn('openligadb.matchday_failed', { shortcut, day, error: errorMessage(e) });
    }
  }
  return { ...base, matches: base.matches.map((m) => fresh.get(m.matchID) ?? m) };
}

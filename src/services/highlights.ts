import { TTL } from '../config/ttl.js';
import { competitionById } from '../config/competitions.js';
import type { PinSet } from '../domain/highlight.js';
import { rankMatches } from '../domain/highlight.js';
import { addDays, localDate, localDayWindow, toUtcDate, utcDatesCovering } from '../domain/time.js';
import type { Match } from '../domain/types.js';
import { errorMessage } from '../lib/logger.js';
import { activeCompetitions } from './availability.js';
import type { AppContext } from './context.js';
import { annotateMatch, featuredIndex } from './featured.js';
import type { CoverOptions } from './matches.js';
import { coveredDays, overlayLive } from './matches.js';
import type { MetaCollector } from './meta.js';

export interface HighlightsQuery {
  tz: string;
  days: number;
  limit: number;
  pins?: PinSet;
}

/** Score above which a match counts as "big": anything beyond the +10 every match gets on its day. */
const MIN_SCORE = 10;

/**
 * Ranked big matches from today through `days` ahead. football-data serves this
 * from one ranged call (≤10 days, cached 15 min) with today's live day list on
 * top; API-Football contributes only day lists that are already cached plus
 * today and tomorrow, to protect its daily cap. OpenLigaDB days are cut from its
 * cached seasons. When the ranged call fails, football-data's cached days are
 * used and backups fill the days that aren't cached.
 */
export async function highlights(ctx: AppContext, q: HighlightsQuery, meta: MetaCollector): Promise<Match[]> {
  const now = ctx.now();
  const today = localDate(now, q.tz);
  const todayWindow = localDayWindow(today, q.tz);
  const last = addDays(today, q.days);
  const end = localDayWindow(last, q.tz).endMs;
  const active = await activeCompetitions(ctx, meta);
  const dates = utcDatesCovering(todayWindow.startMs, end);
  const tomorrow = addDays(toUtcDate(now), 1);

  let preloaded: CoverOptions['preloaded'];
  let rangeError: unknown = null;
  if (ctx.fd && active.some((a) => a.source === 'football-data')) {
    const fd = ctx.fd;
    const range = { from: dates[0] ?? toUtcDate(now), to: dates.at(-1) ?? toUtcDate(now) };
    try {
      const res = await ctx.cache.get(`fd:range:${range.from}:${range.to}`, () => fd.matchesInRange(range), { ttl: TTL.range });
      if (ctx.env.footballDataPlan === 'free') meta.delayed = true;
      preloaded = { source: 'football-data', matches: meta.add(res, 'football-data') };
    } catch (e) {
      ctx.logger.warn('highlights.range_failed', { error: errorMessage(e) });
      rangeError = e;
    }
  }

  const all = await coveredDays(ctx, active, dates, meta, {
    ...(preloaded ? { preloaded } : {}),
    cacheOnly: (source, date) => source === 'football-data' || (source === 'api-football' && date > tomorrow),
    missCountsAs: (source) => (source === 'football-data' ? rangeError : null),
  });

  const index = await featuredIndex(ctx, active);
  const candidates = (await overlayLive(ctx, all, meta))
    .filter((m) => {
      const k = Date.parse(m.utcDate);
      if (k >= end) return false;
      if (m.status === 'cancelled' || m.status === 'postponed') return false;
      // Finished matches stay only on their own day; upcoming ones from today onward.
      return k >= todayWindow.startMs || m.status === 'live' || m.status === 'paused';
    })
    .map((m) => annotateMatch(m, index));

  return rankMatches(
    candidates,
    {
      todayStartMs: todayWindow.startMs,
      todayEndMs: todayWindow.endMs,
      ...(q.pins ? { pins: q.pins } : {}),
      competitionBonus: (id) => competitionById(id)?.highlightBonus,
    },
    { limit: q.limit, minScore: MIN_SCORE },
  );
}

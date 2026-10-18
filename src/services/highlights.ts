import { TTL } from '../config/ttl.js';
import { competitionById } from '../config/competitions.js';
import type { PinSet } from '../domain/highlight.js';
import { rankMatches } from '../domain/highlight.js';
import { addDays, localDate, localDayWindow } from '../domain/time.js';
import type { Match } from '../domain/types.js';
import { errorMessage } from '../lib/logger.js';
import { activeCompetitions } from './availability.js';
import type { AppContext } from './context.js';
import { annotateMatch, featuredIndex } from './featured.js';
import { dayMatches, dedupe, overlayLive } from './matches.js';
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
 * today and tomorrow, to protect its daily cap.
 */
export async function highlights(ctx: AppContext, q: HighlightsQuery, meta: MetaCollector): Promise<Match[]> {
  const now = ctx.now();
  const today = localDate(now, q.tz);
  const todayWindow = localDayWindow(today, q.tz);
  const last = addDays(today, q.days);
  const end = localDayWindow(last, q.tz).endMs;
  const active = await activeCompetitions(ctx, meta);
  const sources = new Set(active.map((a) => a.source));
  const all: Match[] = [];

  if (ctx.fd && sources.has('football-data')) {
    const fd = ctx.fd;
    const range = { from: new Date(todayWindow.startMs).toISOString().slice(0, 10), to: new Date(end - 1).toISOString().slice(0, 10) };
    try {
      const res = await ctx.cache.get(`fd:range:${range.from}:${range.to}`, () => fd.matchesInRange(range), { ttl: TTL.range });
      if (ctx.env.footballDataPlan === 'free') meta.delayed = true;
      all.push(...meta.add(res, 'football-data'));
    } catch (e) {
      ctx.logger.warn('highlights.range_failed', { error: errorMessage(e) });
      for (let i = 0; i <= q.days; i++) all.push(...(await dayMatches(ctx, 'football-data', addDays(range.from, i), meta, { cacheOnly: true })));
    }
  }

  if (ctx.af && sources.has('api-football')) {
    for (let i = 0; i <= q.days + 1; i++) {
      const date = addDays(new Date(todayWindow.startMs).toISOString().slice(0, 10), i);
      all.push(...(await dayMatches(ctx, 'api-football', date, meta, i <= 1 ? {} : { cacheOnly: true })));
    }
  }

  const activeIds = new Set(active.map((a) => a.config.id));
  const index = await featuredIndex(ctx, active);
  const candidates = (await overlayLive(ctx, dedupe(all), meta))
    .filter((m) => activeIds.has(m.competitionId))
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

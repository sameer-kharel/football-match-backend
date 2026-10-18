import { localDayWindow, localDate, addDays } from '../domain/time.js';
import type { Match, Source } from '../domain/types.js';
import { errorMessage } from '../lib/logger.js';
import { parseSourcedId } from '../providers/types.js';
import { activeCompetitions, cachePrefix, providerFor } from './availability.js';
import { seasonMatches } from './competitions.js';
import type { AppContext } from './context.js';
import { annotateMatch, featuredIndex } from './featured.js';
import { matchTtl } from './match-detail.js';
import { dedupe, overlayLive } from './matches.js';
import type { MetaCollector } from './meta.js';
import { teamWindowMatches } from './teams.js';

export interface PinnedQuery {
  teams: string[];
  matches: string[];
  competitions: string[];
  tz: string;
}

export interface PinnedResult {
  matches: Match[];
  missing: { teams: string[]; competitions: string[]; matches: string[] };
}

/** Pinned match summaries are cached per id; misses are fetched in one batched call per provider. */
async function pinnedMatchSummaries(ctx: AppContext, ids: string[], meta: MetaCollector, missing: string[]): Promise<Match[]> {
  const out: Match[] = [];
  const toFetch = new Map<Source, string[]>();
  for (const id of ids) {
    const parsed = parseSourcedId(id);
    if (!parsed) continue;
    const prefix = cachePrefix(parsed.source);
    const hit = await ctx.cache.peek<Match>(`${prefix}:msum:${id}`);
    if (hit && ctx.now() - hit.t < hit.s * 1000) {
      out.push(hit.v);
      meta.add({ data: hit.v, stale: false, fetchedAt: hit.t }, parsed.source);
    } else {
      toFetch.set(parsed.source, [...(toFetch.get(parsed.source) ?? []), id]);
    }
  }
  for (const [source, sourceIds] of toFetch) {
    try {
      const fetched = await providerFor(ctx, source).matchesByIds(sourceIds);
      for (const m of fetched) {
        await ctx.cache.put(`${cachePrefix(source)}:msum:${m.id}`, m, matchTtl(m, ctx.now(), source));
        out.push(m);
      }
      meta.add({ data: null, stale: false, fetchedAt: ctx.now() }, source);
    } catch (e) {
      // Fall back to whatever stale summaries exist.
      for (const id of sourceIds) {
        const stale = await ctx.cache.peek<Match>(`${cachePrefix(source)}:msum:${id}`);
        if (stale) {
          out.push(stale.v);
          meta.add({ data: stale.v, stale: true, fetchedAt: stale.t }, source);
        } else missing.push(id);
      }
      ctx.logger.warn('pinned.matches_failed', { source, error: errorMessage(e) });
    }
  }
  return out;
}

/**
 * Everything a user pinned, in one call: upcoming and recent matches of pinned
 * teams (−7…+30 days), pinned competitions' fixtures (−3…+14 days) and pinned
 * matches. Parts that can't be loaded are listed in `missing` instead of failing.
 */
export async function pinnedContent(ctx: AppContext, q: PinnedQuery, meta: MetaCollector): Promise<PinnedResult> {
  const now = ctx.now();
  const today = localDate(now, q.tz);
  const teamWindow = { start: localDayWindow(addDays(today, -7), q.tz).startMs, end: localDayWindow(addDays(today, 30), q.tz).endMs };
  const compWindow = { start: localDayWindow(addDays(today, -3), q.tz).startMs, end: localDayWindow(addDays(today, 14), q.tz).endMs };
  const inWindow = (m: Match, w: { start: number; end: number }) => {
    const k = Date.parse(m.utcDate);
    return k >= w.start && k < w.end;
  };

  const missing: PinnedResult['missing'] = { teams: [], competitions: [], matches: [] };
  const collected: Match[] = [];

  for (const teamId of q.teams) {
    try {
      collected.push(...(await teamWindowMatches(ctx, teamId, meta)).filter((m) => inWindow(m, teamWindow)));
    } catch (e) {
      missing.teams.push(teamId);
      meta.fail(e, 'Some pinned teams could not be refreshed.');
    }
  }

  const active = await activeCompetitions(ctx, meta);
  for (const compId of q.competitions) {
    const comp = active.find((a) => a.config.id === compId);
    if (!comp) {
      missing.competitions.push(compId);
      continue;
    }
    try {
      collected.push(...(await seasonMatches(ctx, comp, meta)).filter((m) => inWindow(m, compWindow)));
    } catch (e) {
      missing.competitions.push(compId);
      meta.fail(e, 'Some pinned competitions could not be refreshed.');
    }
  }

  if (q.matches.length > 0) collected.push(...(await pinnedMatchSummaries(ctx, q.matches, meta, missing.matches)));
  if (missing.matches.length > 0) meta.missing('Some pinned matches could not be refreshed.');

  const index = await featuredIndex(ctx, active);
  const merged = (await overlayLive(ctx, dedupe(collected), meta)).map((m) => annotateMatch(m, index));
  return { matches: merged.sort((a, b) => a.utcDate.localeCompare(b.utcDate) || a.id.localeCompare(b.id)), missing };
}

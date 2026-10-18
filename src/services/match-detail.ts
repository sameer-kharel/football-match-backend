import { AF_TTL, TTL } from '../config/ttl.js';
import type { Match, MatchDetail } from '../domain/types.js';
import { NotFoundError } from '../lib/errors.js';
import { errorMessage } from '../lib/logger.js';
import { parseSourcedId } from '../providers/types.js';
import { activeCompetitions, cachePrefix, providerFor } from './availability.js';
import { positionsFor } from './competitions.js';
import type { AppContext } from './context.js';
import { annotateMatch, featuredIndex } from './featured.js';
import type { MetaCollector } from './meta.js';

/** Cache lifetime for a single match, by how likely it is to change soon. */
export function matchTtl(m: Match, now: number, source: Match['source']): number {
  if (source === 'api-football') return m.status === 'finished' ? AF_TTL.matchFinished : AF_TTL.match;
  if (m.status === 'live' || m.status === 'paused') return TTL.matchLive;
  if (m.status === 'finished' || m.status === 'awarded' || m.status === 'cancelled') return TTL.matchFinished;
  const untilKickoff = Date.parse(m.utcDate) - now;
  if (untilKickoff < 3 * 3_600_000) return TTL.matchSoon;
  return TTL.matchUpcoming;
}

export async function matchDetail(ctx: AppContext, id: string, meta: MetaCollector): Promise<MatchDetail> {
  const parsed = parseSourcedId(id);
  if (!parsed) throw new NotFoundError();
  const provider = providerFor(ctx, parsed.source);
  const prefix = cachePrefix(parsed.source);

  const res = await ctx.cache.get(`${prefix}:match:${id}`, () => provider.matchDetail(id), {
    ttl: (m) => matchTtl(m, ctx.now(), parsed.source),
    notFoundTtl: TTL.notFound,
  });
  const detail = meta.add(res, parsed.source);
  if (parsed.source === 'football-data' && ctx.env.footballDataPlan === 'free') meta.delayed = true;

  let headToHead = detail.headToHead;
  try {
    const h2h = await ctx.cache.get(`${prefix}:h2h:${id}`, () => provider.headToHead(id, detail), {
      ttl: parsed.source === 'football-data' ? TTL.headToHead : AF_TTL.headToHead,
      notFoundTtl: 86_400,
    });
    headToHead = h2h.data;
  } catch (e) {
    ctx.logger.warn('match.h2h_failed', { id, error: errorMessage(e) });
  }

  const positions = detail.positions ?? (await positionsFor(ctx, detail, meta));
  const index = await featuredIndex(ctx, await activeCompetitions(ctx));

  return {
    ...annotateMatch(detail, index),
    headToHead: headToHead ? { ...headToHead, recent: headToHead.recent.map((m) => annotateMatch(m, index)) } : null,
    positions,
  };
}

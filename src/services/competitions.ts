import { AF_TTL, TTL } from '../config/ttl.js';
import type { Competition, Match, MatchStatus, Scorer, Standings } from '../domain/types.js';
import { computeGroupStandings } from '../domain/standings.js';
import { NotFoundError, PlanRestrictedError } from '../lib/errors.js';
import { errorMessage } from '../lib/logger.js';
import type { ActiveCompetition } from './availability.js';
import { activeCompetition, activeCompetitions, cachePrefix, providerFor } from './availability.js';
import type { AppContext } from './context.js';
import { annotateMatch, annotateTeam, featuredIndex } from './featured.js';
import { isActive, overlayLive } from './matches.js';
import type { MetaCollector } from './meta.js';

export function toCompetition(a: ActiveCompetition): Competition {
  const c = a.config;
  return {
    id: c.id,
    name: c.name,
    shortName: c.shortName,
    category: c.category,
    format: c.format,
    region: c.region,
    emblem: a.emblem,
    priority: c.priority,
    hasStandings: c.hasStandings,
    hasScorers: c.hasScorers,
    hasBracket: c.hasBracket,
    zones: c.zones,
    season: a.season,
    source: a.source,
  };
}

export async function listCompetitions(ctx: AppContext, meta: MetaCollector): Promise<Competition[]> {
  const active = await activeCompetitions(ctx, meta);
  if (active.length > 0) meta.add({ data: null, stale: false, fetchedAt: ctx.now() });
  return active.map(toCompetition);
}

/** The whole current season for a competition (also feeds tournament brackets). */
export async function seasonMatches(ctx: AppContext, comp: ActiveCompetition, meta: MetaCollector): Promise<Match[]> {
  const provider = providerFor(ctx, comp.source);
  const ttl = comp.source === 'football-data' ? TTL.competitionMatches : AF_TTL.dayFuture;
  const res = await ctx.cache.get(`${cachePrefix(comp.source)}:comp:${comp.config.id}:matches`, () => provider.competitionMatches(comp.config), { ttl });
  return overlayLive(ctx, meta.add(res, comp.source), meta);
}

export interface CompetitionMatchesQuery {
  from?: string;
  to?: string;
  status?: MatchStatus[];
}

export async function competitionMatches(ctx: AppContext, id: string, q: CompetitionMatchesQuery, meta: MetaCollector): Promise<Match[]> {
  const comp = await activeCompetition(ctx, id, meta);
  const active = await activeCompetitions(ctx);
  const index = await featuredIndex(ctx, active);
  const start = q.from ? `${q.from}T00:00:00.000Z` : null;
  const end = q.to ? `${q.to}T23:59:59.999Z` : null;
  const statuses = q.status?.length ? new Set(q.status) : null;
  return (await seasonMatches(ctx, comp, meta))
    .filter((m) => (!start || m.utcDate >= start) && (!end || m.utcDate <= end))
    .filter((m) => !statuses || statuses.has(m.status) || (statuses.has('live') && m.status === 'paused'))
    .map((m) => annotateMatch(m, index));
}

export async function competitionStandings(ctx: AppContext, id: string, meta: MetaCollector): Promise<Standings> {
  const comp = await activeCompetition(ctx, id, meta);
  if (!comp.config.hasStandings) return { competitionId: id, season: comp.season?.label ?? null, groups: [], zones: [] };
  const provider = providerFor(ctx, comp.source);

  let ttl: number = comp.source === 'football-data' ? TTL.standings : AF_TTL.standings;
  if (comp.source === 'football-data') {
    // Shorter while one of the competition's matches is in play.
    const today = await ctx.cache.peek<Match[]>(`fd:day:${new Date(ctx.now()).toISOString().slice(0, 10)}`);
    if (today?.v.some((m) => m.competitionId === id && isActive(m, ctx.now()))) ttl = TTL.standingsActive;
  }

  let standings: Standings;
  try {
    const res = await ctx.cache.get(`${cachePrefix(comp.source)}:comp:${id}:standings`, () => provider.standings(comp.config), { ttl, notFoundTtl: TTL.notFound });
    standings = meta.add(res, comp.source);
  } catch (e) {
    // The provider has no table for this competition (football-data answers 404
    // for tournaments like the World Cup): build group tables from the results.
    if (!(e instanceof NotFoundError || e instanceof PlanRestrictedError)) throw e;
    const groups = comp.config.format === 'league' ? [] : computeGroupStandings(await seasonMatches(ctx, comp, meta), comp.config.zones);
    standings = { competitionId: id, season: comp.season?.label ?? null, groups, zones: comp.config.zones };
    if (groups.length > 0) meta.warn('Group tables are calculated from results and may differ from the official tiebreakers.');
  }
  const index = await featuredIndex(ctx, await activeCompetitions(ctx));
  return {
    ...standings,
    groups: standings.groups.map((g) => ({ ...g, rows: g.rows.map((r) => ({ ...r, team: annotateTeam(r.team, index) })) })),
  };
}

export async function competitionScorers(ctx: AppContext, id: string, limit: number, meta: MetaCollector): Promise<Scorer[]> {
  const comp = await activeCompetition(ctx, id, meta);
  if (!comp.config.hasScorers) return [];
  const provider = providerFor(ctx, comp.source);
  const ttl = comp.source === 'football-data' ? TTL.scorers : AF_TTL.scorers;
  // Always cache the provider maximum we use (30) and slice, so every `limit` shares one entry.
  try {
    const res = await ctx.cache.get(`${cachePrefix(comp.source)}:comp:${id}:scorers`, () => provider.scorers(comp.config, 30), { ttl, notFoundTtl: TTL.notFound });
    return meta.add(res, comp.source).slice(0, limit);
  } catch (e) {
    // No scorers list for this competition: an empty list, not an error.
    if (e instanceof NotFoundError || e instanceof PlanRestrictedError) return [];
    throw e;
  }
}

/** League positions for the match header; never fails the request. */
export async function positionsFor(ctx: AppContext, match: Match, meta: MetaCollector): Promise<{ home: number | null; away: number | null } | null> {
  try {
    const comp = await activeCompetition(ctx, match.competitionId);
    if (!comp.config.hasStandings || comp.config.format !== 'league') return null;
    const standings = await competitionStandings(ctx, match.competitionId, meta);
    const rows = standings.groups.flatMap((g) => g.rows);
    const pos = (teamId: string) => rows.find((r) => r.team.id === teamId)?.position ?? null;
    const home = pos(match.homeTeam.id);
    const away = pos(match.awayTeam.id);
    return home === null && away === null ? null : { home, away };
  } catch (e) {
    ctx.logger.warn('competitions.positions_failed', { match: match.id, error: errorMessage(e) });
    return null;
  }
}

import type { FeaturedTeam } from '../config/featured.js';
import { ALL_FEATURED } from '../config/featured.js';
import { RIVALRIES } from '../config/rivalries.js';
import { TTL } from '../config/ttl.js';
import { normalizeTeamName } from '../domain/names.js';
import type { Match, TeamRef } from '../domain/types.js';
import { errorMessage } from '../lib/logger.js';
import type { ActiveCompetition } from './availability.js';
import { cachePrefix, providerFor } from './availability.js';
import type { AppContext } from './context.js';

export interface FeaturedIndex {
  /** provider team id → featured key */
  byId: Record<string, string>;
  /** competitions whose team lists have been matched */
  resolved: string[];
  complete: boolean;
}

const BY_KEY = new Map(ALL_FEATURED.map((f) => [f.key, f]));

/** normalized alias → featured team, split by kind so "Brazil" never matches a club. */
const BY_NAME: Record<FeaturedTeam['kind'], Map<string, FeaturedTeam>> = { club: new Map(), national: new Map() };
for (const f of ALL_FEATURED) {
  for (const alias of [f.name, ...f.aliases]) BY_NAME[f.kind].set(normalizeTeamName(alias), f);
}

const RIVALRY_BY_PAIR = new Map(RIVALRIES.map((r) => [[...r.teams].sort().join('|'), r.name]));

export function featuredByName(team: Pick<TeamRef, 'name' | 'shortName' | 'national'>): FeaturedTeam | undefined {
  const map = BY_NAME[team.national ? 'national' : 'club'];
  return map.get(normalizeTeamName(team.name)) ?? map.get(normalizeTeamName(team.shortName));
}

export function matchFeaturedTeams(teams: readonly TeamRef[], kind: FeaturedTeam['kind']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of teams) {
    const f = BY_NAME[kind].get(normalizeTeamName(t.name)) ?? BY_NAME[kind].get(normalizeTeamName(t.shortName));
    if (f) out[t.id] = f.key;
  }
  return out;
}

/** Max competitions whose team lists we fetch while serving one request; the cron warms the rest. */
const RESOLVE_PER_REQUEST = 2;

/**
 * Resolves featured team ids by fetching each relevant competition's team list
 * and matching names. The result is cached for a week; while incomplete, each
 * request resolves a couple more competitions. Name matching covers the gap.
 */
export async function featuredIndex(ctx: AppContext, active: readonly ActiveCompetition[], budget = RESOLVE_PER_REQUEST): Promise<FeaturedIndex> {
  const key = 'featured:index:v1';
  const existing = await ctx.cache.peek<FeaturedIndex>(key);
  const fresh = existing && ctx.now() - existing.t < existing.s * 1000;
  if (existing && fresh && existing.v.complete) return existing.v;

  // A stale index keeps its ids for annotation but resolves every competition again
  // (promoted clubs, new national-team ids), a couple per request.
  const index: FeaturedIndex = existing
    ? { byId: { ...existing.v.byId }, resolved: fresh ? [...existing.v.resolved] : [], complete: false }
    : { byId: {}, resolved: [], complete: false };
  const wanted = new Set(ALL_FEATURED.flatMap((f) => f.resolveIn));
  const todo = active.filter((a) => wanted.has(a.config.id) && !index.resolved.includes(a.config.id));

  let attempts = 0;
  for (const comp of todo) {
    if (attempts >= budget) break;
    attempts++;
    try {
      const teams = await competitionTeams(ctx, comp);
      Object.assign(index.byId, matchFeaturedTeams(teams, comp.config.category === 'international' ? 'national' : 'club'));
      index.resolved.push(comp.config.id);
    } catch (e) {
      ctx.logger.warn('featured.resolve_failed', { competition: comp.config.id, error: errorMessage(e) });
      break;
    }
  }
  index.complete = todo.every((c) => index.resolved.includes(c.config.id));
  if (attempts > 0 || !existing) await ctx.cache.put(key, index, index.complete ? TTL.featuredMap : 600);
  return index;
}

export async function competitionTeams(ctx: AppContext, comp: ActiveCompetition): Promise<TeamRef[]> {
  const provider = providerFor(ctx, comp.source);
  const res = await ctx.cache.get(`${cachePrefix(comp.source)}:teams:${comp.config.id}`, () => provider.competitionTeams(comp.config), {
    ttl: TTL.competitionTeams,
  });
  return res.data;
}

export function annotateTeam(team: TeamRef, index: FeaturedIndex | null): TeamRef {
  const key = index?.byId[team.id];
  const f = (key ? BY_KEY.get(key) : undefined) ?? featuredByName(team);
  if (!f) return team;
  return { ...team, featuredTier: f.tier, color: f.color };
}

function featuredKey(team: TeamRef, index: FeaturedIndex | null): string | undefined {
  return index?.byId[team.id] ?? featuredByName(team)?.key;
}

export function rivalryFor(home: TeamRef, away: TeamRef, index: FeaturedIndex | null): string | null {
  const a = featuredKey(home, index);
  const b = featuredKey(away, index);
  if (!a || !b) return null;
  return RIVALRY_BY_PAIR.get([a, b].sort().join('|')) ?? null;
}

export function annotateMatch<M extends Match>(match: M, index: FeaturedIndex | null): M {
  return {
    ...match,
    homeTeam: annotateTeam(match.homeTeam, index),
    awayTeam: annotateTeam(match.awayTeam, index),
    rivalry: rivalryFor(match.homeTeam, match.awayTeam, index),
  };
}

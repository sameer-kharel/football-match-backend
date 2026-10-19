import { AF_TTL, TTL } from '../config/ttl.js';
import { addDays, toUtcDate } from '../domain/time.js';
import type { Match, TeamIndexEntry, TeamProfile } from '../domain/types.js';
import { normalizeTeamName } from '../domain/names.js';
import { NotFoundError } from '../lib/errors.js';
import { errorMessage } from '../lib/logger.js';
import { parseSourcedId } from '../providers/types.js';
import { activeCompetitions, cachePrefix, providerFor } from './availability.js';
import type { AppContext } from './context.js';
import { annotateMatch, annotateTeam, competitionTeams, featuredIndex } from './featured.js';
import { overlayLive } from './matches.js';
import type { MetaCollector } from './meta.js';

/** Team fixtures are cached as one wide window (−60…+60 days) shared by the team page and pins. */
export async function teamWindowMatches(ctx: AppContext, teamId: string, meta: MetaCollector): Promise<Match[]> {
  const parsed = parseSourcedId(teamId);
  if (!parsed) throw new NotFoundError();
  const provider = providerFor(ctx, parsed.source);
  const today = toUtcDate(ctx.now());
  const range = { from: addDays(today, -60), to: addDays(today, 60) };
  const res = await ctx.cache.get(`${cachePrefix(parsed.source)}:team:${teamId}:matches`, () => provider.teamMatches(teamId, range), {
    ttl: parsed.source === 'api-football' ? AF_TTL.teamMatches : TTL.teamMatches,
    notFoundTtl: TTL.notFound,
  });
  return overlayLive(ctx, meta.add(res, parsed.source), meta);
}

export async function teamProfile(ctx: AppContext, teamId: string, meta: MetaCollector): Promise<TeamProfile> {
  const parsed = parseSourcedId(teamId);
  if (!parsed) throw new NotFoundError();
  const provider = providerFor(ctx, parsed.source);

  const baseRes = await ctx.cache.get(`${cachePrefix(parsed.source)}:team:${teamId}`, () => provider.team(teamId), {
    ttl: parsed.source === 'api-football' ? AF_TTL.team : TTL.team,
    notFoundTtl: TTL.notFound,
  });
  const base = meta.add(baseRes, parsed.source);

  let matches: Match[] = [];
  try {
    matches = await teamWindowMatches(ctx, teamId, meta);
  } catch (e) {
    ctx.logger.warn('teams.matches_failed', { teamId, error: errorMessage(e) });
    meta.missing("This team's fixtures couldn't be loaded right now.");
  }

  const index = await featuredIndex(ctx, await activeCompetitions(ctx));
  const now = ctx.now();
  const annotated = matches.map((m) => annotateMatch(m, index));
  const done = (m: Match) => m.status === 'finished' || m.status === 'awarded';
  const recent = annotated.filter(done).sort((a, b) => b.utcDate.localeCompare(a.utcDate)).slice(0, 6);
  const next = annotated
    .filter((m) => !done(m) && m.status !== 'cancelled' && Date.parse(m.utcDate) > now - 3 * 3_600_000)
    .sort((a, b) => a.utcDate.localeCompare(b.utcDate))
    .slice(0, 6);

  return { ...base, team: annotateTeam(base.team, index), nextMatches: next, recentMatches: recent };
}

/**
 * Every team in the active competitions, for in-app search and pinning. Each
 * competition's list is cached for a day; on a cold cache we fill what the
 * request budget allows and mark the response partial.
 */
export async function teamsIndex(ctx: AppContext, meta: MetaCollector): Promise<TeamIndexEntry[]> {
  const active = await activeCompetitions(ctx, meta);
  const index = await featuredIndex(ctx, active);
  const byId = new Map<string, TeamIndexEntry>();
  // One club from two providers (Bayern in football-data's Bundesliga and OpenLigaDB's
  // DFB-Pokal) is listed once, under the first one. Within one provider, ids decide.
  const byName = new Map<string, TeamIndexEntry>();
  for (const comp of active) {
    try {
      for (const team of await competitionTeams(ctx, comp)) {
        const nameKey = `${team.national ? 'n' : 'c'}|${normalizeTeamName(team.name)}`;
        const twin = byName.get(nameKey);
        const crossSource = twin && parseSourcedId(twin.team.id)?.source !== parseSourcedId(team.id)?.source ? twin : undefined;
        const entry = byId.get(team.id) ?? crossSource ?? { team: annotateTeam(team, index), competitionIds: [] };
        if (!entry.competitionIds.includes(comp.config.id)) entry.competitionIds.push(comp.config.id);
        byId.set(entry.team.id, entry);
        if (!twin) byName.set(nameKey, entry);
      }
      meta.add({ data: null, stale: false, fetchedAt: ctx.now() }, comp.source);
    } catch (e) {
      meta.fail(e, 'Some teams are missing from search for now.');
    }
  }
  return [...byId.values()].sort((a, b) => a.team.name.localeCompare(b.team.name));
}

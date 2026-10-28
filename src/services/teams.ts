import { AF_TTL, TTL } from '../config/ttl.js';
import { addDays, toUtcDate } from '../domain/time.js';
import type { Match, TeamIndexEntry, TeamProfile, TeamRef } from '../domain/types.js';
import { normalizeTeamName } from '../domain/names.js';
import { NotFoundError } from '../lib/errors.js';
import { errorMessage } from '../lib/logger.js';
import { parseSourcedId } from '../providers/types.js';
import type { ActiveCompetition } from './availability.js';
import { activeCompetitions, cachePrefix, providerFor } from './availability.js';
import type { AppContext } from './context.js';
import { annotateMatch, annotateTeam, competitionTeams, featuredIndex, teamsKey } from './featured.js';
import { dedupe, overlayLive } from './matches.js';
import type { MetaCollector } from './meta.js';

/** One provider's fixtures for a team, cached as one wide window (−60…+60 days). */
async function sourceWindowMatches(ctx: AppContext, teamId: string, meta: MetaCollector): Promise<Match[]> {
  const parsed = parseSourcedId(teamId);
  if (!parsed) throw new NotFoundError();
  const provider = providerFor(ctx, parsed.source);
  const today = toUtcDate(ctx.now());
  const range = { from: addDays(today, -60), to: addDays(today, 60) };
  const res = await ctx.cache.get(`${cachePrefix(parsed.source)}:team:${teamId}:matches`, () => provider.teamMatches(teamId, range), {
    ttl: parsed.source === 'api-football' ? AF_TTL.teamMatches : TTL.teamMatches,
    notFoundTtl: TTL.notFound,
  });
  return meta.add(res, parsed.source);
}

/**
 * The same club under other providers' ids (Bayern is fd-5 at football-data and
 * ol-40 at OpenLigaDB), matched by name in those providers' team lists. Only
 * lists that cost nothing are read: OpenLigaDB's come from its cached seasons,
 * anyone else's only if already cached.
 */
async function twinTeamIds(ctx: AppContext, teamId: string, own: readonly Match[], active: readonly ActiveCompetition[]): Promise<string[]> {
  const source = parseSourcedId(teamId)?.source;
  const team = own.flatMap((m) => [m.homeTeam, m.awayTeam]).find((t) => t.id === teamId);
  const name = team ? normalizeTeamName(team.name) : '';
  if (!team || !name) return [];
  const twins = new Set<string>();
  for (const comp of active) {
    if (comp.source === source) continue;
    let teams: TeamRef[] = [];
    try {
      teams = comp.source === 'openligadb' ? await competitionTeams(ctx, comp) : ((await ctx.cache.peek<TeamRef[]>(teamsKey(comp)))?.v ?? []);
    } catch (e) {
      ctx.logger.warn('teams.twin_lookup_failed', { competition: comp.config.id, error: errorMessage(e) });
    }
    for (const t of teams) if (t.national === team.national && normalizeTeamName(t.name) === name) twins.add(t.id);
  }
  return [...twins];
}

/**
 * Team fixtures (−60…+60 days), shared by the team page and pins. A club another
 * provider also knows gets that provider's fixtures too, so a pinned Bayern
 * includes the DFB-Pokal. Each competition's matches come only from its own
 * source, so the Bundesliga never appears twice.
 */
export async function teamWindowMatches(ctx: AppContext, teamId: string, meta: MetaCollector): Promise<Match[]> {
  const own = await sourceWindowMatches(ctx, teamId, meta);
  const active = await activeCompetitions(ctx);
  const twins = await twinTeamIds(ctx, teamId, own, active);
  if (twins.length === 0) return overlayLive(ctx, own, meta);

  const sourceOf = new Map(active.map((a) => [a.config.id, a.source]));
  const fromItsSource = (m: Match) => sourceOf.get(m.competitionId) === m.source;
  const merged = own.filter(fromItsSource);
  for (const twin of twins) {
    try {
      merged.push(...(await sourceWindowMatches(ctx, twin, meta)).filter(fromItsSource));
    } catch (e) {
      ctx.logger.warn('teams.twin_matches_failed', { teamId, twin, error: errorMessage(e) });
    }
  }
  return overlayLive(ctx, dedupe(merged).sort((a, b) => a.utcDate.localeCompare(b.utcDate) || a.id.localeCompare(b.id)), meta);
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

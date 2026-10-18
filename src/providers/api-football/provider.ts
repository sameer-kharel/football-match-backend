import type { CompetitionConfig } from '../../config/competitions.js';
import { competitionById } from '../../config/competitions.js';
import { addDays, diffDays } from '../../domain/time.js';
import type { HeadToHead, Match, MatchDetail, Scorer, Standings, TeamRef } from '../../domain/types.js';
import type { UpstreamBudget } from '../../lib/budget.js';
import { NotConfiguredError, NotFoundError, PlanRestrictedError, UpstreamError, UpstreamRateLimitedError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import type { DateRange, FootballProvider, ProviderCompetitionMeta, TeamBase } from '../types.js';
import { parseSourcedId } from '../types.js';
import type { FetchLike } from '../upstream.js';
import { UpstreamClient } from '../upstream.js';
import type { AfNormalizeContext } from './normalize.js';
import {
  afId,
  normalizeAfFixtureDetail,
  normalizeAfFixtures,
  normalizeAfHeadToHead,
  normalizeAfScorers,
  normalizeAfStandings,
  normalizeAfTeam,
} from './normalize.js';
import type { AfEnvelope, AfFixture, AfLeagueItem, AfStandingsItem, AfTeamItem, AfTopScorer } from './raw.js';

export const API_FOOTBALL_BASE_URL = 'https://v3.football.api-sports.io/';

export interface AfLeagueInfo {
  leagueId: number;
  season: number;
  logo: string | null;
  seasonStart: string | null;
  seasonEnd: string | null;
}

/** Resolved league ids for the competitions API-Football serves, keyed by registry id. */
export type AfLeagueMapLoader = () => Promise<Map<string, AfLeagueInfo>>;

function secondsUntilUtcMidnight(now = Date.now()): number {
  return Math.max(60, Math.ceil((Math.ceil(now / 86_400_000) * 86_400_000 - now) / 1000));
}

/** API-Football quota headers: daily (x-ratelimit-requests-*) and per-minute (x-ratelimit-*). */
export function apiFootballQuotaBlock(headers: Headers): number | null {
  const daily = headers.get('x-ratelimit-requests-remaining');
  if (daily !== null && Number(daily) <= 0) return secondsUntilUtcMidnight();
  const minute = headers.get('x-ratelimit-remaining');
  if (minute !== null && Number(minute) <= 0) return 60;
  return null;
}

function rawId(id: string): string {
  const parsed = parseSourcedId(id);
  if (!parsed || parsed.source !== 'api-football') throw new NotFoundError();
  return parsed.raw;
}

export class ApiFootballProvider implements FootballProvider {
  readonly source = 'api-football' as const;
  private readonly client: UpstreamClient;

  constructor(
    private readonly options: {
      apiKey: string;
      budget: UpstreamBudget;
      logger: Logger;
      leagues: AfLeagueMapLoader;
      fetch?: FetchLike;
      baseUrl?: string;
    },
  ) {
    this.client = new UpstreamClient({
      providerName: 'API-Football',
      baseUrl: options.baseUrl ?? API_FOOTBALL_BASE_URL,
      headers: { 'x-apisports-key': options.apiKey },
      budget: options.budget,
      logger: options.logger,
      ...(options.fetch ? { fetch: options.fetch } : {}),
      inspectQuota: apiFootballQuotaBlock,
    });
  }

  /** API-Football reports most failures as HTTP 200 with a non-empty `errors` field. */
  private async get<T>(path: string, query: Record<string, string | number | undefined>): Promise<T[]> {
    const env = await this.client.getJson<AfEnvelope<T>>(path, query);
    const errors = env.errors;
    const entries: [string, string][] = Array.isArray(errors)
      ? errors.map((e, i) => [String(i), typeof e === 'string' ? e : JSON.stringify(e)])
      : Object.entries(errors ?? {});
    if (entries.length > 0) {
      const [key, message] = entries[0] ?? ['', ''];
      if (key === 'requests') {
        const wait = secondsUntilUtcMidnight();
        await this.options.budget.blockFor(wait, 'af_daily_limit');
        throw new UpstreamRateLimitedError(wait, 'API-Football');
      }
      if (key === 'rateLimit') {
        await this.options.budget.blockFor(60, 'af_minute_limit');
        throw new UpstreamRateLimitedError(60, 'API-Football');
      }
      if (key === 'plan') throw new PlanRestrictedError(message);
      if (key === 'token' || key === 'access') throw new NotConfiguredError(`API-Football rejected the key: ${message}`);
      throw new UpstreamError(`API-Football: ${message}`);
    }
    return env.response ?? [];
  }

  private async context(): Promise<{ ctx: AfNormalizeContext; leagues: Map<string, AfLeagueInfo> }> {
    const leagues = await this.options.leagues();
    const byLeague = new Map<number, CompetitionConfig>();
    for (const [compId, info] of leagues) {
      const comp = competitionById(compId);
      if (comp) byLeague.set(info.leagueId, comp);
    }
    return { ctx: { compForLeague: (id) => byLeague.get(id) }, leagues };
  }

  private async league(comp: CompetitionConfig): Promise<AfLeagueInfo> {
    const info = (await this.options.leagues()).get(comp.id);
    if (!info) throw new NotFoundError(`${comp.name} is not available from API-Football.`);
    return info;
  }

  /** Finds a league by exact name and country. Used by the league directory, results are cached for a week. */
  async lookupLeague(name: string, country: string): Promise<AfLeagueInfo | null> {
    const items = await this.get<AfLeagueItem>('leagues', { name, country });
    const item = items.find((i) => i.league?.name?.toLowerCase() === name.toLowerCase()) ?? items[0];
    if (!item?.league?.id) return null;
    const seasons = item.seasons ?? [];
    const current = seasons.find((s) => s.current) ?? [...seasons].sort((a, b) => (b.year ?? 0) - (a.year ?? 0))[0];
    if (!current?.year) return null;
    return {
      leagueId: item.league.id,
      season: current.year,
      logo: item.league.logo ?? null,
      seasonStart: current.start ?? null,
      seasonEnd: current.end ?? null,
    };
  }

  async accessibleCompetitions(): Promise<ProviderCompetitionMeta[]> {
    const leagues = await this.options.leagues();
    return [...leagues].map(([competitionId, info]) => ({
      competitionId,
      emblem: info.logo,
      season: { label: String(info.season), startDate: info.seasonStart, endDate: info.seasonEnd, currentMatchday: null },
    }));
  }

  async matchesOnDate(date: string): Promise<Match[]> {
    const { ctx } = await this.context();
    const items = await this.get<AfFixture>('fixtures', { date, timezone: 'UTC' });
    return normalizeAfFixtures(items, ctx);
  }

  async matchesInRange(range: DateRange): Promise<Match[]> {
    const out: Match[] = [];
    for (let i = 0; i <= diffDays(range.from, range.to); i++) out.push(...(await this.matchesOnDate(addDays(range.from, i))));
    return out;
  }

  async competitionMatches(comp: CompetitionConfig): Promise<Match[]> {
    const { ctx } = await this.context();
    const l = await this.league(comp);
    const items = await this.get<AfFixture>('fixtures', { league: l.leagueId, season: l.season, timezone: 'UTC' });
    return normalizeAfFixtures(items, ctx, comp);
  }

  async standings(comp: CompetitionConfig): Promise<Standings> {
    const l = await this.league(comp);
    const items = await this.get<AfStandingsItem>('standings', { league: l.leagueId, season: l.season });
    return normalizeAfStandings(items, comp);
  }

  async scorers(comp: CompetitionConfig, limit: number): Promise<Scorer[]> {
    const l = await this.league(comp);
    const items = await this.get<AfTopScorer>('players/topscorers', { league: l.leagueId, season: l.season });
    return normalizeAfScorers(items, comp).slice(0, limit);
  }

  async matchDetail(matchId: string): Promise<MatchDetail> {
    const { ctx } = await this.context();
    const [item] = await this.get<AfFixture>('fixtures', { id: rawId(matchId), timezone: 'UTC' });
    const detail = item ? normalizeAfFixtureDetail(item, ctx) : null;
    if (!detail) throw new NotFoundError();
    return detail;
  }

  async headToHead(_matchId: string, detail: MatchDetail): Promise<HeadToHead | null> {
    const { ctx } = await this.context();
    const pair = `${rawId(detail.homeTeam.id)}-${rawId(detail.awayTeam.id)}`;
    const items = await this.get<AfFixture>('fixtures/headtohead', { h2h: pair, last: 10, timezone: 'UTC' });
    return normalizeAfHeadToHead(items, ctx, detail, competitionById(detail.competitionId));
  }

  async matchesByIds(matchIds: string[]): Promise<Match[]> {
    const { ctx } = await this.context();
    const ids = matchIds.map(rawId);
    const out: Match[] = [];
    for (let i = 0; i < ids.length; i += 20) {
      const items = await this.get<AfFixture>('fixtures', { ids: ids.slice(i, i + 20).join('-'), timezone: 'UTC' });
      out.push(...normalizeAfFixtures(items, ctx));
    }
    return out;
  }

  async team(teamId: string): Promise<TeamBase> {
    const [item] = await this.get<AfTeamItem>('teams', { id: rawId(teamId) });
    if (!item?.team?.id) throw new NotFoundError();
    return normalizeAfTeam(item);
  }

  async teamMatches(teamId: string, range: DateRange): Promise<Match[]> {
    const { ctx } = await this.context();
    const id = rawId(teamId);
    const [last, next] = [
      await this.get<AfFixture>('fixtures', { team: id, last: 10, timezone: 'UTC' }),
      await this.get<AfFixture>('fixtures', { team: id, next: 10, timezone: 'UTC' }),
    ];
    const start = `${range.from}T00:00:00.000Z`;
    const end = `${addDays(range.to, 1)}T00:00:00.000Z`;
    return normalizeAfFixtures([...last, ...next], ctx).filter((m) => m.utcDate >= start && m.utcDate < end);
  }

  async competitionTeams(comp: CompetitionConfig): Promise<TeamRef[]> {
    const l = await this.league(comp);
    const items = await this.get<AfTeamItem>('teams', { league: l.leagueId, season: l.season });
    return items
      .filter((i) => i.team?.id)
      .map((i) => ({ ...normalizeAfTeam(i).team, id: afId(i.team?.id ?? 0), national: comp.category === 'international' }));
  }
}

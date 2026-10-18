import type { CompetitionConfig } from '../../config/competitions.js';
import { competitionByFootballDataCode } from '../../config/competitions.js';
import { addDays } from '../../domain/time.js';
import type { HeadToHead, Match, MatchDetail, Scorer, Standings, TeamRef } from '../../domain/types.js';
import type { UpstreamBudget } from '../../lib/budget.js';
import { NotFoundError, UpstreamError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import type { DateRange, FootballProvider, ProviderCompetitionMeta, TeamBase } from '../types.js';
import { parseSourcedId } from '../types.js';
import type { FetchLike } from '../upstream.js';
import { UpstreamClient } from '../upstream.js';
import type { FdNormalizeContext } from './normalize.js';
import {
  normalizeCompetitionList,
  normalizeHeadToHead,
  normalizeMatchDetail,
  normalizeMatchList,
  normalizeScorers,
  normalizeStandings,
  normalizeTeam,
  normalizeTeamProfile,
} from './normalize.js';
import type {
  FdCompetitionsResponse,
  FdHead2HeadResponse,
  FdMatch,
  FdMatchesResponse,
  FdScorersResponse,
  FdStandingsResponse,
  FdTeam,
  FdTeamsResponse,
} from './raw.js';

export const FOOTBALL_DATA_BASE_URL = 'https://api.football-data.org/v4/';

const UNFOLD_ALL = {
  'X-Unfold-Lineups': 'true',
  'X-Unfold-Bookings': 'true',
  'X-Unfold-Subs': 'true',
  'X-Unfold-Goals': 'true',
};

/**
 * Reads football-data's quota headers. The docs name X-RequestsAvailable and
 * X-RequestCounter-Reset; responses in the wild also carry X-Requests-Available-Minute.
 */
export function footballDataQuotaBlock(headers: Headers): number | null {
  const available = headers.get('x-requests-available-minute') ?? headers.get('x-requestsavailable');
  const reset = Number(headers.get('x-requestcounter-reset'));
  if (available !== null && Number(available) <= 0) return Number.isFinite(reset) && reset > 0 ? reset : 60;
  return null;
}

function rawId(id: string): string {
  const parsed = parseSourcedId(id);
  if (!parsed || parsed.source !== 'football-data') throw new NotFoundError();
  return parsed.raw;
}

function code(comp: CompetitionConfig): string {
  const c = comp.providers.footballData?.code;
  if (!c) throw new UpstreamError(`${comp.name} is not mapped to football-data.org.`);
  return c;
}

/** Keep only matches whose kickoff falls inside the inclusive UTC date range. */
function withinRange(matches: Match[], range: DateRange): Match[] {
  const start = `${range.from}T00:00:00.000Z`;
  const end = `${addDays(range.to, 1)}T00:00:00.000Z`;
  return matches.filter((m) => m.utcDate >= start && m.utcDate < end);
}

export class FootballDataProvider implements FootballProvider {
  readonly source = 'football-data' as const;
  private readonly client: UpstreamClient;
  private readonly ctx: FdNormalizeContext;

  constructor(options: { apiKey: string; budget: UpstreamBudget; logger: Logger; delayed: boolean; fetch?: FetchLike; baseUrl?: string }) {
    this.client = new UpstreamClient({
      providerName: 'football-data.org',
      baseUrl: options.baseUrl ?? FOOTBALL_DATA_BASE_URL,
      headers: { 'X-Auth-Token': options.apiKey },
      budget: options.budget,
      logger: options.logger,
      ...(options.fetch ? { fetch: options.fetch } : {}),
      inspectQuota: footballDataQuotaBlock,
    });
    this.ctx = { byCode: competitionByFootballDataCode, delayed: options.delayed };
  }

  async accessibleCompetitions(): Promise<ProviderCompetitionMeta[]> {
    const raw = await this.client.getJson<FdCompetitionsResponse>('competitions');
    return normalizeCompetitionList(raw, this.ctx);
  }

  async matchesOnDate(date: string): Promise<Match[]> {
    const raw = await this.client.getJson<FdMatchesResponse>('matches', { date });
    return normalizeMatchList(raw, this.ctx);
  }

  async matchesInRange(range: DateRange): Promise<Match[]> {
    // dateTo is exclusive in v4; ask for one more day and trim, which is correct either way.
    const raw = await this.client.getJson<FdMatchesResponse>('matches', { dateFrom: range.from, dateTo: addDays(range.to, 1) });
    return withinRange(normalizeMatchList(raw, this.ctx), range);
  }

  async competitionMatches(comp: CompetitionConfig): Promise<Match[]> {
    const raw = await this.client.getJson<FdMatchesResponse>(`competitions/${code(comp)}/matches`);
    return normalizeMatchList(raw, this.ctx, { fallbackComp: comp });
  }

  async standings(comp: CompetitionConfig): Promise<Standings> {
    const raw = await this.client.getJson<FdStandingsResponse>(`competitions/${code(comp)}/standings`);
    return normalizeStandings(raw, comp);
  }

  async scorers(comp: CompetitionConfig, limit: number): Promise<Scorer[]> {
    const raw = await this.client.getJson<FdScorersResponse>(`competitions/${code(comp)}/scorers`, { limit });
    return normalizeScorers(raw, comp);
  }

  async matchDetail(matchId: string): Promise<MatchDetail> {
    const raw = await this.client.getJson<FdMatch>(`matches/${rawId(matchId)}`, {}, UNFOLD_ALL);
    const detail = normalizeMatchDetail(raw, this.ctx);
    if (!detail) throw new NotFoundError('This match belongs to a competition Pitchside does not cover.');
    return detail;
  }

  async headToHead(matchId: string, detail: MatchDetail): Promise<HeadToHead | null> {
    const raw = await this.client.getJson<FdHead2HeadResponse>(`matches/${rawId(matchId)}/head2head`, { limit: 10 });
    return normalizeHeadToHead(raw, this.ctx, detail);
  }

  async matchesByIds(matchIds: string[]): Promise<Match[]> {
    const ids = matchIds.map(rawId);
    const out: Match[] = [];
    for (let i = 0; i < ids.length; i += 20) {
      const raw = await this.client.getJson<FdMatchesResponse>('matches', { ids: ids.slice(i, i + 20).join(',') });
      out.push(...normalizeMatchList(raw, this.ctx));
    }
    return out;
  }

  async team(teamId: string): Promise<TeamBase> {
    const raw = await this.client.getJson<FdTeam>(`teams/${rawId(teamId)}`);
    return normalizeTeamProfile(raw, this.ctx);
  }

  async teamMatches(teamId: string, range: DateRange): Promise<Match[]> {
    const raw = await this.client.getJson<FdMatchesResponse>(`teams/${rawId(teamId)}/matches`, {
      dateFrom: range.from,
      dateTo: addDays(range.to, 1),
      limit: 100,
    });
    return withinRange(normalizeMatchList(raw, this.ctx), range);
  }

  async competitionTeams(comp: CompetitionConfig): Promise<TeamRef[]> {
    const raw = await this.client.getJson<FdTeamsResponse>(`competitions/${code(comp)}/teams`);
    const national = comp.category === 'international';
    return (raw.teams ?? []).filter((t) => t.id != null && t.name).map((t) => normalizeTeam(t, national));
  }
}

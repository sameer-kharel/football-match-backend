import type { CompetitionConfig } from '../config/competitions.js';
import type {
  HeadToHead,
  Match,
  MatchDetail,
  Scorer,
  SeasonInfo,
  Source,
  Standings,
  TeamProfile,
  TeamRef,
} from '../domain/types.js';

/** Inclusive UTC calendar dates, YYYY-MM-DD. */
export interface DateRange {
  from: string;
  to: string;
}

export interface ProviderCompetitionMeta {
  competitionId: string;
  emblem: string | null;
  season: SeasonInfo | null;
}

export type TeamBase = Omit<TeamProfile, 'nextMatches' | 'recentMatches'>;

/**
 * A data provider. Implementations return normalized, un-annotated data
 * (featured tiers and rivalries are added by the service layer) and throw
 * AppError subclasses for 404 / 403 / 429 / upstream failures.
 */
export interface FootballProvider {
  readonly source: Source;
  /** Registry competitions this provider can serve with the configured credentials. */
  accessibleCompetitions(): Promise<ProviderCompetitionMeta[]>;
  /** One UTC day, every competition the provider serves (unknown competitions are dropped). */
  matchesOnDate(date: string): Promise<Match[]>;
  matchesInRange(range: DateRange): Promise<Match[]>;
  competitionMatches(competition: CompetitionConfig): Promise<Match[]>;
  standings(competition: CompetitionConfig): Promise<Standings>;
  scorers(competition: CompetitionConfig, limit: number): Promise<Scorer[]>;
  matchDetail(matchId: string): Promise<MatchDetail>;
  headToHead(matchId: string, detail: MatchDetail): Promise<HeadToHead | null>;
  matchesByIds(matchIds: string[]): Promise<Match[]>;
  team(teamId: string): Promise<TeamBase>;
  teamMatches(teamId: string, range: DateRange): Promise<Match[]>;
  competitionTeams(competition: CompetitionConfig): Promise<TeamRef[]>;
}

/** Internal ids carry their source: "fd-86", "af-541". */
export function parseSourcedId(id: string): { source: Source; raw: string } | null {
  const m = /^(fd|af)-(\d{1,10})$/.exec(id);
  if (!m?.[1] || !m[2]) return null;
  return { source: m[1] === 'fd' ? 'football-data' : 'api-football', raw: m[2] };
}

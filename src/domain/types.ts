/**
 * Normalized internal schema. Every provider maps into these shapes; the app never
 * sees a raw provider payload. Keep this file in sync with app/lib/core/models.
 */

export type Source = 'football-data' | 'api-football' | 'openligadb';

export type CompetitionCategory = 'club' | 'international';
export type CompetitionFormat = 'league' | 'cup' | 'tournament';

export type ZoneId =
  | 'ucl'
  | 'uel'
  | 'uecl'
  | 'promotion'
  | 'promotion_playoff'
  | 'relegation_playoff'
  | 'relegation'
  | 'knockout'
  | 'knockout_playoff'
  | 'qualified'
  | 'libertadores'
  | 'sudamericana';

export interface ZoneRule {
  zone: ZoneId;
  from: number;
  to: number;
  label: string;
}

export interface Competition {
  id: string;
  name: string;
  shortName: string;
  category: CompetitionCategory;
  format: CompetitionFormat;
  region: string;
  emblem: string | null;
  priority: number;
  hasStandings: boolean;
  hasScorers: boolean;
  hasBracket: boolean;
  zones: ZoneRule[];
  season: SeasonInfo | null;
  source: Source;
}

export interface SeasonInfo {
  label: string;
  startDate: string | null;
  endDate: string | null;
  currentMatchday: number | null;
}

export type FeaturedTier = 1 | 2 | 3;

export interface TeamRef {
  id: string;
  name: string;
  shortName: string;
  tla: string | null;
  crest: string | null;
  national: boolean;
  /** Set when the team is in the featured config (club or international tier). */
  featuredTier: FeaturedTier | null;
  /** Configured brand color for featured teams, used for a subtle tint in the app. */
  color: string | null;
}

export type MatchStatus =
  | 'scheduled'
  | 'live'
  | 'paused'
  | 'finished'
  | 'postponed'
  | 'suspended'
  | 'cancelled'
  | 'awarded';

export type LivePhase = 'first_half' | 'half_time' | 'second_half' | 'extra_time' | 'penalties';

export interface ScorePair {
  home: number | null;
  away: number | null;
}

export interface Score {
  /** The score to display: includes extra time, excludes the shootout. */
  home: number | null;
  away: number | null;
  halfTime: ScorePair | null;
  /** Score after 90 minutes, only meaningful when the match went beyond. */
  regularTime: ScorePair | null;
  /** Goals scored during extra time only. */
  extraTime: ScorePair | null;
  penalties: ScorePair | null;
  winner: 'home' | 'away' | 'draw' | null;
  duration: 'regular' | 'extra_time' | 'penalties';
}

export interface Referee {
  name: string;
  role: 'referee' | 'assistant' | 'fourth_official' | 'var' | 'other';
  nationality: string | null;
}

export interface Match {
  id: string;
  source: Source;
  competitionId: string;
  competitionName: string;
  season: string | null;
  utcDate: string;
  /** false when the provider only knows the day, not the exact kickoff time. */
  kickoffConfirmed: boolean;
  status: MatchStatus;
  statusDetail: string | null;
  livePhase: LivePhase | null;
  minute: number | null;
  injuryTime: number | null;
  stage: string | null;
  stageLabel: string | null;
  group: string | null;
  matchday: number | null;
  isKnockout: boolean;
  homeTeam: TeamRef;
  awayTeam: TeamRef;
  score: Score;
  venue: string | null;
  referees: Referee[];
  lastUpdated: string | null;
  /** True when the provider tier delivers delayed scores (football-data free tier). */
  scoreDelayed: boolean;
  /** Name of the rivalry, e.g. "El Clásico", when the pair is configured as one. */
  rivalry: string | null;
  /** Highlight score, only present on ranked responses. */
  highlightScore?: number;
}

export type MatchEventType =
  | 'goal'
  | 'own_goal'
  | 'penalty_goal'
  | 'missed_penalty'
  | 'yellow_card'
  | 'second_yellow'
  | 'red_card'
  | 'substitution'
  | 'var';

export interface MatchEvent {
  minute: number;
  injuryTime: number | null;
  type: MatchEventType;
  side: 'home' | 'away';
  player: string | null;
  /** Assist provider for goals, player coming off for substitutions. */
  secondaryPlayer: string | null;
  /** Running score after a goal, when the provider supplies it. */
  score: ScorePair | null;
  detail: string | null;
}

export interface LineupPlayer {
  id: string | null;
  name: string;
  position: string | null;
  shirtNumber: number | null;
}

export interface Lineup {
  formation: string | null;
  coach: string | null;
  startingXI: LineupPlayer[];
  bench: LineupPlayer[];
}

export interface MatchStat {
  key: string;
  label: string;
  home: number | null;
  away: number | null;
  unit: '%' | null;
}

export interface HeadToHead {
  numberOfMatches: number;
  totalGoals: number | null;
  homeWins: number;
  awayWins: number;
  draws: number;
  recent: Match[];
}

export interface MatchDetail extends Match {
  attendance: number | null;
  events: MatchEvent[];
  lineups: { home: Lineup; away: Lineup } | null;
  statistics: MatchStat[];
  headToHead: HeadToHead | null;
  positions: { home: number | null; away: number | null } | null;
}

export type FormResult = 'W' | 'D' | 'L';

export interface StandingRow {
  position: number;
  team: TeamRef;
  played: number;
  won: number;
  draw: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  form: FormResult[];
  zone: ZoneId | null;
}

export interface StandingGroup {
  name: string | null;
  stage: string | null;
  rows: StandingRow[];
}

export interface Standings {
  competitionId: string;
  season: string | null;
  groups: StandingGroup[];
  zones: ZoneRule[];
}

export interface Player {
  id: string;
  name: string;
  position: string | null;
  nationality: string | null;
  dateOfBirth: string | null;
  shirtNumber: number | null;
}

export interface Scorer {
  player: Player;
  team: TeamRef;
  goals: number;
  assists: number | null;
  penalties: number | null;
  playedMatches: number | null;
}

export interface TeamProfile {
  team: TeamRef;
  area: string | null;
  founded: number | null;
  venue: string | null;
  clubColors: string | null;
  website: string | null;
  coach: string | null;
  competitions: { id: string; name: string }[];
  squad: Player[];
  nextMatches: Match[];
  recentMatches: Match[];
}

export interface TeamIndexEntry {
  team: TeamRef;
  competitionIds: string[];
}

export interface ResponseMeta {
  stale: boolean;
  fetchedAt: string;
  sources: Source[];
  delayed: boolean;
  partial: boolean;
  warnings: string[];
}

export interface Envelope<T> {
  data: T;
  meta: ResponseMeta;
}

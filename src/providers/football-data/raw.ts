/**
 * football-data.org v4 response shapes, as documented at docs.football-data.org/general/v4.
 * Everything is optional/nullable on purpose: the API "embraces null", folds deep
 * nodes in list views, and the free tier omits lineups, goals and bookings.
 */

export interface FdScorePair {
  home?: number | null;
  away?: number | null;
  /** v2-style keys still appear in some docs samples. */
  homeTeam?: number | null;
  awayTeam?: number | null;
}

export interface FdScore {
  winner?: 'HOME_TEAM' | 'AWAY_TEAM' | 'DRAW' | null;
  duration?: 'REGULAR' | 'EXTRA_TIME' | 'PENALTY_SHOOTOUT' | null;
  fullTime?: FdScorePair | null;
  halfTime?: FdScorePair | null;
  regularTime?: FdScorePair | null;
  extraTime?: FdScorePair | null;
  penalties?: FdScorePair | null;
}

export interface FdPerson {
  id?: number | null;
  name?: string | null;
  position?: string | null;
  shirtNumber?: number | null;
  nationality?: string | null;
  dateOfBirth?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

export interface FdTeam {
  id?: number | null;
  name?: string | null;
  shortName?: string | null;
  tla?: string | null;
  crest?: string | null;
  coach?: FdPerson | null;
  leagueRank?: number | null;
  formation?: string | null;
  lineup?: FdPerson[] | null;
  bench?: FdPerson[] | null;
  statistics?: Record<string, number | null> | null;
  address?: string | null;
  website?: string | null;
  founded?: number | null;
  clubColors?: string | null;
  venue?: string | null;
  area?: { name?: string | null } | null;
  runningCompetitions?: { id?: number; name?: string; code?: string }[] | null;
  squad?: FdPerson[] | null;
}

export interface FdCompetitionRef {
  id?: number;
  name?: string;
  code?: string;
  type?: string;
  emblem?: string | null;
}

export interface FdSeason {
  id?: number;
  startDate?: string | null;
  endDate?: string | null;
  currentMatchday?: number | null;
}

export interface FdMatch {
  id: number;
  utcDate: string;
  status: string;
  minute?: number | string | null;
  injuryTime?: number | null;
  attendance?: number | null;
  venue?: string | null;
  matchday?: number | null;
  stage?: string | null;
  group?: string | null;
  lastUpdated?: string | null;
  competition?: FdCompetitionRef | null;
  season?: FdSeason | null;
  homeTeam: FdTeam;
  awayTeam: FdTeam;
  score?: FdScore | null;
  goals?:
    | {
        minute?: number | null;
        injuryTime?: number | null;
        /** REGULAR | OWN | PENALTY */
        type?: string | null;
        team?: { id?: number | null } | null;
        scorer?: FdPerson | null;
        assist?: FdPerson | null;
        score?: FdScorePair | null;
      }[]
    | null;
  bookings?:
    | {
        minute?: number | null;
        team?: { id?: number | null } | null;
        player?: FdPerson | null;
        /** YELLOW | YELLOW_RED | RED */
        card?: string | null;
      }[]
    | null;
  substitutions?:
    | {
        minute?: number | null;
        team?: { id?: number | null } | null;
        playerOut?: FdPerson | null;
        playerIn?: FdPerson | null;
      }[]
    | null;
  referees?: { id?: number; name?: string | null; type?: string | null; nationality?: string | null }[] | null;
}

export interface FdMatchesResponse {
  matches?: FdMatch[] | null;
  competition?: FdCompetitionRef | null;
}

export interface FdHead2HeadResponse {
  aggregates?: {
    numberOfMatches?: number | null;
    totalGoals?: number | null;
    homeTeam?: { id?: number | null; wins?: number | null; draws?: number | null; losses?: number | null } | null;
    awayTeam?: { id?: number | null; wins?: number | null; draws?: number | null; losses?: number | null } | null;
  } | null;
  matches?: FdMatch[] | null;
}

export interface FdStandingRow {
  position?: number | null;
  team?: FdTeam | null;
  playedGames?: number | null;
  form?: string | null;
  won?: number | null;
  draw?: number | null;
  lost?: number | null;
  points?: number | null;
  goalsFor?: number | null;
  goalsAgainst?: number | null;
  goalDifference?: number | null;
}

export interface FdStandingsResponse {
  season?: FdSeason | null;
  standings?: { stage?: string | null; type?: string | null; group?: string | null; table?: FdStandingRow[] | null }[] | null;
}

export interface FdScorersResponse {
  season?: FdSeason | null;
  scorers?:
    | {
        player?: FdPerson | null;
        team?: FdTeam | null;
        playedMatches?: number | null;
        goals?: number | null;
        assists?: number | null;
        penalties?: number | null;
      }[]
    | null;
}

export interface FdCompetitionsResponse {
  competitions?: (FdCompetitionRef & { currentSeason?: FdSeason | null })[] | null;
}

export interface FdTeamsResponse {
  teams?: FdTeam[] | null;
}

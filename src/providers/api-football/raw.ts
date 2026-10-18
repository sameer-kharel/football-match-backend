/** API-Football (api-sports.io) v3 shapes. Every field is treated as optional. */

export interface AfEnvelope<T> {
  get?: string;
  errors?: unknown[] | Record<string, string>;
  results?: number;
  paging?: { current?: number; total?: number };
  response?: T[];
}

export interface AfPair {
  home?: number | null;
  away?: number | null;
}

export interface AfTeamLite {
  id: number;
  name?: string | null;
  logo?: string | null;
  winner?: boolean | null;
}

export interface AfEvent {
  time?: { elapsed?: number | null; extra?: number | null };
  team?: { id?: number | null; name?: string | null };
  player?: { id?: number | null; name?: string | null };
  assist?: { id?: number | null; name?: string | null };
  type?: string | null;
  detail?: string | null;
  comments?: string | null;
}

export interface AfLineupEntry {
  player?: { id?: number | null; name?: string | null; number?: number | null; pos?: string | null };
}

export interface AfLineup {
  team?: { id?: number | null };
  formation?: string | null;
  coach?: { name?: string | null } | null;
  startXI?: AfLineupEntry[] | null;
  substitutes?: AfLineupEntry[] | null;
}

export interface AfTeamStatistics {
  team?: { id?: number | null };
  statistics?: { type?: string | null; value?: number | string | null }[] | null;
}

export interface AfFixture {
  fixture: {
    id: number;
    referee?: string | null;
    date: string;
    timestamp?: number | null;
    venue?: { id?: number | null; name?: string | null; city?: string | null } | null;
    status?: { long?: string | null; short?: string | null; elapsed?: number | null; extra?: number | null } | null;
  };
  league: { id: number; name?: string | null; country?: string | null; season?: number | null; round?: string | null };
  teams: { home: AfTeamLite; away: AfTeamLite };
  goals?: AfPair | null;
  score?: { halftime?: AfPair | null; fulltime?: AfPair | null; extratime?: AfPair | null; penalty?: AfPair | null } | null;
  events?: AfEvent[] | null;
  lineups?: AfLineup[] | null;
  statistics?: AfTeamStatistics[] | null;
}

export interface AfStandingRow {
  rank?: number | null;
  team?: { id?: number | null; name?: string | null; logo?: string | null } | null;
  points?: number | null;
  goalsDiff?: number | null;
  group?: string | null;
  form?: string | null;
  description?: string | null;
  all?: { played?: number | null; win?: number | null; draw?: number | null; lose?: number | null; goals?: { for?: number | null; against?: number | null } | null } | null;
}

export interface AfStandingsItem {
  league?: { id?: number; name?: string | null; season?: number | null; standings?: AfStandingRow[][] | null };
}

export interface AfTopScorer {
  player?: { id?: number | null; name?: string | null; nationality?: string | null; birth?: { date?: string | null } | null } | null;
  statistics?:
    | {
        team?: { id?: number | null; name?: string | null; logo?: string | null } | null;
        games?: { appearences?: number | null; position?: string | null } | null;
        goals?: { total?: number | null; assists?: number | null } | null;
        penalty?: { scored?: number | null } | null;
      }[]
    | null;
}

export interface AfTeamItem {
  team?: { id?: number | null; name?: string | null; code?: string | null; country?: string | null; founded?: number | null; national?: boolean | null; logo?: string | null } | null;
  venue?: { name?: string | null; city?: string | null } | null;
}

export interface AfLeagueItem {
  league?: { id?: number | null; name?: string | null; type?: string | null; logo?: string | null } | null;
  country?: { name?: string | null } | null;
  seasons?: { year?: number | null; start?: string | null; end?: string | null; current?: boolean | null }[] | null;
}

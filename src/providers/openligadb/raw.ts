/** OpenLigaDB JSON (api.openligadb.de), only the fields Pitchside reads. */

export interface OlTeam {
  teamId: number;
  teamName?: string | null;
  shortName?: string | null;
  teamIconUrl?: string | null;
}

/** resultTypeID: 1 half time, 2 after 90 minutes, 3 or 4 after extra time, 5 after penalties (cumulative). */
export interface OlResult {
  resultTypeID: number;
  resultOrderID?: number | null;
  pointsTeam1: number | null;
  pointsTeam2: number | null;
}

export interface OlGoal {
  scoreTeam1: number | null;
  scoreTeam2: number | null;
  /** null for shootout kicks. */
  matchMinute: number | null;
  goalGetterID?: number | null;
  goalGetterName?: string | null;
  isPenalty?: boolean | null;
  isOwnGoal?: boolean | null;
  isOvertime?: boolean | null;
}

export interface OlMatch {
  matchID: number;
  matchDateTimeUTC: string;
  leagueShortcut?: string | null;
  leagueSeason?: number | null;
  group?: { groupName?: string | null; groupOrderID?: number | null } | null;
  team1: OlTeam;
  team2: OlTeam;
  matchIsFinished: boolean;
  matchResults?: OlResult[] | null;
  goals?: OlGoal[] | null;
  location?: { locationCity?: string | null; locationStadium?: string | null } | null;
  numberOfViewers?: number | null;
  lastUpdateDateTime?: string | null;
}

export interface OlTableRow {
  teamInfoId: number;
  teamName?: string | null;
  shortName?: string | null;
  teamIconUrl?: string | null;
  points: number;
  goals: number;
  opponentGoals: number;
  goalDiff: number;
  matches: number;
  won: number;
  draw: number;
  lost: number;
}

/** One league season as cached: the season it is and its trimmed matches. */
export interface OlSeason {
  shortcut: string;
  season: number;
  matches: OlMatch[];
}

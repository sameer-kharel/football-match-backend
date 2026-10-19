import type { CompetitionConfig } from '../../config/competitions.js';
import { isKnockoutStage, stageLabel } from '../../domain/stages.js';
import { zoneFor } from '../../domain/standings.js';
import type {
  FormResult,
  Match,
  MatchDetail,
  MatchEvent,
  MatchStatus,
  Score,
  Scorer,
  Standings,
  TeamRef,
} from '../../domain/types.js';
import type { OlGoal, OlMatch, OlResult, OlSeason, OlTableRow, OlTeam } from './raw.js';

export const olId = (id: number | string) => `ol-${id}`;

/** OpenLigaDB names seasons by their first year: 2026 → "2026/27". */
export const olSeasonLabel = (season: number) => `${season}/${String((season + 1) % 100).padStart(2, '0')}`;

const HOUR = 3_600_000;
/** OpenLigaDB has no live flag: an unfinished match counts as in play this long after kickoff. */
const LIVE_WINDOW = 3 * HOUR;

/**
 * Crest URL safe for the app: https only, and Wikimedia SVGs (some use features
 * flutter_svg can't draw) swapped for Wikimedia's own 120 px PNG rendering.
 */
export function olCrest(url: string | null | undefined): string | null {
  if (!url) return null;
  const https = url.replace(/^http:\/\//, 'https://');
  // Already a Wikimedia rendering: ask for the small one (some links are 960 px).
  const thumb = /^(https:\/\/upload\.wikimedia\.org\/wikipedia\/[^/]+\/thumb\/[0-9a-f]\/[0-9a-f]{2}\/[^/]+\/)\d+px-([^/]+)$/i.exec(https);
  if (thumb) return `${thumb[1]}120px-${thumb[2]}`;
  const m = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/(commons|[a-z]{2})\/([0-9a-f])\/([0-9a-f]{2})\/([^/?#]+\.svg)$/i.exec(https);
  if (!m) return https.startsWith('https://') ? https : null;
  const [, project, a, ab, file] = m;
  return `https://upload.wikimedia.org/wikipedia/${project}/thumb/${a}/${ab}/${file}/120px-${file}.png`;
}

export function olTeam(t: OlTeam | null | undefined): TeamRef {
  const name = t?.teamName?.trim() || t?.shortName?.trim() || 'TBD';
  return {
    id: olId(t?.teamId ?? 0),
    name,
    shortName: t?.shortName?.trim() || name,
    tla: null,
    crest: olCrest(t?.teamIconUrl),
    national: false,
    featuredTier: null,
    color: null,
  };
}

/** Keeps only what normalization reads, so a cached season stays small. */
export function trimOlMatch(m: OlMatch): OlMatch {
  return {
    matchID: m.matchID,
    matchDateTimeUTC: m.matchDateTimeUTC,
    leagueShortcut: m.leagueShortcut ?? null,
    leagueSeason: m.leagueSeason ?? null,
    group: m.group ? { groupName: m.group.groupName ?? null, groupOrderID: m.group.groupOrderID ?? null } : null,
    team1: { teamId: m.team1.teamId, teamName: m.team1.teamName ?? null, shortName: m.team1.shortName ?? null, teamIconUrl: m.team1.teamIconUrl ?? null },
    team2: { teamId: m.team2.teamId, teamName: m.team2.teamName ?? null, shortName: m.team2.shortName ?? null, teamIconUrl: m.team2.teamIconUrl ?? null },
    matchIsFinished: m.matchIsFinished,
    matchResults: (m.matchResults ?? []).map((r) => ({
      resultTypeID: r.resultTypeID,
      resultOrderID: r.resultOrderID ?? null,
      pointsTeam1: r.pointsTeam1,
      pointsTeam2: r.pointsTeam2,
    })),
    goals: (m.goals ?? []).map((g) => ({
      scoreTeam1: g.scoreTeam1,
      scoreTeam2: g.scoreTeam2,
      matchMinute: g.matchMinute,
      goalGetterID: g.goalGetterID ?? null,
      goalGetterName: g.goalGetterName ?? null,
      isPenalty: g.isPenalty ?? false,
      isOwnGoal: g.isOwnGoal ?? false,
      isOvertime: g.isOvertime ?? false,
    })),
    location: m.location ? { locationCity: m.location.locationCity ?? null, locationStadium: m.location.locationStadium ?? null } : null,
    numberOfViewers: m.numberOfViewers ?? null,
  };
}

// ── Rounds ────────────────────────────────────────────────────────────────

const CUP_ROUNDS: Record<string, string> = {
  achtelfinale: 'LAST_16',
  viertelfinale: 'QUARTER_FINALS',
  halbfinale: 'SEMI_FINALS',
  finale: 'FINAL',
  endspiel: 'FINAL',
};

/** A single-leg knockout round named "1. Runde", by how many matches it has. */
const BY_MATCH_COUNT: Record<number, string> = { 32: 'LAST_64', 16: 'LAST_32', 8: 'LAST_16', 4: 'QUARTER_FINALS', 2: 'SEMI_FINALS', 1: 'FINAL' };

export interface OlRoundInfo {
  /** Matches per groupOrderID, for naming numbered cup rounds. */
  roundSizes: Map<number, number>;
  /** League matchdays whose kickoff times are still placeholders (every match at one time). */
  provisional: Set<number>;
}

export function roundInfo(matches: readonly OlMatch[]): OlRoundInfo {
  const kickoffs = new Map<number, Set<string>>();
  const roundSizes = new Map<number, number>();
  for (const m of matches) {
    const g = m.group?.groupOrderID;
    if (g == null) continue;
    roundSizes.set(g, (roundSizes.get(g) ?? 0) + 1);
    const set = kickoffs.get(g) ?? new Set<string>();
    set.add(m.matchDateTimeUTC);
    kickoffs.set(g, set);
  }
  // The last matchday kicks off simultaneously by rule, so it is never a placeholder.
  const last = Math.max(0, ...kickoffs.keys());
  const provisional = new Set<number>();
  for (const [g, times] of kickoffs) if (g !== last && times.size === 1 && (roundSizes.get(g) ?? 0) > 3) provisional.add(g);
  return { roundSizes, provisional };
}

function round(m: OlMatch, comp: CompetitionConfig, info: OlRoundInfo | null): { stage: string | null; matchday: number | null } {
  const order = m.group?.groupOrderID ?? null;
  if (comp.format === 'league') return { stage: 'REGULAR_SEASON', matchday: order };
  const name = (m.group?.groupName ?? '').trim().toLowerCase();
  const named = CUP_ROUNDS[name];
  if (named) return { stage: named, matchday: null };
  const size = order != null ? info?.roundSizes.get(order) : undefined;
  const bySize = size ? BY_MATCH_COUNT[size] : undefined;
  if (bySize) return { stage: bySize, matchday: null };
  const numbered = /^(\d+)\.\s*runde$/.exec(name);
  return { stage: numbered ? `ROUND_${numbered[1]}` : null, matchday: null };
}

// ── Status and score ─────────────────────────────────────────────────────

function results(m: OlMatch): OlResult[] {
  return [...(m.matchResults ?? [])].sort((a, b) => (a.resultOrderID ?? a.resultTypeID) - (b.resultOrderID ?? b.resultTypeID));
}

/** A known score; ScorePair allows nulls, these never are. */
interface Pair {
  home: number;
  away: number;
}

function pair(r: OlResult | undefined | null): Pair | null {
  if (!r || r.pointsTeam1 == null || r.pointsTeam2 == null) return null;
  return { home: r.pointsTeam1, away: r.pointsTeam2 };
}

const isShootoutKick = (g: OlGoal) => g.matchMinute == null && !!g.isPenalty;
const total = (p: Pair) => p.home + p.away;
const goalScore = (g: OlGoal): Pair => ({ home: g.scoreTeam1 ?? 0, away: g.scoreTeam2 ?? 0 });

/** Goals in play order: the running score only goes up, minutes break ties. */
function playGoals(m: OlMatch): OlGoal[] {
  return (m.goals ?? [])
    .filter((g) => !isShootoutKick(g) && g.scoreTeam1 != null && g.scoreTeam2 != null)
    .sort((a, b) => total(goalScore(a)) - total(goalScore(b)) || (a.matchMinute ?? 0) - (b.matchMinute ?? 0));
}

export function olStatus(m: OlMatch, now: number): MatchStatus {
  if (m.matchIsFinished) return 'finished';
  const kickoff = Date.parse(m.matchDateTimeUTC);
  if (now < kickoff) return 'scheduled';
  if (now - kickoff < LIVE_WINDOW) return 'live';
  // Long past kickoff and still open: the final whistle was entered without the flag.
  return (m.matchResults ?? []).length > 0 ? 'finished' : 'scheduled';
}

export function normalizeOlScore(m: OlMatch, status: MatchStatus): Score {
  const empty: Score = { home: null, away: null, halfTime: null, regularTime: null, extraTime: null, penalties: null, winner: null, duration: 'regular' };
  if (status === 'scheduled' || status === 'postponed' || status === 'cancelled') return empty;

  const rs = results(m);
  const byType = (t: number) => rs.find((r) => r.resultTypeID === t);
  const shootout = pair(byType(5));
  const played = rs.filter((r) => r.resultTypeID !== 1 && r.resultTypeID !== 5);
  let current = pair(played.at(-1)) ?? (status === 'live' ? pair(byType(1)) : null);

  // While the match is on, goals are often entered before the result rows.
  const lastGoal = playGoals(m).at(-1);
  if (lastGoal && (status === 'live' || !current)) {
    const fromGoals = goalScore(lastGoal);
    if (!current || total(fromGoals) > total(current)) current = fromGoals;
  }
  current ??= status === 'live' ? { home: 0, away: 0 } : null;
  if (!current) return empty;

  const duration: Score['duration'] = shootout ? 'penalties' : byType(4) || byType(3) ? 'extra_time' : 'regular';
  // Type 4 sits on top of a true 90-minute row; older seasons put the extra-time score in type 2 and repeat it as type 3.
  const regular = byType(4) ? pair(byType(2)) : null;
  const extraTime = regular ? { home: Math.max(0, current.home - regular.home), away: Math.max(0, current.away - regular.away) } : null;

  // The shootout row counts on from the match score.
  let penalties: Pair | null = null;
  if (shootout) {
    const cumulative = shootout.home >= current.home && shootout.away >= current.away;
    penalties = cumulative ? { home: shootout.home - current.home, away: shootout.away - current.away } : shootout;
  }

  let winner: Score['winner'] = null;
  if (status === 'finished') {
    const decider = penalties && current.home === current.away ? penalties : current;
    winner = decider.home > decider.away ? 'home' : decider.away > decider.home ? 'away' : 'draw';
  }

  return {
    home: current.home,
    away: current.away,
    halfTime: pair(byType(1)),
    regularTime: duration === 'regular' ? null : regular,
    extraTime: duration === 'regular' ? null : extraTime,
    penalties,
    winner,
    duration,
  };
}

// ── Matches ──────────────────────────────────────────────────────────────

export function normalizeOlMatch(m: OlMatch, comp: CompetitionConfig, now: number, info: OlRoundInfo | null = null): Match {
  const status = olStatus(m, now);
  const r = round(m, comp, info);
  const venue = [m.location?.locationStadium, m.location?.locationCity].filter((x) => !!x?.trim()).join(', ');
  const provisional = comp.format === 'league' && r.matchday != null && !!info?.provisional.has(r.matchday);
  return {
    id: olId(m.matchID),
    source: 'openligadb',
    competitionId: comp.id,
    competitionName: comp.shortName,
    season: m.leagueSeason != null ? olSeasonLabel(m.leagueSeason) : null,
    utcDate: new Date(m.matchDateTimeUTC).toISOString(),
    kickoffConfirmed: status !== 'scheduled' || !provisional,
    status,
    statusDetail: null,
    livePhase: null,
    minute: null,
    injuryTime: null,
    stage: r.stage,
    stageLabel: stageLabel(r.stage),
    group: null,
    matchday: r.matchday,
    isKnockout: comp.format === 'cup' || isKnockoutStage(r.stage),
    homeTeam: olTeam(m.team1),
    awayTeam: olTeam(m.team2),
    score: normalizeOlScore(m, status),
    venue: venue || null,
    referees: [],
    lastUpdated: null,
    // Community-entered, usually within minutes of the goal: not the provider-imposed delay the flag is for.
    scoreDelayed: false,
    rivalry: null,
  };
}

export function normalizeOlSeason(season: OlSeason, comp: CompetitionConfig, now: number): Match[] {
  const info = roundInfo(season.matches);
  return season.matches
    .map((m) => normalizeOlMatch(m, comp, now, info))
    .sort((a, b) => a.utcDate.localeCompare(b.utcDate) || a.id.localeCompare(b.id));
}

/** Which side scored: the running score says it even for own goals; the ids are a fallback. */
function goalEvents(m: OlMatch): MatchEvent[] {
  const events: MatchEvent[] = [];
  let prev = { home: 0, away: 0 };
  for (const g of playGoals(m)) {
    const score = goalScore(g);
    const side: MatchEvent['side'] = score.home > prev.home ? 'home' : 'away';
    prev = score;
    events.push({
      minute: g.matchMinute ?? 0,
      injuryTime: null,
      type: g.isOwnGoal ? 'own_goal' : g.isPenalty ? 'penalty_goal' : 'goal',
      side,
      player: g.goalGetterName?.trim() || null,
      secondaryPlayer: null,
      score,
      detail: null,
    });
  }
  return events.sort((a, b) => a.minute - b.minute);
}

export function normalizeOlDetail(m: OlMatch, comp: CompetitionConfig, now: number, info: OlRoundInfo | null = null): MatchDetail {
  return {
    ...normalizeOlMatch(m, comp, now, info),
    attendance: m.numberOfViewers ?? null,
    events: goalEvents(m),
    lineups: null,
    statistics: [],
    headToHead: null,
    positions: null,
  };
}

// ── Tables and scorers ───────────────────────────────────────────────────

/** Last five results per team, newest last, from the season's finished matches. */
function formByTeam(matches: readonly OlMatch[], now: number): Map<number, FormResult[]> {
  const out = new Map<number, FormResult[]>();
  const done = matches
    .filter((m) => olStatus(m, now) === 'finished')
    .sort((a, b) => a.matchDateTimeUTC.localeCompare(b.matchDateTimeUTC));
  for (const m of done) {
    const s = normalizeOlScore(m, 'finished');
    if (s.home == null || s.away == null) continue;
    const home: FormResult = s.home > s.away ? 'W' : s.home < s.away ? 'L' : 'D';
    const away: FormResult = home === 'W' ? 'L' : home === 'L' ? 'W' : 'D';
    for (const [id, r] of [[m.team1.teamId, home], [m.team2.teamId, away]] as const) out.set(id, [...(out.get(id) ?? []), r].slice(-5));
  }
  return out;
}

export function normalizeOlTable(rows: readonly OlTableRow[], season: OlSeason, comp: CompetitionConfig, now: number): Standings {
  const form = formByTeam(season.matches, now);
  return {
    competitionId: comp.id,
    season: olSeasonLabel(season.season),
    groups: [
      {
        name: null,
        stage: 'REGULAR_SEASON',
        rows: rows.map((r, i) => ({
          position: i + 1,
          team: olTeam({ teamId: r.teamInfoId, teamName: r.teamName ?? null, shortName: r.shortName ?? null, teamIconUrl: r.teamIconUrl ?? null }),
          played: r.matches,
          won: r.won,
          draw: r.draw,
          lost: r.lost,
          goalsFor: r.goals,
          goalsAgainst: r.opponentGoals,
          goalDifference: r.goalDiff,
          points: r.points,
          form: form.get(r.teamInfoId) ?? [],
          zone: zoneFor(i + 1, comp.zones),
        })),
      },
    ],
    zones: comp.zones,
  };
}

/**
 * Top scorers counted from the season's goals (own goals and shootouts excluded).
 * OpenLigaDB's own list has no teams, and counting here keeps it in step with the
 * goals shown on match pages.
 */
export function olScorers(season: OlSeason, limit: number): Scorer[] {
  const byPlayer = new Map<string, Scorer & { last: string }>();
  for (const m of season.matches) {
    let prev = { home: 0, away: 0 };
    for (const g of playGoals(m)) {
      const score = goalScore(g);
      const homeScored = score.home > prev.home;
      prev = score;
      const name = g.goalGetterName?.trim();
      if (g.isOwnGoal || !name) continue;
      const key = g.goalGetterID ? String(g.goalGetterID) : name.toLowerCase();
      const team = olTeam(homeScored ? m.team1 : m.team2);
      const entry = byPlayer.get(key) ?? {
        player: { id: olId(g.goalGetterID ?? 0), name, position: null, nationality: null, dateOfBirth: null, shirtNumber: null },
        team,
        goals: 0,
        assists: null,
        penalties: 0,
        playedMatches: null,
        last: '',
      };
      entry.goals++;
      if (g.isPenalty) entry.penalties = (entry.penalties ?? 0) + 1;
      // A January transfer: show the team they score for now.
      if (m.matchDateTimeUTC >= entry.last) {
        entry.team = team;
        entry.last = m.matchDateTimeUTC;
      }
      byPlayer.set(key, entry);
    }
  }
  return [...byPlayer.values()]
    .sort((a, b) => b.goals - a.goals || (a.penalties ?? 0) - (b.penalties ?? 0) || a.player.name.localeCompare(b.player.name))
    .slice(0, limit)
    .map(({ last: _last, ...s }) => s);
}

export function olTeams(season: OlSeason): TeamRef[] {
  const byId = new Map<number, TeamRef>();
  for (const m of season.matches) {
    for (const t of [m.team1, m.team2]) if (t.teamId && !byId.has(t.teamId)) byId.set(t.teamId, olTeam(t));
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

import type { CompetitionConfig } from '../../config/competitions.js';
import { competitionById } from '../../config/competitions.js';
import { groupLabel, isKnockoutStage, seasonLabel, stageLabel } from '../../domain/stages.js';
import { zoneFor } from '../../domain/standings.js';
import type {
  FormResult,
  HeadToHead,
  LineupPlayer,
  LivePhase,
  Match,
  MatchDetail,
  MatchEvent,
  MatchStat,
  MatchStatus,
  Player,
  Referee,
  Score,
  ScorePair,
  Scorer,
  StandingGroup,
  Standings,
  TeamRef,
} from '../../domain/types.js';
import type { TeamBase } from '../types.js';
import type {
  FdCompetitionsResponse,
  FdHead2HeadResponse,
  FdMatch,
  FdPerson,
  FdScore,
  FdScorePair,
  FdScorersResponse,
  FdStandingsResponse,
  FdTeam,
} from './raw.js';

export interface FdNormalizeContext {
  /** football-data competition code → registry entry. */
  byCode: (code: string) => CompetitionConfig | undefined;
  /** football-data free tier delivers delayed scores. */
  delayed: boolean;
}

export const fdId = (id: number | string) => `fd-${id}`;

export function normalizeTeam(raw: FdTeam | null | undefined, national: boolean): TeamRef {
  const name = raw?.name?.trim() || raw?.shortName?.trim() || 'TBD';
  return {
    id: raw?.id != null ? fdId(raw.id) : 'fd-0',
    name,
    shortName: raw?.shortName?.trim() || name,
    tla: raw?.tla?.trim() || null,
    crest: raw?.crest || null,
    national,
    featuredTier: null,
    color: null,
  };
}

function pair(p: FdScorePair | null | undefined): ScorePair | null {
  if (!p) return null;
  const home = p.home ?? p.homeTeam ?? null;
  const away = p.away ?? p.awayTeam ?? null;
  return home === null && away === null ? null : { home, away };
}

const minus = (a: number | null, b: number | null) => (a === null ? null : Math.max(0, a - (b ?? 0)));
const plus = (a: number | null, b: number | null) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));

/**
 * football-data's fullTime is the running/final score and, after a shootout,
 * includes the shootout goals (docs: "Dealing with overtime and penalty shootout").
 * We expose the match score without the shootout and the shootout separately.
 */
export function normalizeScore(s: FdScore | null | undefined): Score {
  const ft = pair(s?.fullTime);
  const ht = pair(s?.halfTime);
  const rt = pair(s?.regularTime);
  const et = pair(s?.extraTime);
  const pens = pair(s?.penalties);
  const duration: Score['duration'] =
    s?.duration === 'PENALTY_SHOOTOUT' ? 'penalties' : s?.duration === 'EXTRA_TIME' ? 'extra_time' : 'regular';

  let main = ft;
  if (duration === 'penalties' && pens) {
    if (rt && et) main = { home: plus(rt.home, et.home), away: plus(rt.away, et.away) };
    else if (ft) main = { home: minus(ft.home, pens.home), away: minus(ft.away, pens.away) };
  }

  let regular: ScorePair | null = null;
  if (duration !== 'regular') {
    regular = rt ?? (main && et ? { home: minus(main.home, et.home), away: minus(main.away, et.away) } : null);
  }

  const winner = s?.winner === 'HOME_TEAM' ? 'home' : s?.winner === 'AWAY_TEAM' ? 'away' : s?.winner === 'DRAW' ? 'draw' : null;

  return {
    home: main?.home ?? null,
    away: main?.away ?? null,
    halfTime: ht,
    regularTime: regular,
    extraTime: duration !== 'regular' ? et : null,
    penalties: duration === 'penalties' ? pens : null,
    winner,
    duration,
  };
}

const STATUS: Record<string, MatchStatus> = {
  SCHEDULED: 'scheduled',
  TIMED: 'scheduled',
  IN_PLAY: 'live',
  LIVE: 'live',
  EXTRA_TIME: 'live',
  PENALTY_SHOOTOUT: 'live',
  PAUSED: 'paused',
  FINISHED: 'finished',
  AWARDED: 'awarded',
  SUSPENDED: 'suspended',
  POSTPONED: 'postponed',
  CANCELLED: 'cancelled',
};

function parseMinute(m: number | string | null | undefined): number | null {
  if (typeof m === 'number') return m;
  if (typeof m === 'string') {
    const n = parseInt(m, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function livePhase(raw: FdMatch, status: MatchStatus, minute: number | null): LivePhase | null {
  const duration = raw.score?.duration;
  if (raw.status === 'PENALTY_SHOOTOUT' || (status === 'live' && duration === 'PENALTY_SHOOTOUT')) return 'penalties';
  if (raw.status === 'EXTRA_TIME' || (status === 'live' && duration === 'EXTRA_TIME')) return 'extra_time';
  if (status === 'paused') return duration && duration !== 'REGULAR' ? null : 'half_time';
  if (status === 'live') {
    if (minute !== null) return minute > 45 ? 'second_half' : 'first_half';
    return pair(raw.score?.halfTime) ? 'second_half' : 'first_half';
  }
  return null;
}

function refereeRole(type: string | null | undefined): Referee['role'] {
  if (!type) return 'other';
  if (type === 'REFEREE') return 'referee';
  if (type.startsWith('ASSISTANT_REFEREE')) return 'assistant';
  if (type === 'FOURTH_OFFICIAL') return 'fourth_official';
  if (type.startsWith('VIDEO_ASSISTANT')) return 'var';
  return 'other';
}

export interface NormalizeMatchOptions {
  /** Used when the payload has no competition node (competition subresources). */
  fallbackComp?: CompetitionConfig;
  /** Keep matches from competitions outside the registry (head-to-head history). */
  allowUnknown?: boolean;
}

export function normalizeMatch(raw: FdMatch, ctx: FdNormalizeContext, options: NormalizeMatchOptions = {}): Match | null {
  const known = (raw.competition?.code && ctx.byCode(raw.competition.code)) || (!raw.competition?.code ? options.fallbackComp : undefined);
  if (!known && !options.allowUnknown) return null;
  const comp = known ?? {
    id: raw.competition?.code ?? 'OTHER',
    shortName: raw.competition?.name ?? 'Other',
    category: options.fallbackComp?.category ?? 'club',
  };

  const status = STATUS[raw.status] ?? 'scheduled';
  const minute = parseMinute(raw.minute);
  const national = comp.category === 'international';
  const stage = raw.stage ?? null;

  return {
    id: fdId(raw.id),
    source: 'football-data',
    competitionId: comp.id,
    competitionName: comp.shortName,
    season: seasonLabel(raw.season?.startDate, raw.season?.endDate),
    utcDate: new Date(raw.utcDate).toISOString(),
    kickoffConfirmed: raw.status !== 'SCHEDULED',
    status,
    statusDetail: raw.status === 'PAUSED' && raw.score?.duration && raw.score.duration !== 'REGULAR' ? 'Break' : null,
    livePhase: livePhase(raw, status, minute),
    minute: status === 'live' ? minute : null,
    injuryTime: status === 'live' ? (raw.injuryTime ?? null) : null,
    stage,
    stageLabel: stageLabel(stage),
    group: groupLabel(raw.group),
    matchday: raw.matchday ?? null,
    isKnockout: isKnockoutStage(stage),
    homeTeam: normalizeTeam(raw.homeTeam, national),
    awayTeam: normalizeTeam(raw.awayTeam, national),
    score: normalizeScore(raw.score),
    venue: raw.venue?.trim() || null,
    referees: (raw.referees ?? [])
      .filter((r) => r.name)
      .map((r) => ({ name: r.name ?? '', role: refereeRole(r.type), nationality: r.nationality ?? null })),
    lastUpdated: raw.lastUpdated ?? null,
    scoreDelayed: ctx.delayed,
    rivalry: null,
  };
}

export function normalizeMatchList(raw: { matches?: FdMatch[] | null }, ctx: FdNormalizeContext, options: NormalizeMatchOptions = {}): Match[] {
  const out: Match[] = [];
  for (const m of raw.matches ?? []) {
    const n = normalizeMatch(m, ctx, options);
    if (n) out.push(n);
  }
  return out.sort((a, b) => a.utcDate.localeCompare(b.utcDate) || a.id.localeCompare(b.id));
}

const EVENT_ORDER: Record<MatchEvent['type'], number> = {
  goal: 0,
  own_goal: 0,
  penalty_goal: 0,
  missed_penalty: 1,
  var: 2,
  yellow_card: 3,
  second_yellow: 3,
  red_card: 3,
  substitution: 4,
};

export function sortEvents(events: MatchEvent[]): MatchEvent[] {
  return events.sort(
    (a, b) => a.minute - b.minute || (a.injuryTime ?? 0) - (b.injuryTime ?? 0) || EVENT_ORDER[a.type] - EVENT_ORDER[b.type],
  );
}

function lineupPlayer(p: FdPerson): LineupPlayer {
  return { id: p.id != null ? fdId(p.id) : null, name: p.name ?? '', position: p.position ?? null, shirtNumber: p.shirtNumber ?? null };
}

const STAT_LABELS: [key: string, label: string, unit: MatchStat['unit']][] = [
  ['ball_possession', 'Possession', '%'],
  ['shots', 'Shots', null],
  ['shots_on_goal', 'Shots on target', null],
  ['corner_kicks', 'Corners', null],
  ['fouls', 'Fouls', null],
  ['offsides', 'Offsides', null],
  ['saves', 'Saves', null],
  ['yellow_cards', 'Yellow cards', null],
  ['red_cards', 'Red cards', null],
];

export function normalizeMatchDetail(raw: FdMatch, ctx: FdNormalizeContext): MatchDetail | null {
  const base = normalizeMatch(raw, ctx);
  if (!base) return null;
  const homeId = raw.homeTeam?.id;
  const side = (teamId: number | null | undefined): 'home' | 'away' => (teamId != null && teamId === homeId ? 'home' : 'away');

  const events: MatchEvent[] = [];
  for (const g of raw.goals ?? []) {
    events.push({
      minute: g.minute ?? 0,
      injuryTime: g.injuryTime ?? null,
      type: g.type === 'OWN' ? 'own_goal' : g.type === 'PENALTY' ? 'penalty_goal' : 'goal',
      side: side(g.team?.id),
      player: g.scorer?.name ?? null,
      secondaryPlayer: g.assist?.name ?? null,
      score: pair(g.score),
      detail: null,
    });
  }
  for (const b of raw.bookings ?? []) {
    events.push({
      minute: b.minute ?? 0,
      injuryTime: null,
      type: b.card === 'RED' ? 'red_card' : b.card === 'YELLOW_RED' ? 'second_yellow' : 'yellow_card',
      side: side(b.team?.id),
      player: b.player?.name ?? null,
      secondaryPlayer: null,
      score: null,
      detail: null,
    });
  }
  for (const s of raw.substitutions ?? []) {
    events.push({
      minute: s.minute ?? 0,
      injuryTime: null,
      type: 'substitution',
      side: side(s.team?.id),
      player: s.playerIn?.name ?? null,
      secondaryPlayer: s.playerOut?.name ?? null,
      score: null,
      detail: null,
    });
  }

  const hasLineups = (raw.homeTeam?.lineup?.length ?? 0) > 0 || (raw.awayTeam?.lineup?.length ?? 0) > 0;
  const lineup = (t: FdTeam) => ({
    formation: t.formation ?? null,
    coach: t.coach?.name ?? null,
    startingXI: (t.lineup ?? []).map(lineupPlayer),
    bench: (t.bench ?? []).map(lineupPlayer),
  });

  const hs = raw.homeTeam?.statistics ?? null;
  const as = raw.awayTeam?.statistics ?? null;
  const statistics: MatchStat[] =
    hs || as
      ? STAT_LABELS.map(([key, label, unit]) => ({ key, label, unit, home: hs?.[key] ?? null, away: as?.[key] ?? null })).filter(
          (s) => s.home !== null || s.away !== null,
        )
      : [];

  const homeRank = raw.homeTeam?.leagueRank ?? null;
  const awayRank = raw.awayTeam?.leagueRank ?? null;

  return {
    ...base,
    attendance: raw.attendance ?? null,
    events: sortEvents(events),
    lineups: hasLineups ? { home: lineup(raw.homeTeam), away: lineup(raw.awayTeam) } : null,
    statistics,
    headToHead: null,
    positions: homeRank !== null || awayRank !== null ? { home: homeRank, away: awayRank } : null,
  };
}

export function normalizeHeadToHead(raw: FdHead2HeadResponse, ctx: FdNormalizeContext, current: Match): HeadToHead | null {
  const agg = raw.aggregates;
  const recent = normalizeMatchList(raw, ctx, { allowUnknown: true, fallbackComp: competitionById(current.competitionId) })
    .filter((m) => m.id !== current.id && m.status === 'finished')
    .sort((a, b) => b.utcDate.localeCompare(a.utcDate))
    .slice(0, 5);
  const total = agg?.numberOfMatches ?? recent.length;
  if (!total) return null;
  return {
    numberOfMatches: total,
    totalGoals: agg?.totalGoals ?? null,
    homeWins: agg?.homeTeam?.wins ?? 0,
    awayWins: agg?.awayTeam?.wins ?? 0,
    draws: agg?.homeTeam?.draws ?? 0,
    recent,
  };
}

export function parseForm(form: string | null | undefined): FormResult[] {
  if (!form) return [];
  return form
    .replace(/,/g, '')
    .split('')
    .filter((c): c is FormResult => c === 'W' || c === 'D' || c === 'L');
}

export function normalizeStandings(raw: FdStandingsResponse, comp: CompetitionConfig): Standings {
  const national = comp.category === 'international';
  const groups: StandingGroup[] = (raw.standings ?? [])
    .filter((s) => !s.type || s.type === 'TOTAL')
    .map((s) => ({
      name: groupLabel(s.group),
      stage: s.stage ?? null,
      rows: (s.table ?? []).map((r, i) => {
        const position = r.position ?? i + 1;
        return {
          position,
          team: normalizeTeam(r.team, national),
          played: r.playedGames ?? 0,
          won: r.won ?? 0,
          draw: r.draw ?? 0,
          lost: r.lost ?? 0,
          goalsFor: r.goalsFor ?? 0,
          goalsAgainst: r.goalsAgainst ?? 0,
          goalDifference: r.goalDifference ?? (r.goalsFor ?? 0) - (r.goalsAgainst ?? 0),
          points: r.points ?? 0,
          form: parseForm(r.form),
          zone: zoneFor(position, comp.zones),
        };
      }),
    }))
    .filter((g) => g.rows.length > 0);

  return {
    competitionId: comp.id,
    season: seasonLabel(raw.season?.startDate, raw.season?.endDate),
    groups,
    zones: comp.zones,
  };
}

function player(p: FdPerson | null | undefined): Player {
  return {
    id: p?.id != null ? fdId(p.id) : 'fd-0',
    name: p?.name ?? 'Unknown',
    position: p?.position ?? null,
    nationality: p?.nationality ?? null,
    dateOfBirth: p?.dateOfBirth ?? null,
    shirtNumber: p?.shirtNumber ?? null,
  };
}

export function normalizeScorers(raw: FdScorersResponse, comp: CompetitionConfig): Scorer[] {
  const national = comp.category === 'international';
  return (raw.scorers ?? [])
    .filter((s) => s.player?.name)
    .map((s) => ({
      player: player(s.player),
      team: normalizeTeam(s.team, national),
      goals: s.goals ?? 0,
      assists: s.assists ?? null,
      penalties: s.penalties ?? null,
      playedMatches: s.playedMatches ?? null,
    }));
}

export function normalizeTeamProfile(raw: FdTeam, ctx: FdNormalizeContext): TeamBase {
  const competitions = (raw.runningCompetitions ?? [])
    .map((c) => (c.code ? ctx.byCode(c.code) : undefined))
    .filter((c): c is CompetitionConfig => !!c);
  const national = competitions.length > 0 && competitions.every((c) => c.category === 'international');
  return {
    team: normalizeTeam(raw, national),
    area: raw.area?.name ?? null,
    founded: raw.founded ?? null,
    venue: raw.venue ?? null,
    clubColors: raw.clubColors ?? null,
    website: raw.website ?? null,
    coach: raw.coach?.name ?? null,
    competitions: competitions.map((c) => ({ id: c.id, name: c.shortName })),
    squad: (raw.squad ?? []).filter((p) => p.name).map(player),
  };
}

export function normalizeCompetitionList(raw: FdCompetitionsResponse, ctx: FdNormalizeContext) {
  return (raw.competitions ?? [])
    .map((c) => {
      const comp = c.code ? ctx.byCode(c.code) : undefined;
      if (!comp) return null;
      return {
        competitionId: comp.id,
        emblem: c.emblem ?? null,
        season: c.currentSeason
          ? {
              label: seasonLabel(c.currentSeason.startDate, c.currentSeason.endDate) ?? '',
              startDate: c.currentSeason.startDate ?? null,
              endDate: c.currentSeason.endDate ?? null,
              currentMatchday: c.currentSeason.currentMatchday ?? null,
            }
          : null,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);
}

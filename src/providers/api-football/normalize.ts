import type { CompetitionConfig } from '../../config/competitions.js';
import { isKnockoutStage, stageLabel } from '../../domain/stages.js';
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
  Scorer,
  Score,
  ScorePair,
  StandingGroup,
  Standings,
  TeamRef,
  ZoneId,
} from '../../domain/types.js';
import { zoneFor } from '../../domain/standings.js';
import { sortEvents } from '../football-data/normalize.js';
import type { AfEvent, AfFixture, AfLineup, AfPair, AfStandingsItem, AfTeamItem, AfTeamLite, AfTopScorer } from './raw.js';

export const afId = (id: number | string) => `af-${id}`;

export interface AfNormalizeContext {
  /** Resolved API-Football league id → registry competition. */
  compForLeague: (leagueId: number) => CompetitionConfig | undefined;
}

const STATUS: Record<string, { status: MatchStatus; phase: LivePhase | null; detail: string | null }> = {
  TBD: { status: 'scheduled', phase: null, detail: null },
  NS: { status: 'scheduled', phase: null, detail: null },
  '1H': { status: 'live', phase: 'first_half', detail: null },
  HT: { status: 'paused', phase: 'half_time', detail: null },
  '2H': { status: 'live', phase: 'second_half', detail: null },
  ET: { status: 'live', phase: 'extra_time', detail: null },
  BT: { status: 'paused', phase: null, detail: 'Break' },
  P: { status: 'live', phase: 'penalties', detail: null },
  LIVE: { status: 'live', phase: null, detail: null },
  SUSP: { status: 'suspended', phase: null, detail: 'Suspended' },
  INT: { status: 'suspended', phase: null, detail: 'Interrupted' },
  FT: { status: 'finished', phase: null, detail: null },
  AET: { status: 'finished', phase: null, detail: null },
  PEN: { status: 'finished', phase: null, detail: null },
  PST: { status: 'postponed', phase: null, detail: null },
  CANC: { status: 'cancelled', phase: null, detail: null },
  ABD: { status: 'cancelled', phase: null, detail: 'Abandoned' },
  AWD: { status: 'awarded', phase: null, detail: 'Awarded' },
  WO: { status: 'awarded', phase: null, detail: 'Walkover' },
};

export interface ParsedRound {
  stage: string | null;
  label: string | null;
  group: string | null;
  matchday: number | null;
}

/** "Regular Season - 10", "Group C - 2", "League A - 4", "Round of 16", "Final"... */
export function parseRound(round: string | null | undefined): ParsedRound {
  const r = (round ?? '').trim();
  if (!r) return { stage: null, label: null, group: null, matchday: null };
  const num = (s: string | undefined) => (s ? Number(s) : null);
  let m: RegExpExecArray | null;
  if ((m = /^Regular Season\s*-\s*(\d+)/i.exec(r))) return { stage: 'REGULAR_SEASON', label: null, group: null, matchday: num(m[1]) };
  if ((m = /^League Stage\s*-\s*(\d+)/i.exec(r))) return { stage: 'LEAGUE_STAGE', label: stageLabel('LEAGUE_STAGE'), group: null, matchday: num(m[1]) };
  if ((m = /^Group\s+([A-Z0-9]{1,2})\s*-\s*(\d+)/i.exec(r)))
    return { stage: 'GROUP_STAGE', label: stageLabel('GROUP_STAGE'), group: `Group ${m[1]?.toUpperCase()}`, matchday: num(m[2]) };
  if ((m = /^Group Stage\s*-\s*(\d+)/i.exec(r))) return { stage: 'GROUP_STAGE', label: stageLabel('GROUP_STAGE'), group: null, matchday: num(m[1]) };
  if ((m = /^League\s+([A-D])\s*-\s*(\d+)/i.exec(r))) return { stage: 'GROUP_STAGE', label: `League ${m[1]}`, group: `League ${m[1]}`, matchday: num(m[2]) };
  const ko: [RegExp, string][] = [
    [/^(Round of 16|8th Finals)/i, 'LAST_16'],
    [/^(Round of 32|16th Finals)/i, 'LAST_32'],
    [/^(Round of 64|32nd Finals)/i, 'LAST_64'],
    [/^Quarter-?finals/i, 'QUARTER_FINALS'],
    [/^Semi-?finals/i, 'SEMI_FINALS'],
    [/^3rd Place/i, 'THIRD_PLACE'],
    [/^Final$/i, 'FINAL'],
    [/Play-?offs?/i, 'PLAYOFFS'],
  ];
  for (const [re, stage] of ko) if (re.test(r)) return { stage, label: stageLabel(stage), group: null, matchday: null };
  if (/qualif|preliminary/i.test(r)) return { stage: 'QUALIFICATION', label: r, group: null, matchday: null };
  if (/^Friendlies/i.test(r)) return { stage: null, label: null, group: null, matchday: null };
  return { stage: null, label: r, group: null, matchday: null };
}

function pair(p: AfPair | null | undefined): ScorePair | null {
  if (!p || (p.home == null && p.away == null)) return null;
  return { home: p.home ?? null, away: p.away ?? null };
}

export function normalizeAfScore(f: AfFixture, status: MatchStatus): Score {
  const short = f.fixture.status?.short ?? '';
  const pens = pair(f.score?.penalty);
  const et = pair(f.score?.extratime);
  const duration: Score['duration'] = short === 'PEN' || short === 'P' || pens ? 'penalties' : short === 'AET' || short === 'ET' || short === 'BT' || et ? 'extra_time' : 'regular';
  const finished = status === 'finished' || status === 'awarded';
  const winner = f.teams.home.winner ? 'home' : f.teams.away.winner ? 'away' : finished && f.goals?.home != null ? 'draw' : null;
  return {
    home: f.goals?.home ?? null,
    away: f.goals?.away ?? null,
    halfTime: pair(f.score?.halftime),
    regularTime: duration === 'regular' ? null : pair(f.score?.fulltime),
    extraTime: duration === 'regular' ? null : et,
    penalties: duration === 'penalties' ? pens : null,
    winner,
    duration,
  };
}

function team(t: AfTeamLite, national: boolean): TeamRef {
  const name = t.name?.trim() || 'TBD';
  return { id: afId(t.id), name, shortName: name, tla: null, crest: t.logo || null, national, featuredTier: null, color: null };
}

function referee(raw: string | null | undefined) {
  if (!raw) return [];
  const [name, nationality] = raw.split(',').map((s) => s.trim());
  return name ? [{ name, role: 'referee' as const, nationality: nationality || null }] : [];
}

export function normalizeAfFixture(f: AfFixture, ctx: AfNormalizeContext, fallbackComp?: CompetitionConfig): Match | null {
  const comp = ctx.compForLeague(f.league.id) ?? fallbackComp;
  if (!comp) return null;
  const s = STATUS[f.fixture.status?.short ?? ''] ?? { status: 'scheduled' as const, phase: null, detail: null };
  const round = parseRound(f.league.round);
  const national = comp.category === 'international';
  const venue = [f.fixture.venue?.name, f.fixture.venue?.city].filter(Boolean).join(', ');
  const live = s.status === 'live' || s.status === 'paused';
  return {
    id: afId(f.fixture.id),
    source: 'api-football',
    competitionId: comp.id,
    competitionName: comp.shortName,
    season: f.league.season != null ? String(f.league.season) : null,
    utcDate: new Date(f.fixture.date).toISOString(),
    kickoffConfirmed: f.fixture.status?.short !== 'TBD',
    status: s.status,
    statusDetail: s.detail,
    livePhase: s.phase,
    minute: live ? (f.fixture.status?.elapsed ?? null) : null,
    injuryTime: live ? (f.fixture.status?.extra ?? null) : null,
    stage: round.stage,
    stageLabel: round.label,
    group: round.group,
    matchday: round.matchday,
    isKnockout: isKnockoutStage(round.stage),
    homeTeam: team(f.teams.home, national),
    awayTeam: team(f.teams.away, national),
    score: normalizeAfScore(f, s.status),
    venue: venue || null,
    referees: referee(f.fixture.referee),
    lastUpdated: null,
    scoreDelayed: false,
    rivalry: null,
  };
}

export function normalizeAfFixtures(items: AfFixture[], ctx: AfNormalizeContext, fallbackComp?: CompetitionConfig): Match[] {
  const out: Match[] = [];
  for (const f of items) {
    const m = normalizeAfFixture(f, ctx, fallbackComp);
    if (m) out.push(m);
  }
  return out.sort((a, b) => a.utcDate.localeCompare(b.utcDate) || a.id.localeCompare(b.id));
}

const POSITIONS: Record<string, string> = { G: 'Goalkeeper', D: 'Defender', M: 'Midfielder', F: 'Forward' };

function lineupPlayers(entries: AfLineup['startXI']): LineupPlayer[] {
  return (entries ?? [])
    .filter((e) => e.player?.name)
    .map((e) => ({
      id: e.player?.id != null ? afId(e.player.id) : null,
      name: e.player?.name ?? '',
      position: e.player?.pos ? (POSITIONS[e.player.pos] ?? e.player.pos) : null,
      shirtNumber: e.player?.number ?? null,
    }));
}

/**
 * Substitution events carry two players (`player`, `assist`) and the provider's
 * docs are not explicit about which one comes on. We decide from the lineups: a
 * player who started, or who came on earlier, is the one going off.
 */
export function resolveSubstitutions(f: AfFixture): Map<AfEvent, { on: string | null; off: string | null }> {
  const onPitch = new Set<number>();
  for (const l of f.lineups ?? []) for (const e of l.startXI ?? []) if (e.player?.id != null) onPitch.add(e.player.id);
  const result = new Map<AfEvent, { on: string | null; off: string | null }>();
  const subs = (f.events ?? [])
    .filter((e) => e.type?.toLowerCase() === 'subst')
    .sort((a, b) => (a.time?.elapsed ?? 0) - (b.time?.elapsed ?? 0) || (a.time?.extra ?? 0) - (b.time?.extra ?? 0));
  for (const e of subs) {
    const a = e.player;
    const b = e.assist;
    let on = a;
    let off = b;
    if (a?.id != null && onPitch.has(a.id) && !(b?.id != null && onPitch.has(b.id))) {
      on = b;
      off = a;
    }
    if (off?.id != null) onPitch.delete(off.id);
    if (on?.id != null) onPitch.add(on.id);
    result.set(e, { on: on?.name ?? null, off: off?.name ?? null });
  }
  return result;
}

function eventType(type: string, detail: string): MatchEvent['type'] | null {
  const t = type.toLowerCase();
  if (t === 'goal') {
    if (/missed/i.test(detail)) return 'missed_penalty';
    if (/own/i.test(detail)) return 'own_goal';
    if (/penalty/i.test(detail)) return 'penalty_goal';
    return 'goal';
  }
  if (t === 'card') {
    if (/second yellow/i.test(detail)) return 'second_yellow';
    if (/red/i.test(detail)) return 'red_card';
    return 'yellow_card';
  }
  if (t === 'subst') return 'substitution';
  if (t === 'var') return 'var';
  return null;
}

const STATS: [type: string, key: string, label: string, unit: MatchStat['unit']][] = [
  ['Ball Possession', 'ball_possession', 'Possession', '%'],
  ['Total Shots', 'shots', 'Shots', null],
  ['Shots on Goal', 'shots_on_goal', 'Shots on target', null],
  ['Corner Kicks', 'corner_kicks', 'Corners', null],
  ['Fouls', 'fouls', 'Fouls', null],
  ['Offsides', 'offsides', 'Offsides', null],
  ['Goalkeeper Saves', 'saves', 'Saves', null],
  ['Yellow Cards', 'yellow_cards', 'Yellow cards', null],
  ['Red Cards', 'red_cards', 'Red cards', null],
];

function statValue(v: number | string | null | undefined): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace('%', ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function normalizeAfFixtureDetail(f: AfFixture, ctx: AfNormalizeContext): MatchDetail | null {
  const base = normalizeAfFixture(f, ctx);
  if (!base) return null;
  const homeId = f.teams.home.id;
  const subs = resolveSubstitutions(f);

  const events: MatchEvent[] = [];
  for (const e of f.events ?? []) {
    if (/shootout/i.test(e.comments ?? '')) continue;
    const type = eventType(e.type ?? '', e.detail ?? '');
    if (!type) continue;
    const sub = subs.get(e);
    events.push({
      minute: e.time?.elapsed ?? 0,
      injuryTime: e.time?.extra ?? null,
      type,
      side: e.team?.id === homeId ? 'home' : 'away',
      player: sub ? sub.on : (e.player?.name ?? null),
      secondaryPlayer: sub ? sub.off : (e.assist?.name ?? null),
      score: null,
      detail: type === 'var' ? (e.detail ?? null) : null,
    });
  }

  const lineupFor = (teamId: number) => f.lineups?.find((l) => l.team?.id === teamId);
  const hl = lineupFor(homeId);
  const al = lineupFor(f.teams.away.id);
  const toLineup = (l: AfLineup | undefined) => ({
    formation: l?.formation ?? null,
    coach: l?.coach?.name ?? null,
    startingXI: lineupPlayers(l?.startXI),
    bench: lineupPlayers(l?.substitutes),
  });

  const statsFor = (teamId: number) => f.statistics?.find((s) => s.team?.id === teamId)?.statistics ?? null;
  const hs = statsFor(homeId);
  const as = statsFor(f.teams.away.id);
  const statistics: MatchStat[] =
    hs || as
      ? STATS.map(([type, key, label, unit]) => ({
          key,
          label,
          unit,
          home: statValue(hs?.find((s) => s.type === type)?.value),
          away: statValue(as?.find((s) => s.type === type)?.value),
        })).filter((s) => s.home !== null || s.away !== null)
      : [];

  return {
    ...base,
    attendance: null,
    events: sortEvents(events),
    lineups: (hl?.startXI?.length ?? 0) > 0 || (al?.startXI?.length ?? 0) > 0 ? { home: toLineup(hl), away: toLineup(al) } : null,
    statistics,
    headToHead: null,
    positions: null,
  };
}

export function normalizeAfHeadToHead(items: AfFixture[], ctx: AfNormalizeContext, current: Match, fallbackComp?: CompetitionConfig): HeadToHead | null {
  const all = normalizeAfFixtures(items, ctx, fallbackComp).filter((m) => m.id !== current.id && m.status === 'finished');
  if (all.length === 0) return null;
  let homeWins = 0;
  let awayWins = 0;
  let draws = 0;
  let goals = 0;
  for (const m of all) {
    const h = m.score.home ?? 0;
    const a = m.score.away ?? 0;
    goals += h + a;
    const currentHomeWasHome = m.homeTeam.id === current.homeTeam.id;
    const winner = m.score.winner;
    if (winner === 'draw' || (winner === null && h === a)) draws++;
    else if ((winner === 'home') === currentHomeWasHome) homeWins++;
    else awayWins++;
  }
  return {
    numberOfMatches: all.length,
    totalGoals: goals,
    homeWins,
    awayWins,
    draws,
    recent: [...all].sort((a, b) => b.utcDate.localeCompare(a.utcDate)).slice(0, 5),
  };
}

/** Zone from API-Football's free-text description, used when the registry has no zones. */
export function zoneFromDescription(description: string | null | undefined): ZoneId | null {
  const d = description ?? '';
  if (!d) return null;
  if (/champions league/i.test(d)) return 'ucl';
  if (/europa league/i.test(d)) return 'uel';
  if (/conference league/i.test(d)) return 'uecl';
  if (/libertadores/i.test(d)) return 'libertadores';
  if (/sudamericana/i.test(d)) return 'sudamericana';
  if (/relegation/i.test(d)) return /play-?off/i.test(d) ? 'relegation_playoff' : 'relegation';
  if (/promotion/i.test(d)) return /play-?off/i.test(d) ? 'promotion_playoff' : 'promotion';
  if (/play-?off/i.test(d)) return 'knockout_playoff';
  if (/round of|next round|knockout|qualif|final/i.test(d)) return 'qualified';
  return null;
}

export function normalizeAfStandings(items: AfStandingsItem[], comp: CompetitionConfig): Standings {
  const league = items[0]?.league;
  const tables = league?.standings ?? [];
  const national = comp.category === 'international';
  const groups: StandingGroup[] = tables
    .map((rows) => {
      const groupName = rows[0]?.group ?? null;
      return {
        name: tables.length > 1 ? groupName : null,
        stage: null,
        rows: rows.map((r, i) => {
          const position = r.rank ?? i + 1;
          const gf = r.all?.goals?.for ?? 0;
          const ga = r.all?.goals?.against ?? 0;
          return {
            position,
            team: team({ id: r.team?.id ?? 0, name: r.team?.name ?? null, logo: r.team?.logo ?? null }, national),
            played: r.all?.played ?? 0,
            won: r.all?.win ?? 0,
            draw: r.all?.draw ?? 0,
            lost: r.all?.lose ?? 0,
            goalsFor: gf,
            goalsAgainst: ga,
            goalDifference: r.goalsDiff ?? gf - ga,
            points: r.points ?? 0,
            form: (r.form ?? '').split('').filter((c): c is FormResult => c === 'W' || c === 'D' || c === 'L'),
            zone: comp.zones.length > 0 ? zoneFor(position, comp.zones) : zoneFromDescription(r.description),
          };
        }),
      };
    })
    .filter((g) => g.rows.length > 0);
  return { competitionId: comp.id, season: league?.season != null ? String(league.season) : null, groups, zones: comp.zones };
}

export function normalizeAfScorers(items: AfTopScorer[], comp: CompetitionConfig): Scorer[] {
  const national = comp.category === 'international';
  return items
    .filter((s) => s.player?.name)
    .map((s) => {
      const st = s.statistics?.[0];
      return {
        player: {
          id: s.player?.id != null ? afId(s.player.id) : 'af-0',
          name: s.player?.name ?? 'Unknown',
          position: st?.games?.position ?? null,
          nationality: s.player?.nationality ?? null,
          dateOfBirth: s.player?.birth?.date ?? null,
          shirtNumber: null,
        },
        team: team({ id: st?.team?.id ?? 0, name: st?.team?.name ?? null, logo: st?.team?.logo ?? null }, national),
        goals: st?.goals?.total ?? 0,
        assists: st?.goals?.assists ?? null,
        penalties: st?.penalty?.scored ?? null,
        playedMatches: st?.games?.appearences ?? null,
      };
    });
}

export function normalizeAfTeam(item: AfTeamItem) {
  const t = item.team;
  const national = t?.national ?? false;
  const ref = team({ id: t?.id ?? 0, name: t?.name ?? null, logo: t?.logo ?? null }, national);
  return {
    team: { ...ref, tla: t?.code ?? null },
    area: t?.country ?? null,
    founded: t?.founded ?? null,
    venue: [item.venue?.name, item.venue?.city].filter(Boolean).join(', ') || null,
    clubColors: null,
    website: null,
    coach: null,
    competitions: [],
    squad: [],
  };
}

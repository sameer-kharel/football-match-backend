import { describe, expect, it } from 'vitest';
import { competitionById, competitionByFootballDataCode } from '../src/config/competitions.js';
import {
  normalizeHeadToHead,
  normalizeMatch,
  normalizeMatchDetail,
  normalizeMatchList,
  normalizeScore,
  normalizeScorers,
  normalizeStandings,
} from '../src/providers/football-data/normalize.js';
import type { FdHead2HeadResponse, FdMatch, FdScorersResponse, FdStandingsResponse } from '../src/providers/football-data/raw.js';
import { fixture } from './helpers.js';

const ctx = { byCode: competitionByFootballDataCode, delayed: true };

describe('football-data match normalization', () => {
  it('maps the documented match sample into the internal schema', () => {
    const d = normalizeMatchDetail(fixture<FdMatch>('fd/match-330299.json'), ctx)!;
    expect(d.id).toBe('fd-330299');
    expect(d.source).toBe('football-data');
    expect(d.competitionId).toBe('FL1');
    expect(d.season).toBe('2021/22');
    expect(d.status).toBe('finished');
    expect(d.minute).toBeNull();
    expect(d.homeTeam).toMatchObject({ id: 'fd-531', name: 'ES Troyes AC', shortName: 'Troyes', tla: 'ETR', national: false });
    expect(d.score).toMatchObject({ home: 1, away: 1, halfTime: { home: 0, away: 1 }, winner: 'draw', duration: 'regular', penalties: null });
    expect(d.venue).toBe("Stade de l'Aube");
    expect(d.attendance).toBe(16871);
    expect(d.referees.map((r) => r.role)).toEqual(['assistant', 'referee', 'var']);
    expect(d.scoreDelayed).toBe(true);
  });

  it('builds an ordered timeline from goals, bookings and substitutions', () => {
    const d = normalizeMatchDetail(fixture<FdMatch>('fd/match-330299.json'), ctx)!;
    expect(d.events.map((e) => [e.minute, e.type, e.side])).toEqual([
      [11, 'yellow_card', 'away'],
      [28, 'penalty_goal', 'away'],
      [36, 'yellow_card', 'home'],
      [57, 'substitution', 'away'],
      [58, 'substitution', 'home'],
      [90, 'goal', 'home'],
    ]);
    const sub = d.events.find((e) => e.type === 'substitution' && e.side === 'home')!;
    expect(sub.player).toBe('Lebo Mothiba');
    expect(sub.secondaryPlayer).toBe('Iké Ugbo');
    expect(d.events.at(-1)).toMatchObject({ player: 'Yoann Touzghar', secondaryPlayer: 'Youssouf Koné', score: { home: 1, away: 1 } });
  });

  it('keeps lineups and curated statistics when present', () => {
    const d = normalizeMatchDetail(fixture<FdMatch>('fd/match-330299.json'), ctx)!;
    expect(d.lineups?.home.formation).toBe('3-4-1-2');
    expect(d.lineups?.home.coach).toBe('Bruno Irles');
    expect(d.lineups?.away.startingXI[1]).toEqual({ id: 'fd-8360', name: 'Dimitri Payet', position: 'Attacking Midfield', shirtNumber: 10 });
    const possession = d.statistics.find((s) => s.key === 'ball_possession');
    expect(possession).toEqual({ key: 'ball_possession', label: 'Possession', unit: '%', home: 41, away: 59 });
    expect(d.statistics.some((s) => s.key === 'throw_ins')).toBe(false);
  });

  it('returns empty sections, not errors, for free-tier payloads without lineups or events', () => {
    const d = normalizeMatchDetail(fixture<FdMatch>('fd/match-330299-free.json'), ctx)!;
    expect(d.events).toEqual([]);
    expect(d.lineups).toBeNull();
    expect(d.statistics).toEqual([]);
    expect(d.referees).toEqual([]);
  });

  it('separates the shootout from the match score', () => {
    const m = normalizeMatch(fixture<FdMatch>('fd/match-penalties.json'), ctx)!;
    expect(m.competitionId).toBe('WC');
    expect(m.homeTeam.national).toBe(true);
    expect(m.isKnockout).toBe(true);
    expect(m.stageLabel).toBe('Final');
    expect(m.score).toEqual({
      home: 3,
      away: 3,
      halfTime: { home: 2, away: 0 },
      regularTime: { home: 2, away: 2 },
      extraTime: { home: 1, away: 1 },
      penalties: { home: 4, away: 2 },
      winner: 'home',
      duration: 'penalties',
    });
  });

  it('handles extra time with legacy homeTeam/awayTeam keys and no regularTime node', () => {
    const m = normalizeMatch(fixture<FdMatch>('fd/match-extra-time.json'), ctx)!;
    expect(m.score.home).toBe(1);
    expect(m.score.away).toBe(2);
    expect(m.score.duration).toBe('extra_time');
    expect(m.score.extraTime).toEqual({ home: 0, away: 1 });
    expect(m.score.regularTime).toEqual({ home: 1, away: 1 });
    expect(m.stageLabel).toBe('Quarter-finals');
  });

  it('derives the shootout-free score from fullTime when regularTime is missing', () => {
    const s = normalizeScore({ duration: 'PENALTY_SHOOTOUT', fullTime: { home: 6, away: 5 }, penalties: { home: 5, away: 4 } });
    expect([s.home, s.away]).toEqual([1, 1]);
  });

  it('maps statuses and live phases', () => {
    const list = normalizeMatchList(fixture('fd/matches-2026-10-18.json'), ctx);
    const inter = list.find((m) => m.id === 'fd-540001')!;
    expect(inter.status).toBe('live');
    expect(inter.livePhase).toBe('second_half');
    expect(inter.minute).toBe(67);
    const ars = list.find((m) => m.id === 'fd-540003')!;
    expect(ars.status).toBe('scheduled');
    expect(ars.kickoffConfirmed).toBe(true);
    expect(ars.score.home).toBeNull();
    const pp = normalizeMatchList(fixture('fd/matches-2026-10-19.json'), ctx)[0]!;
    expect(pp.status).toBe('postponed');
  });

  it('drops matches from competitions outside the registry, sorted by kickoff', () => {
    const list = normalizeMatchList(fixture('fd/matches-2026-10-18.json'), ctx);
    expect(list.map((m) => m.id)).toEqual(['fd-540001', 'fd-540002', 'fd-540003', 'fd-540004']);
  });

  it('never crashes on sparse payloads', () => {
    const sparse = { id: 1, utcDate: '2026-10-18T12:00:00Z', status: 'WHATEVER', competition: { code: 'PL' }, homeTeam: {}, awayTeam: { id: 2 } } as FdMatch;
    const m = normalizeMatchDetail(sparse, ctx)!;
    expect(m.status).toBe('scheduled');
    expect(m.homeTeam.name).toBe('TBD');
    expect(m.score.home).toBeNull();
    expect(m.events).toEqual([]);
  });
});

describe('football-data standings, scorers and head-to-head', () => {
  it('keeps only TOTAL tables and assigns zones from the registry', () => {
    const s = normalizeStandings(fixture<FdStandingsResponse>('fd/standings-PD.json'), competitionById('PD')!);
    expect(s.groups).toHaveLength(1);
    const rows = s.groups[0]!.rows;
    expect(rows[0]).toMatchObject({ position: 1, points: 81, goalDifference: 44, form: ['W', 'W', 'W', 'W', 'W'], zone: 'ucl' });
    expect(rows.find((r) => r.position === 5)?.zone).toBe('uel');
    expect(rows.find((r) => r.position === 18)).toMatchObject({ zone: 'relegation', form: [] });
    expect(s.season).toBe('2021/22');
  });

  it('gives a league table no group heading, even when football-data calls its group "Matchday"', () => {
    const raw = fixture<FdStandingsResponse>('fd/standings-PD.json');
    const relabelled = { ...raw, standings: (raw.standings ?? []).map((t) => ({ ...t, group: 'Matchday' })) };
    expect(normalizeStandings(relabelled, competitionById('PD')!).groups.map((g) => g.name)).toEqual([null]);
  });

  it('labels tournament groups and applies per-group zones', () => {
    const s = normalizeStandings(fixture<FdStandingsResponse>('fd/standings-WC.json'), competitionById('WC')!);
    expect(s.groups.map((g) => g.name)).toEqual(['Group A', 'Group B']);
    expect(s.groups[1]!.rows.map((r) => r.zone)).toEqual(['qualified', 'qualified', 'knockout_playoff', null]);
    expect(s.groups[0]!.rows[0]!.team.national).toBe(true);
  });

  it('maps scorers and skips entries without a player', () => {
    const list = normalizeScorers(fixture<FdScorersResponse>('fd/scorers-SA.json'), competitionById('SA')!);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ goals: 29, assists: 3, penalties: 6, player: { id: 'fd-44', name: 'Cristiano Ronaldo', nationality: 'Portugal' } });
    expect(list[1]).toMatchObject({ assists: null, playedMatches: 36 });
  });

  it('summarizes head-to-head and keeps meetings from other competitions', () => {
    const current = normalizeMatchList(fixture('fd/matches-2026-10-18.json'), ctx).find((m) => m.id === 'fd-540003')!;
    const h = normalizeHeadToHead(fixture<FdHead2HeadResponse>('fd/h2h-540003.json'), ctx, current)!;
    expect(h).toMatchObject({ numberOfMatches: 3, totalGoals: 7, homeWins: 1, awayWins: 1, draws: 1 });
    expect(h.recent.map((m) => m.id)).toEqual(['fd-500001', 'fd-500002', 'fd-500003']);
    expect(h.recent[2]).toMatchObject({ competitionId: 'FAC', competitionName: 'FA Cup' });
  });

  it("counts head-to-head itself rather than trusting football-data's aggregates", () => {
    const current = normalizeMatchList(fixture('fd/matches-2026-10-18.json'), ctx).find((m) => m.id === 'fd-540003')!;
    const raw = fixture<FdHead2HeadResponse>('fd/h2h-540003.json');
    // What football-data sent for Bayern–Dortmund: no wins for either side, whatever the results.
    const broken = { ...raw, aggregates: { numberOfMatches: 10, totalGoals: 37, homeTeam: { id: 57, wins: 0, draws: 3, losses: 0 }, awayTeam: { id: 65, wins: 0, draws: 3, losses: 0 } } };
    expect(normalizeHeadToHead(broken as FdHead2HeadResponse, ctx, current)).toMatchObject({ numberOfMatches: 3, totalGoals: 7, homeWins: 1, awayWins: 1, draws: 1 });
  });
});

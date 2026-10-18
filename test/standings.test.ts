import { describe, expect, it } from 'vitest';
import { computeGroupStandings } from '../src/domain/standings.js';
import type { Match } from '../src/domain/types.js';

const team = (id: string) => ({ id, name: id, shortName: id, tla: null, crest: null, national: true, featuredTier: null, color: null });

function m(id: string, group: string, home: string, away: string, h: number | null, a: number | null, day: number): Match {
  return {
    id,
    source: 'football-data',
    competitionId: 'WC',
    competitionName: 'World Cup',
    season: '2026',
    utcDate: `2026-06-${String(10 + day).padStart(2, '0')}T18:00:00.000Z`,
    kickoffConfirmed: true,
    status: h === null ? 'scheduled' : 'finished',
    statusDetail: null,
    livePhase: null,
    minute: null,
    injuryTime: null,
    stage: 'GROUP_STAGE',
    stageLabel: 'Group stage',
    group,
    matchday: day,
    isKnockout: false,
    homeTeam: team(home),
    awayTeam: team(away),
    score: { home: h, away: a, halfTime: null, regularTime: null, extraTime: null, penalties: null, winner: null, duration: 'regular' },
    venue: null,
    referees: [],
    lastUpdated: null,
    scoreDelayed: false,
    rivalry: null,
  };
}

describe('computeGroupStandings', () => {
  const zones = [{ zone: 'qualified' as const, from: 1, to: 2, label: 'Round of 32' }];
  const matches = [
    m('1', 'Group A', 'MEX', 'RSA', 2, 0, 1),
    m('2', 'Group A', 'KOR', 'CZE', 1, 1, 1),
    m('3', 'Group A', 'MEX', 'KOR', 0, 1, 2),
    m('4', 'Group A', 'CZE', 'RSA', 3, 0, 2),
    m('5', 'Group B', 'ENG', 'CAN', null, null, 3),
    { ...m('6', 'x', 'A', 'B', 9, 0, 1), stage: 'LAST_32', group: null },
  ];

  it('builds one table per group from finished group matches only', () => {
    const groups = computeGroupStandings(matches, zones);
    expect(groups.map((g) => g.name)).toEqual(['Group A', 'Group B']);
    const a = groups[0]!.rows;
    // KOR 4 pts (+1), CZE 4 pts (+3), MEX 3 pts (+1), RSA 0
    expect(a.map((r) => [r.team.id, r.points, r.goalDifference])).toEqual([
      ['CZE', 4, 3],
      ['KOR', 4, 1],
      ['MEX', 3, 1],
      ['RSA', 0, -5],
    ]);
    expect(a.map((r) => r.zone)).toEqual(['qualified', 'qualified', null, null]);
    expect(a.find((r) => r.team.id === 'MEX')!.form).toEqual(['W', 'L']);
  });

  it('lists teams of unplayed groups with zero rows of stats', () => {
    const b = computeGroupStandings(matches, zones)[1]!;
    expect(b.rows.map((r) => [r.team.id, r.played, r.points])).toEqual([
      ['CAN', 0, 0],
      ['ENG', 0, 0],
    ]);
  });

  it('returns nothing for a league without groups', () => {
    expect(computeGroupStandings([{ ...matches[0]!, stage: 'REGULAR_SEASON', group: null }], zones)).toEqual([]);
  });
});

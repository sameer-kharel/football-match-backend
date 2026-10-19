import { describe, expect, it } from 'vitest';
import { competitionById } from '../src/config/competitions.js';
import {
  normalizeOlDetail,
  normalizeOlMatch,
  normalizeOlScore,
  normalizeOlSeason,
  normalizeOlTable,
  olCrest,
  olScorers,
  olStatus,
  roundInfo,
} from '../src/providers/openligadb/normalize.js';
import { olSeasonYear } from '../src/providers/openligadb/provider.js';
import type { OlMatch, OlSeason, OlTableRow } from '../src/providers/openligadb/raw.js';
import { liveMatchdays } from '../src/services/openligadb.js';
import { NOW, fixture } from './helpers.js';

// Fixtures are trimmed real responses from api.openligadb.de (ODbL 1.0).
const BL1 = competitionById('BL1')!;
const DFB = competitionById('DFB')!;
const season = (shortcut: string, file: string, year = 2026): OlSeason => ({ shortcut, season: year, matches: fixture<OlMatch[]>(file) });
const bl1 = season('bl1', 'ol/bl1-2026.json');
const dfb = season('dfb', 'ol/dfb-2026.json');
const raw = (s: OlSeason, id: number) => s.matches.find((m) => m.matchID === id)!;

describe('OpenLigaDB matches', () => {
  it('maps a finished league match with its goals', () => {
    const m = normalizeOlDetail(raw(bl1, 83201), BL1, NOW, roundInfo(bl1.matches));
    expect(m).toMatchObject({
      id: 'ol-83201',
      source: 'openligadb',
      competitionId: 'BL1',
      season: '2026/27',
      utcDate: '2026-10-17T16:30:00.000Z',
      status: 'finished',
      stage: 'REGULAR_SEASON',
      matchday: 6,
      isKnockout: false,
      kickoffConfirmed: true,
      scoreDelayed: false,
    });
    expect(m.homeTeam).toMatchObject({ id: 'ol-40', name: 'FC Bayern München', shortName: 'Bayern', national: false });
    expect(m.score).toMatchObject({ home: 6, away: 1, halfTime: { home: 3, away: 0 }, winner: 'home', duration: 'regular', penalties: null });
    expect(m.events.map((e) => [e.minute, e.side, e.type, e.player])).toEqual([
      [12, 'home', 'goal', 'Luis Díaz'],
      [26, 'home', 'goal', 'Aleksandar Pavlovic'],
      [34, 'home', 'goal', 'M. Olise'],
      [47, 'home', 'goal', 'Luis Díaz'],
      [53, 'home', 'goal', 'H. Kane'],
      [69, 'home', 'goal', 'Luis Díaz'],
      [91, 'away', 'goal', 'A. Maksimovic'],
    ]);
    expect(m.events[6]?.score).toEqual({ home: 6, away: 1 });
  });

  it('serves Wikimedia SVG crests as PNG renderings, and only over https', () => {
    expect(olCrest('https://upload.wikimedia.org/wikipedia/commons/1/1f/Logo_FC_Bayern_M%C3%BCnchen_%282002%E2%80%932017%29.svg')).toBe(
      'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1f/Logo_FC_Bayern_M%C3%BCnchen_%282002%E2%80%932017%29.svg/120px-Logo_FC_Bayern_M%C3%BCnchen_%282002%E2%80%932017%29.svg.png',
    );
    expect(olCrest('https://upload.wikimedia.org/wikipedia/de/a/ab/Logo.svg')).toBe('https://upload.wikimedia.org/wikipedia/de/thumb/a/ab/Logo.svg/120px-Logo.svg.png');
    expect(olCrest('https://upload.wikimedia.org/wikipedia/commons/thumb/e/e1/Logo_SG_Dynamo_Dresden_neu.svg/960px-Logo_SG_Dynamo_Dresden_neu.svg.png')).toBe(
      'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e1/Logo_SG_Dynamo_Dresden_neu.svg/120px-Logo_SG_Dynamo_Dresden_neu.svg.png',
    );
    expect(olCrest('http://i.imgur.com/Rpwsjz1.png')).toBe('https://i.imgur.com/Rpwsjz1.png');
    expect(olCrest('')).toBeNull();
    expect(olCrest('ftp://example.com/x.png')).toBeNull();
  });

  it('marks placeholder matchdays (every match at one time) as unconfirmed, but not the last matchday', () => {
    const matches = normalizeOlSeason(bl1, BL1, NOW);
    const confirmed = (day: number) => [...new Set(matches.filter((m) => m.matchday === day).map((m) => m.kickoffConfirmed))];
    expect(confirmed(7)).toEqual([true]);
    expect(confirmed(20)).toEqual([false]);
    expect(confirmed(34)).toEqual([true]); // simultaneous kick-offs by rule
  });

  it('infers live from kickoff time, scoring from goals entered before the result rows', () => {
    const base = raw(bl1, 83212);
    const kickoff = Date.parse(base.matchDateTimeUTC);
    const live: OlMatch = {
      ...base,
      matchIsFinished: false,
      matchResults: [],
      goals: [{ scoreTeam1: 0, scoreTeam2: 1, matchMinute: 20, goalGetterName: 'T. Scorer', isPenalty: false, isOwnGoal: false }],
    };
    expect(olStatus(live, kickoff - 1)).toBe('scheduled');
    expect(olStatus(live, kickoff + 30 * 60_000)).toBe('live');
    expect(normalizeOlScore(live, 'live')).toMatchObject({ home: 0, away: 1, winner: null });
    // Hours later and still open: finished if a result was entered, otherwise unknown.
    expect(olStatus(live, kickoff + 4 * 3_600_000)).toBe('scheduled');
    expect(olStatus({ ...live, matchResults: [{ resultTypeID: 2, pointsTeam1: 0, pointsTeam2: 1 }] }, kickoff + 4 * 3_600_000)).toBe('finished');
    expect(normalizeOlMatch(base, BL1, kickoff - 1).score).toMatchObject({ home: null, away: null });
  });

  it('credits an own goal to the side whose score went up', () => {
    const m: OlMatch = {
      ...raw(bl1, 83201),
      goals: [
        { scoreTeam1: 0, scoreTeam2: 1, matchMinute: 5, goalGetterName: 'Home Defender', isOwnGoal: true },
        { scoreTeam1: 1, scoreTeam2: 1, matchMinute: 60, goalGetterName: 'Home Striker', isPenalty: true },
      ],
      matchResults: [{ resultTypeID: 2, pointsTeam1: 1, pointsTeam2: 1 }],
    };
    const d = normalizeOlDetail(m, BL1, NOW);
    expect(d.events.map((e) => [e.side, e.type])).toEqual([
      ['away', 'own_goal'],
      ['home', 'penalty_goal'],
    ]);
    const scorers = olScorers({ shortcut: 'bl1', season: 2026, matches: [m] }, 10);
    expect(scorers.map((s) => [s.player.name, s.goals, s.penalties, s.team.id])).toEqual([['Home Striker', 1, 1, 'ol-40']]);
  });
});

describe('OpenLigaDB cups', () => {
  it('names numbered rounds by their size and treats every cup match as a knockout', () => {
    const matches = normalizeOlSeason(dfb, DFB, NOW);
    expect([...new Set(matches.map((m) => `${m.stage}|${m.stageLabel}`))]).toEqual(['LAST_64|Round of 64', 'LAST_32|Round of 32']);
    expect(matches.every((m) => m.isKnockout && m.matchday === null)).toBe(true);
  });

  it('reads extra time over a separate 90-minute row', () => {
    const s = normalizeOlScore(raw(dfb, 81859), 'finished');
    expect(s).toEqual({
      home: 0,
      away: 1,
      halfTime: { home: 0, away: 0 },
      regularTime: { home: 0, away: 0 },
      extraTime: { home: 0, away: 1 },
      penalties: null,
      winner: 'away',
      duration: 'extra_time',
    });
  });

  it('subtracts the match score from the cumulative shootout row', () => {
    const s = normalizeOlScore(raw(dfb, 81849), 'finished');
    expect(s).toMatchObject({ home: 1, away: 1, regularTime: { home: 1, away: 1 }, extraTime: { home: 0, away: 0 }, penalties: { home: 2, away: 4 }, winner: 'away', duration: 'penalties' });
    // Shootout kicks are not match events.
    expect(normalizeOlDetail(raw(dfb, 81849), DFB, NOW).events.map((e) => e.minute)).toEqual([69, 92]);
  });

  it('reads older seasons that put the extra-time score in the 90-minute row', () => {
    const old = season('dfb', 'ol/dfb-2025-extra-time.json', 2025);
    const s = normalizeOlScore(raw(old, 77190), 'finished');
    expect(s).toMatchObject({ home: 1, away: 3, duration: 'extra_time', regularTime: null, extraTime: null, winner: 'away' });
  });
});

describe('OpenLigaDB tables and scorers', () => {
  it('builds the table with zones and form from the season results', () => {
    const t = normalizeOlTable(fixture<OlTableRow[]>('ol/table-bl1-2026.json'), bl1, BL1, NOW);
    const rows = t.groups[0]!.rows;
    expect(t.season).toBe('2026/27');
    expect(rows).toHaveLength(18);
    expect(rows[0]).toMatchObject({ position: 1, team: { id: 'ol-40', shortName: 'Bayern' }, points: 14, played: 6, zone: 'ucl' });
    expect(rows[0]!.form).toEqual(['W']); // only matchday 6 is finished in the fixture
    expect(rows[15]!.zone).toBe('relegation_playoff');
    expect(rows[17]!.zone).toBe('relegation');
  });

  it('counts scorers from goals, with their current team', () => {
    const top = olScorers(bl1, 3);
    expect(top[0]).toMatchObject({ player: { name: 'Luis Díaz' }, team: { id: 'ol-40' }, goals: 3, penalties: 0, assists: null });
  });
});

describe('OpenLigaDB seasons', () => {
  it('names the season by its first year, switching in July', () => {
    expect(olSeasonYear(Date.parse('2026-10-18T00:00:00Z'))).toBe(2026);
    expect(olSeasonYear(Date.parse('2027-05-30T00:00:00Z'))).toBe(2026);
    expect(olSeasonYear(Date.parse('2027-07-01T00:00:00Z'))).toBe(2027);
  });

  it('refetches only matchdays with an unfinished match from the last 12 hours or the next hour', () => {
    const kickoff = Date.parse(raw(bl1, 83212).matchDateTimeUTC);
    expect(liveMatchdays(bl1, NOW)).toEqual([]);
    expect(liveMatchdays(bl1, kickoff + 60_000)).toEqual([7]);
    expect(liveMatchdays(bl1, kickoff - 2 * 3_600_000)).toEqual([]);
  });
});

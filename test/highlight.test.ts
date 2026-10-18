import { describe, expect, it } from 'vitest';
import { competitionById } from '../src/config/competitions.js';
import type { HighlightContext, PinSet } from '../src/domain/highlight.js';
import { WEIGHTS, rankMatches, scoreMatch, tierPairScore } from '../src/domain/highlight.js';
import type { FeaturedTier, Match } from '../src/domain/types.js';

const TODAY = { todayStartMs: Date.parse('2026-10-18T00:00:00Z'), todayEndMs: Date.parse('2026-10-19T00:00:00Z') };

function match(id: string, home: FeaturedTier | null, away: FeaturedTier | null, over: Partial<Match> = {}): Match {
  const team = (tid: string, tier: FeaturedTier | null) => ({ id: tid, name: tid, shortName: tid, tla: null, crest: null, national: false, featuredTier: tier, color: null });
  return {
    id,
    source: 'football-data',
    competitionId: 'PL',
    competitionName: 'Premier League',
    season: '2026/27',
    utcDate: '2026-10-21T19:00:00.000Z',
    kickoffConfirmed: true,
    status: 'scheduled',
    statusDetail: null,
    livePhase: null,
    minute: null,
    injuryTime: null,
    stage: 'REGULAR_SEASON',
    stageLabel: null,
    group: null,
    matchday: 9,
    isKnockout: false,
    homeTeam: team(`${id}-h`, home),
    awayTeam: team(`${id}-a`, away),
    score: { home: null, away: null, halfTime: null, regularTime: null, extraTime: null, penalties: null, winner: null, duration: 'regular' },
    venue: null,
    referees: [],
    lastUpdated: null,
    scoreDelayed: false,
    rivalry: null,
    ...over,
  };
}

const ctx: HighlightContext = { ...TODAY, competitionBonus: (id) => competitionById(id)?.highlightBonus };

describe('tierPairScore', () => {
  it.each([
    [1, 1, 100],
    [1, 2, 70],
    [3, 1, 70],
    [1, null, 50],
    [2, null, 30],
    [2, 2, 60],
    [2, 3, 45],
    [3, null, 15],
    [3, 3, 30],
    [null, null, 0],
  ] as const)('tier %s vs %s = %s', (a, b, expected) => {
    expect(tierPairScore(a, b)).toBe(expected);
  });
});

describe('scoreMatch', () => {
  it('adds the Champions League knockout bonus', () => {
    const m = match('x', 1, 2, { competitionId: 'UCL', isKnockout: true });
    expect(scoreMatch(m, ctx).score).toBe(70 + 40);
    expect(scoreMatch({ ...m, isKnockout: false }, ctx).score).toBe(70 + 20);
  });

  it('adds World Cup knockout weight for national teams', () => {
    const m = match('wc', 1, 1, { competitionId: 'WC', isKnockout: true, stage: 'SEMI_FINALS' });
    expect(scoreMatch(m, ctx).score).toBe(100 + 40);
  });

  it('adds the rivalry bonus and +10 for today or live, once', () => {
    const clasico = match('c', 1, 1, { competitionId: 'PD', rivalry: 'El Clásico', utcDate: '2026-10-18T19:00:00.000Z' });
    expect(scoreMatch(clasico, ctx)).toMatchObject({ score: 100 + WEIGHTS.rivalry + WEIGHTS.liveOrToday, live: false });
    const live = { ...clasico, status: 'live' as const };
    expect(scoreMatch(live, ctx)).toMatchObject({ score: 135, live: true });
  });

  it('flags pinned matches by match, team or competition', () => {
    const pins: PinSet = { teams: new Set(['p-h']), matches: new Set(['m2']), competitions: new Set(['SA']) };
    const c = { ...ctx, pins };
    expect(scoreMatch(match('p', null, null), c).pinned).toBe(true);
    expect(scoreMatch(match('m2', null, null), c).pinned).toBe(true);
    expect(scoreMatch(match('q', null, null, { competitionId: 'SA' }), c).pinned).toBe(true);
    expect(scoreMatch(match('r', 1, 1), c).pinned).toBe(false);
  });
});

describe('rankMatches', () => {
  it('puts pinned first (live pinned at the very top), then score, then kickoff', () => {
    const pins: PinSet = { teams: new Set(['quiet-h', 'livepin-h']), matches: new Set(), competitions: new Set() };
    const list = [
      match('big', 1, 1, { utcDate: '2026-10-20T19:00:00.000Z' }),
      match('quiet', null, null, { utcDate: '2026-10-19T12:00:00.000Z' }),
      match('mid-late', 2, 2, { utcDate: '2026-10-22T19:00:00.000Z' }),
      match('mid-early', 2, 2, { utcDate: '2026-10-21T19:00:00.000Z' }),
      match('livepin', null, null, { status: 'live', utcDate: '2026-10-18T10:00:00.000Z' }),
      match('nobody', null, null),
    ];
    const ranked = rankMatches(list, { ...ctx, pins }, { minScore: 10 });
    expect(ranked.map((m) => m.id)).toEqual(['livepin', 'quiet', 'big', 'mid-early', 'mid-late']);
    expect(ranked[2]!.highlightScore).toBe(100);
  });

  it('orders pinned matches by how directly they are pinned', () => {
    const pins: PinSet = { teams: new Set(['t-h']), matches: new Set(['m']), competitions: new Set(['PL']) };
    const list = [match('c', null, null, { utcDate: '2026-10-19T10:00:00.000Z' }), match('t', null, null), match('m', null, null, { utcDate: '2026-10-25T10:00:00.000Z' })];
    expect(rankMatches(list, { ...ctx, pins }).map((m) => m.id)).toEqual(['m', 't', 'c']);
  });

  it('is deterministic for ties', () => {
    const a = match('a', 2, null);
    const b = match('b', 2, null);
    expect(rankMatches([b, a], ctx).map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('respects the limit', () => {
    const list = Array.from({ length: 10 }, (_, i) => match(`m${i}`, 1, null));
    expect(rankMatches(list, ctx, { limit: 3 })).toHaveLength(3);
  });
});

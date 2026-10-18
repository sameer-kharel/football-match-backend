import { describe, expect, it } from 'vitest';
import type { CompetitionConfig } from '../src/config/competitions.js';
import { competitionById } from '../src/config/competitions.js';
import { UpstreamBudget } from '../src/lib/budget.js';
import { PlanRestrictedError, UpstreamRateLimitedError } from '../src/lib/errors.js';
import { silentLogger } from '../src/lib/logger.js';
import { MemoryStore } from '../src/lib/store.js';
import {
  normalizeAfFixtureDetail,
  normalizeAfFixtures,
  normalizeAfScorers,
  normalizeAfStandings,
  parseRound,
  zoneFromDescription,
} from '../src/providers/api-football/normalize.js';
import { ApiFootballProvider } from '../src/providers/api-football/provider.js';
import type { AfEnvelope, AfFixture, AfStandingsItem, AfTopScorer } from '../src/providers/api-football/raw.js';
import { NOW, fakeFetch, fixture } from './helpers.js';

const leagues: Record<number, string> = { 10: 'FRIENDLIES', 5: 'UNL', 32: 'WCQ_UEFA' };
const ctx = { compForLeague: (id: number): CompetitionConfig | undefined => (leagues[id] ? competitionById(leagues[id]) : undefined) };

describe('API-Football normalization', () => {
  it('maps a day of fixtures and drops leagues outside the registry', () => {
    const list = normalizeAfFixtures(fixture<AfEnvelope<AfFixture>>('af/fixtures-2026-10-18.json').response!, ctx);
    expect(list.map((m) => m.id)).toEqual(['af-1400001', 'af-1400003', 'af-1400002']);
    const friendly = list[0]!;
    expect(friendly).toMatchObject({ competitionId: 'FRIENDLIES', status: 'finished', stage: null, matchday: null, source: 'api-football' });
    expect(friendly.utcDate).toBe('2026-10-18T00:30:00.000Z');
    expect(friendly.score).toMatchObject({ home: 1, away: 1, winner: 'draw', duration: 'regular' });
    expect(friendly.homeTeam).toMatchObject({ id: 'af-6', name: 'Brazil', national: true });
    expect(friendly.referees).toEqual([{ name: 'Szymon Marciniak', role: 'referee', nationality: 'Poland' }]);
    expect(friendly.venue).toBe('Estadio Nacional, Lisbon');

    const live = list.find((m) => m.id === 'af-1400002')!;
    expect(live).toMatchObject({ status: 'live', livePhase: 'second_half', minute: 63, group: 'League A', matchday: 4 });
  });

  it('parses round names into stages, groups and matchdays', () => {
    expect(parseRound('Regular Season - 12')).toEqual({ stage: 'REGULAR_SEASON', label: null, group: null, matchday: 12 });
    expect(parseRound('Group C - 2')).toMatchObject({ stage: 'GROUP_STAGE', group: 'Group C', matchday: 2 });
    expect(parseRound('League Stage - 5')).toMatchObject({ stage: 'LEAGUE_STAGE', matchday: 5 });
    expect(parseRound('Round of 16')).toMatchObject({ stage: 'LAST_16', label: 'Round of 16' });
    expect(parseRound('Quarter-finals')).toMatchObject({ stage: 'QUARTER_FINALS' });
    expect(parseRound('Knockout Round Play-offs')).toMatchObject({ stage: 'PLAYOFFS' });
    expect(parseRound('3rd Place Final')).toMatchObject({ stage: 'THIRD_PLACE' });
    expect(parseRound('Final')).toMatchObject({ stage: 'FINAL' });
    expect(parseRound('2nd Qualifying Round')).toMatchObject({ stage: 'QUALIFICATION', label: '2nd Qualifying Round' });
    expect(parseRound(null)).toEqual({ stage: null, label: null, group: null, matchday: null });
  });

  it('normalizes a shootout final with events, lineups and statistics', () => {
    const [raw] = fixture<AfEnvelope<AfFixture>>('af/fixture-1400010.json').response!;
    const d = normalizeAfFixtureDetail(raw!, ctx)!;
    expect(d.score).toMatchObject({ home: 2, away: 2, penalties: { home: 5, away: 3 }, winner: 'home', duration: 'penalties' });
    expect(d.isKnockout).toBe(true);
    // Shootout kicks are not part of the timeline.
    expect(d.events.filter((e) => e.type === 'penalty_goal')).toHaveLength(0);
    expect(d.events.map((e) => e.minute)).toEqual([21, 26, 45, 46, 61, 70, 72]);
    expect(d.lineups?.home).toMatchObject({ formation: '4-3-3', coach: 'Roberto Martínez' });
    expect(d.lineups?.home.startingXI[0]).toEqual({ id: 'af-220', name: 'Diogo Costa', position: 'Goalkeeper', shirtNumber: 22 });
    expect(d.statistics.find((s) => s.key === 'ball_possession')).toMatchObject({ home: 38, away: 62, unit: '%' });
    expect(d.statistics.some((s) => s.key === 'red_cards')).toBe(false);
  });

  it('works out who came on from the lineups, whichever field the provider used', () => {
    const [raw] = fixture<AfEnvelope<AfFixture>>('af/fixture-1400010.json').response!;
    const d = normalizeAfFixtureDetail(raw!, ctx)!;
    const subs = d.events.filter((e) => e.type === 'substitution');
    // Portugal: "player" (P. Neto) started, so he is the one going off.
    expect(subs[0]).toMatchObject({ side: 'home', player: 'F. Conceição', secondaryPlayer: 'P. Neto' });
    // Spain: "player" (Merino) was on the bench, so he is coming on.
    expect(subs[1]).toMatchObject({ side: 'away', player: 'Mikel Merino', secondaryPlayer: 'Pedri' });
  });

  it('maps grouped standings, using descriptions when the registry has no zones', () => {
    const items = fixture<AfEnvelope<AfStandingsItem>>('af/standings-5.json').response!;
    const noZones = { ...competitionById('UNL')!, zones: [] };
    const s = normalizeAfStandings(items, noZones);
    expect(s.groups.map((g) => g.name)).toEqual(['League A - Group 1', 'League A - Group 4']);
    expect(s.groups[0]!.rows.map((r) => r.zone)).toEqual(['promotion', 'relegation']);
    expect(s.groups[0]!.rows[0]).toMatchObject({ played: 5, won: 3, goalsFor: 11, goalsAgainst: 4, goalDifference: 7, form: ['W', 'W', 'D', 'W', 'L'] });
    expect(zoneFromDescription('Promotion - Champions League (Group Stage: )')).toBe('ucl');
    expect(zoneFromDescription('Relegation Play-off')).toBe('relegation_playoff');
  });

  it('maps top scorers', () => {
    const list = normalizeAfScorers(fixture<AfEnvelope<AfTopScorer>>('af/topscorers-5.json').response!, competitionById('UNL')!);
    expect(list[0]).toMatchObject({ goals: 8, assists: 1, penalties: 3, playedMatches: 6, player: { id: 'af-202', position: 'Attacker' }, team: { id: 'af-27' } });
  });
});

describe('API-Football provider error envelopes', () => {
  const make = (body: unknown) => {
    const store = new MemoryStore(() => NOW);
    const budget = new UpstreamBudget(store, { name: 'af', perMinute: 8, perDay: 90 }, () => NOW, silentLogger);
    const fetch = fakeFetch([{ match: /.*/, body }]);
    const provider = new ApiFootballProvider({
      apiKey: 'k',
      budget,
      logger: silentLogger,
      leagues: () => Promise.resolve(new Map([['UNL', { leagueId: 5, season: 2026, logo: null, seasonStart: null, seasonEnd: null }]])),
      fetch: fetch.fetch,
    });
    return { provider, budget, fetch };
  };

  it('treats the daily-limit error as a rate limit and blocks further calls', async () => {
    const { provider, budget, fetch } = make(fixture('af/error-daily-limit.json'));
    await expect(provider.matchesOnDate('2026-10-18')).rejects.toBeInstanceOf(UpstreamRateLimitedError);
    expect((await budget.snapshot()).blockedUntil).not.toBeNull();
    await expect(provider.matchesOnDate('2026-10-18')).rejects.toBeInstanceOf(UpstreamRateLimitedError);
    expect(fetch.calls).toHaveLength(1);
  });

  it('surfaces plan restrictions', async () => {
    const { provider } = make(fixture('af/error-plan.json'));
    await expect(provider.standings(competitionById('UNL')!)).rejects.toBeInstanceOf(PlanRestrictedError);
  });

  it('resolves a league and its current season', async () => {
    const { provider, fetch } = make(fixture('af/leagues-friendlies.json'));
    const info = await provider.lookupLeague('Friendlies', 'World');
    expect(info).toMatchObject({ leagueId: 10, season: 2026 });
    expect(fetch.calls[0]).toBe('/leagues?name=Friendlies&country=World');
  });
});

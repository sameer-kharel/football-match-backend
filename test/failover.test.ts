import { describe, expect, it } from 'vitest';
import { createApp } from '../src/create-app.js';
import type { Competition, Envelope, Match, MatchDetail, Scorer, Standings, TeamProfile } from '../src/domain/types.js';
import { MemoryStore } from '../src/lib/store.js';
import type { OlMatch } from '../src/providers/openligadb/raw.js';
import type { Route } from './helpers.js';
import { NOW, fakeFetch, fdRoutes, fixture, makeCtx } from './helpers.js';

function olRoutes(): Route[] {
  return [
    { match: /^\/getmatchdata\/bl1\/2026$/, body: fixture('ol/bl1-2026.json') },
    { match: /^\/getmatchdata\/bl2\/2026$/, body: fixture('ol/bl2-2026.json') },
    { match: /^\/getmatchdata\/dfb\/2026$/, body: fixture('ol/dfb-2026.json') },
    { match: /^\/getbltable\/bl1\/2026$/, body: fixture('ol/table-bl1-2026.json') },
    { match: /^\/getbltable\/bl2\/2026$/, body: fixture('ol/table-bl2-2026.json') },
  ];
}

function setup(options: { now?: number; extra?: Route[] } = {}) {
  let now = options.now ?? NOW;
  const store = new MemoryStore(() => now);
  const upstream = fakeFetch([...(options.extra ?? []), ...olRoutes(), ...fdRoutes()]);
  const ctx = makeCtx({ fetch: upstream.fetch, now: () => now, store, env: { openLigaDbEnabled: true } });
  const app = createApp(() => ctx);
  const get = async <T>(path: string) => {
    const res = await app.request(path, { headers: { 'x-forwarded-for': '203.0.113.9' } });
    return { res, body: (await res.json()) as T };
  };
  const olCalls = () => upstream.calls.filter((c) => !c.startsWith('/v4/'));
  return { get, upstream, olCalls, advance: (s: number) => (now += s * 1000) };
}

describe('OpenLigaDB as a source', () => {
  it('serves competitions football-data does not cover, and stays a backup for the Bundesliga', async () => {
    const { get } = setup();
    const { body } = await get<Envelope<Competition[]>>('/api/v1/competitions');
    const byId = new Map(body.data.map((c) => [c.id, c]));
    expect(byId.get('BL1')?.source).toBe('football-data');
    expect(byId.get('BL2')).toMatchObject({ source: 'openligadb', season: { label: '2026/27' } });
    expect(byId.get('DFB')).toMatchObject({ source: 'openligadb', hasBracket: true });
  });

  it('adds its matches to the day list without doubling the Bundesliga', async () => {
    const { get } = setup();
    const { res, body } = await get<Envelope<Match[]>>('/api/v1/matches?date=2026-10-18&tz=UTC');
    expect(res.status).toBe(200);
    expect(body.data.filter((m) => m.competitionId === 'BL1').map((m) => m.id)).toEqual(['fd-540002']);
    expect(body.data.filter((m) => m.competitionId === 'BL2').every((m) => m.source === 'openligadb' && m.id.startsWith('ol-'))).toBe(true);
    expect(body.data.some((m) => m.competitionId === 'BL2')).toBe(true);
    expect(body.meta.sources).toEqual(expect.arrayContaining(['football-data', 'openligadb']));
    expect(body.meta.warnings).toEqual([]);
  });

  it('serves a cup bracket, match pages, team pages and scorers', async () => {
    const { get } = setup();
    const cup = await get<Envelope<Match[]>>('/api/v1/competitions/DFB/matches');
    expect(new Set(cup.body.data.map((m) => m.stage))).toEqual(new Set(['LAST_64', 'LAST_32']));

    const detail = await get<Envelope<MatchDetail>>('/api/v1/matches/ol-83201');
    expect(detail.res.status).toBe(200);
    expect(detail.body.data).toMatchObject({ id: 'ol-83201', status: 'finished', score: { home: 6, away: 1 } });
    expect(detail.body.data.events).toHaveLength(7);

    const team = await get<Envelope<TeamProfile>>('/api/v1/teams/ol-40');
    expect(team.body.data.team.name).toBe('FC Bayern München');
    expect(team.body.data.competitions.map((c) => c.id)).toEqual(['BL1', 'DFB']);
    expect(team.body.data.recentMatches[0]?.id).toBe('ol-83201');

    const scorers = await get<Envelope<Scorer[]>>('/api/v1/competitions/BL2/scorers?limit=3');
    expect(scorers.body.data).toHaveLength(3);
    expect(scorers.body.data[0]!.team.id).toMatch(/^ol-/);

    const table = await get<Envelope<Standings>>('/api/v1/competitions/BL2/standings');
    expect(table.body.data.groups[0]!.rows).toHaveLength(18);
    expect(table.body.data.groups[0]!.rows[0]!.zone).toBe('promotion');
  });

  it('lists a club once in team search when two providers know it', async () => {
    const { get } = setup({
      extra: [{ match: /^\/v4\/competitions\/BL1\/teams/, body: { teams: [{ id: 5, name: 'FC Bayern München', shortName: 'Bayern', tla: 'FCB', crest: null }] } }],
    });
    const { body } = await get<Envelope<{ team: { id: string; name: string }; competitionIds: string[] }[]>>('/api/v1/teams');
    const bayern = body.data.filter((e) => e.team.name === 'FC Bayern München');
    expect(bayern).toHaveLength(1);
    expect(bayern[0]).toMatchObject({ team: { id: 'fd-5' }, competitionIds: ['BL1', 'DFB'] });
    expect(body.data.some((e) => e.team.id.startsWith('ol-'))).toBe(true); // clubs only OpenLigaDB knows
  });

  it('downloads each season once and cuts every list from it', async () => {
    const { get, olCalls } = setup();
    await get('/api/v1/matches?date=2026-10-18&tz=UTC');
    await get('/api/v1/matches?date=2026-10-17&tz=UTC');
    await get('/api/v1/competitions/DFB/matches');
    await get('/api/v1/teams/ol-40');
    expect(olCalls().sort()).toEqual(['/getmatchdata/bl1/2026', '/getmatchdata/bl2/2026', '/getmatchdata/dfb/2026']);
  });

  it('refetches only the matchday being played and lays it over the season', async () => {
    const md7 = fixture<OlMatch[]>('ol/bl1-2026.json').filter((m) => m.group?.groupOrderID === 7);
    const live = md7.map((m) =>
      m.matchID === 83212 ? { ...m, goals: [{ scoreTeam1: 1, scoreTeam2: 0, matchMinute: 9, goalGetterName: 'E. Demirović', isPenalty: false, isOwnGoal: false }] } : m,
    );
    const kickoff = Date.parse('2026-10-23T18:30:00Z');
    const { get, olCalls, advance } = setup({ now: kickoff + 15 * 60_000, extra: [{ match: /^\/getmatchdata\/bl1\/2026\/7$/, body: live }] });

    const first = await get<Envelope<MatchDetail>>('/api/v1/matches/ol-83212');
    expect(first.body.data).toMatchObject({ status: 'live', score: { home: 1, away: 0 } });
    expect(first.body.data.events[0]).toMatchObject({ minute: 9, side: 'home', player: 'E. Demirović' });
    const calls = olCalls().length;
    expect(olCalls()).toContain('/getmatchdata/bl1/2026/7');

    advance(90);
    await get('/api/v1/matches/ol-83212');
    // A minute later only the small matchday file is fetched again, not the season.
    expect(olCalls().slice(calls)).toEqual(['/getmatchdata/bl1/2026/7']);
  });
});

describe('Failover to a backup', () => {
  it('fills the Bundesliga from OpenLigaDB when football-data fails and nothing is cached', async () => {
    const { get } = setup({ extra: [{ match: /^\/v4\/matches\?date=2026-10-18/, status: 500 }] });
    const { res, body } = await get<Envelope<Match[]>>('/api/v1/matches?date=2026-10-18&tz=UTC');
    expect(res.status).toBe(200);
    const bundesliga = body.data.filter((m) => m.competitionId === 'BL1');
    expect(bundesliga.length).toBeGreaterThan(0);
    expect(bundesliga.every((m) => m.source === 'openligadb')).toBe(true);
    expect(body.meta.warnings).toContain('Bundesliga is coming from OpenLigaDB while football-data.org is unavailable.');
    // Premier League & co. have no backup here: still reported as missing.
    expect(body.meta.partial).toBe(true);
    expect(body.meta.warnings).toContain('Some matches could not be loaded.');
    expect(body.data.some((m) => m.competitionId === 'PL')).toBe(false);
  });

  it('prefers stale football-data over a backup', async () => {
    const { get, upstream, advance } = setup();
    await get('/api/v1/matches?date=2026-10-18&tz=UTC');
    advance(600);
    upstream.routes.unshift({ match: /^\/v4\/matches\?date=2026-10-18/, status: 500 });
    const { body } = await get<Envelope<Match[]>>('/api/v1/matches?date=2026-10-18&tz=UTC');
    expect(body.meta.stale).toBe(true);
    expect(body.data.filter((m) => m.competitionId === 'BL1').map((m) => m.source)).toEqual(['football-data']);
    expect(body.meta.warnings).toEqual([]);
  });

  it('falls back for tables and fixtures, but a not-found answer stays final', async () => {
    const down = setup({ extra: [{ match: /^\/v4\/competitions\/BL1\/(standings|matches)/, status: 500 }] });
    const table = await down.get<Envelope<Standings>>('/api/v1/competitions/BL1/standings');
    expect(table.res.status).toBe(200);
    expect(table.body.data.groups[0]!.rows[0]!.team.id).toBe('ol-40');
    expect(table.body.meta.warnings).toContain('Bundesliga is coming from OpenLigaDB while football-data.org is unavailable.');
    const fixtures = await down.get<Envelope<Match[]>>('/api/v1/competitions/BL1/matches');
    expect(fixtures.body.data.every((m) => m.source === 'openligadb')).toBe(true);

    // fdRoutes has no BL1 table, so football-data answers 404: that's no data, not an outage.
    const notFound = setup();
    const empty = await notFound.get<Envelope<Standings>>('/api/v1/competitions/BL1/standings');
    expect(empty.body.data.groups).toEqual([]);
    expect(notFound.olCalls()).not.toContain('/getbltable/bl1/2026');
  });

  it('lets backups fill highlights when the ranged call fails', async () => {
    const { get } = setup({ extra: [{ match: /^\/v4\/matches/, status: 500 }] });
    const { res, body } = await get<Envelope<Match[]>>('/api/v1/highlights?tz=UTC&days=7');
    expect(res.status).toBe(200);
    expect(body.data.some((m) => m.competitionId === 'BL1' && m.source === 'openligadb')).toBe(true);
    expect(body.data.some((m) => m.source === 'football-data')).toBe(false);
    expect(body.meta.warnings).toContain('Bundesliga is coming from OpenLigaDB while football-data.org is unavailable.');
  });

  it('reports OpenLigaDB in /health', async () => {
    const { get } = setup();
    const { body } = await get<{ providers: { openLigaDb: { enabled: boolean; configured: boolean } } }>('/api/v1/health');
    expect(body.providers.openLigaDb).toMatchObject({ enabled: true, configured: true });
  });
});

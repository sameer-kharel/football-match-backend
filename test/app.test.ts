import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Envelope, Match, MatchDetail, Standings } from '../src/domain/types.js';
import { MemoryStore } from '../src/lib/store.js';
import type { AppContext } from '../src/services/context.js';
import { NOW, fakeFetch, fdRoutes, fixture, makeCtx } from './helpers.js';

function setup(env = {}) {
  let now = NOW;
  const store = new MemoryStore(() => now);
  const upstream = fakeFetch(fdRoutes());
  const ctx = makeCtx({ fetch: upstream.fetch, now: () => now, store, env });
  const app = createApp(() => ctx);
  const get = async <T>(path: string, headers: Record<string, string> = {}) => {
    const res = await app.request(path, { headers: { 'x-forwarded-for': '203.0.113.9', ...headers } });
    return { res, body: (await res.json()) as T };
  };
  return { app, ctx, upstream, get, advance: (s: number) => (now += s * 1000) };
}

type ErrorBody = { error: { code: string; message: string; details?: { path: string; message: string }[] } };

describe('GET /api/v1/matches', () => {
  it('returns the local day for Asia/Kathmandu, spanning two UTC days', async () => {
    const { get, upstream } = setup();
    const { res, body } = await get<Envelope<Match[]>>('/api/v1/matches?date=2026-10-18&tz=Asia/Kathmandu');
    expect(res.status).toBe(200);
    // Chelsea–Liverpool kicked off 19:00 UTC on the 17th = 00:45 on the 18th in Kathmandu;
    // Real Madrid–Barcelona at 19:00 UTC on the 18th is already the 19th there.
    expect(body.data.map((m) => m.id).sort()).toEqual(['fd-539002', 'fd-540001', 'fd-540002', 'fd-540003']);
    expect(upstream.calls.filter((c) => c.startsWith('/v4/matches?date='))).toEqual(['/v4/matches?date=2026-10-17', '/v4/matches?date=2026-10-18']);
    expect(body.meta).toMatchObject({ stale: false, delayed: true, partial: false, sources: ['football-data'] });
    expect(res.headers.get('cache-control')).toContain('s-maxage=30'); // a match is live
  });

  it('annotates featured tiers, colours and rivalries, ordered by competition priority', async () => {
    const { get } = setup();
    const { body } = await get<Envelope<Match[]>>('/api/v1/matches?date=2026-10-18');
    const ids = body.data.map((m) => m.competitionId);
    expect(ids).toEqual(['PL', 'PD', 'SA', 'BL1']);
    const clasico = body.data.find((m) => m.id === 'fd-540004')!;
    expect(clasico.rivalry).toBe('El Clásico');
    expect(clasico.homeTeam).toMatchObject({ featuredTier: 1, color: '#FEBE10' });
    expect(body.data.find((m) => m.id === 'fd-540002')!.homeTeam.featuredTier).toBeNull();
  });

  it('filters by competition', async () => {
    const { get } = setup();
    const { body } = await get<Envelope<Match[]>>('/api/v1/matches?date=2026-10-18&competitions=PD');
    expect(body.data.map((m) => m.id)).toEqual(['fd-540004']);
  });

  it('serves the cache on repeat calls, then stale data with stale=true when the provider returns 429', async () => {
    const { get, upstream, advance } = setup();
    const matchCalls = () => upstream.calls.filter((c) => c.startsWith('/v4/matches')).length;
    await get('/api/v1/matches?date=2026-10-18');
    const callsAfterFirst = matchCalls();
    await get('/api/v1/matches?date=2026-10-18');
    // Only featured-team resolution (a couple of team lists per request, cached for a week) may still call out.
    expect(matchCalls()).toBe(callsAfterFirst);

    advance(120);
    upstream.routes.unshift({ match: /^\/v4\/matches\?date=/, status: 429, headers: { 'retry-after': '40' } });
    const { res, body } = await get<Envelope<Match[]>>('/api/v1/matches?date=2026-10-18');
    expect(res.status).toBe(200);
    expect(body.meta.stale).toBe(true);
    expect(body.data.length).toBe(4);
    expect(res.headers.get('cache-control')).toContain('s-maxage=15');
  });

  it('returns 503 with Retry-After when nothing is cached and the provider is rate limited', async () => {
    const { get, upstream } = setup();
    upstream.routes.unshift({ match: /^\/v4\/matches/, status: 429, headers: { 'retry-after': '40' } });
    const { res, body } = await get<ErrorBody>('/api/v1/matches?date=2026-10-18');
    expect(res.status).toBe(503);
    expect(body.error.code).toBe('UPSTREAM_RATE_LIMITED');
    expect(res.headers.get('retry-after')).toBe('40');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects dates far from today before spending provider budget', async () => {
    const { get, upstream } = setup();
    const { res, body } = await get<ErrorBody>('/api/v1/matches?date=1999-01-01');
    expect(res.status).toBe(400);
    expect(body.error.details?.[0]?.path).toBe('date');
    expect(upstream.calls.filter((c) => c.startsWith('/v4/matches'))).toEqual([]);
  });

  it('rejects bad input with a consistent error shape', async () => {
    const { get } = setup();
    const { res, body } = await get<ErrorBody>('/api/v1/matches?date=tomorrow&tz=Nowhere/Land');
    expect(res.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details?.map((d) => d.path).sort()).toEqual(['date', 'tz']);
  });
});

describe('other endpoints', () => {
  it('GET /health reports degraded without Redis', async () => {
    const { get } = setup();
    const { res, body } = await get<{ status: string; redis: string; providers: { footballData: { configured: boolean } } }>('/api/v1/health');
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ status: 'degraded', redis: 'memory', providers: { footballData: { configured: true } } });
  });

  it('GET /competitions lists what the token can access, in priority order', async () => {
    const { get } = setup();
    const { body } = await get<Envelope<{ id: string; source: string; season: { label: string } | null }[]>>('/api/v1/competitions');
    expect(body.data.map((c) => c.id)).toEqual(['WC', 'UCL', 'EC', 'PL', 'PD', 'SA', 'BL1', 'FL1', 'DED', 'PPL', 'BSA', 'ELC']);
    expect(body.data.find((c) => c.id === 'PL')?.season?.label).toBe('2026/27');
  });

  it('GET /competitions/:id/standings annotates teams', async () => {
    const { get } = setup();
    const { body } = await get<Envelope<Standings>>('/api/v1/competitions/PD/standings');
    expect(body.data.groups[0]!.rows[0]!.team).toMatchObject({ name: 'Real Madrid CF', featuredTier: 1 });
  });

  it('returns 404s in the same error shape', async () => {
    const { get } = setup();
    const unknownComp = await get<ErrorBody>('/api/v1/competitions/UNL/standings');
    expect(unknownComp.res.status).toBe(404);
    expect(unknownComp.body.error.code).toBe('NOT_FOUND');
    const unknownRoute = await get<ErrorBody>('/api/v1/nope');
    expect(unknownRoute.res.status).toBe(404);
  });

  it('GET /competitions/:id/standings computes group tables when the provider has none', async () => {
    const { get, upstream } = setup();
    upstream.routes.unshift({ match: /^\/v4\/competitions\/WC\/standings/, status: 404 });
    upstream.routes.unshift({ match: /^\/v4\/competitions\/WC\/matches/, body: { matches: [fixture<Record<string, unknown>>('fd/match-penalties.json'), {
      id: 1, utcDate: '2026-06-12T18:00:00Z', status: 'FINISHED', stage: 'GROUP_STAGE', group: 'GROUP_A', competition: { code: 'WC' },
      homeTeam: { id: 769, name: 'Mexico' }, awayTeam: { id: 8030, name: 'South Africa' },
      score: { duration: 'REGULAR', fullTime: { home: 2, away: 1 } },
    }] } });
    const { res, body } = await get<Envelope<Standings>>('/api/v1/competitions/WC/standings');
    expect(res.status).toBe(200);
    expect(body.data.groups.map((g) => g.name)).toEqual(['Group A']);
    expect(body.data.groups[0]!.rows.map((r) => [r.team.name, r.points])).toEqual([['Mexico', 3], ['South Africa', 0]]);
    expect(body.meta.warnings[0]).toContain('calculated from results');
  });

  it('GET /competitions/:id/scorers is an empty list, not an error, when the provider has none', async () => {
    const { get, upstream } = setup();
    upstream.routes.unshift({ match: /^\/v4\/competitions\/PL\/scorers/, status: 404 });
    const { res, body } = await get<Envelope<unknown[]>>('/api/v1/competitions/PL/scorers');
    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
  });

  it('GET /matches/:id falls back to the cached list version when the budget is spent', async () => {
    const { get, upstream } = setup();
    await get('/api/v1/matches?date=2026-10-18'); // warms fd:day:2026-10-18
    upstream.routes.unshift({ match: /^\/v4\/matches\/540004$/, status: 429, headers: { 'retry-after': '30' } });
    const { res, body } = await get<Envelope<MatchDetail>>('/api/v1/matches/fd-540004');
    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ id: 'fd-540004', events: [], lineups: null, rivalry: 'El Clásico' });
    expect(body.meta.partial).toBe(true);
  });

  it('GET /matches/:id merges head-to-head and league positions', async () => {
    const { get, upstream } = setup();
    const raw = fixture<{ matches: Record<string, unknown>[] }>('fd/matches-2026-10-18.json').matches.find((m) => m.id === 540003);
    upstream.routes.unshift({ match: /^\/v4\/matches\/540003$/, body: raw });
    upstream.routes.unshift({ match: /^\/v4\/competitions\/PL\/standings/, body: { standings: [{ type: 'TOTAL', table: [{ position: 2, team: { id: 57, name: 'Arsenal FC' } }, { position: 1, team: { id: 65, name: 'Manchester City FC' } }] }] } });
    const { res, body } = await get<Envelope<MatchDetail>>('/api/v1/matches/fd-540003');
    expect(res.status).toBe(200);
    expect(body.data.headToHead?.numberOfMatches).toBe(3);
    expect(body.data.positions).toEqual({ home: 2, away: 1 });
    expect(body.data.homeTeam.featuredTier).toBe(1);
  });

  it('routes /matches/pinned before /matches/:id and returns pinned content', async () => {
    const { get, upstream } = setup();
    upstream.routes.unshift({ match: /^\/v4\/teams\/57\/matches/, body: fixture('fd/matches-2026-10-18.json') });
    upstream.routes.unshift({ match: /^\/v4\/matches\?ids=/, body: fixture('fd/matches-2026-10-17.json') });
    const { res, body } = await get<Envelope<{ matches: Match[]; missing: { teams: string[] } }>>('/api/v1/matches/pinned?teams=fd-57&matches=fd-539001&tz=Europe/London');
    expect(res.status).toBe(200);
    const ids = body.data.matches.map((m) => m.id);
    expect(ids).toContain('fd-540003');
    expect(ids).toContain('fd-539001');
    expect(body.data.missing.teams).toEqual([]);
  });

  it('GET /highlights ranks the big games', async () => {
    const { get } = setup();
    const { res, body } = await get<Envelope<Match[]>>('/api/v1/highlights?tz=UTC&days=3');
    expect(res.status).toBe(200);
    expect(body.data.map((m) => m.id)).toEqual(['fd-540004', 'fd-540003', 'fd-540001']);
    expect(body.data[0]!.highlightScore).toBe(100 + 25 + 10);
  });

  it('enforces the per-IP limit through the shared store', async () => {
    const { get } = setup({ ipLimitPerMinute: 2 });
    await get('/api/v1/competitions');
    await get('/api/v1/competitions');
    const { res, body } = await get<ErrorBody>('/api/v1/competitions');
    expect(res.status).toBe(429);
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(res.headers.get('retry-after')).not.toBeNull();
  });

  it('sets security and CORS headers', async () => {
    const { get } = setup();
    const { res } = await get('/api/v1/competitions', { origin: 'https://example.com' });
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('protects the cron warmer', async () => {
    const { get } = setup();
    expect((await get('/api/v1/cron/warm')).res.status).toBe(401);
    const ok = await get<{ done: string[] }>('/api/v1/cron/warm', { authorization: 'Bearer cron-secret' });
    expect(ok.res.status).toBe(200);
    expect(ok.body.done).toContain('competitions');
  });

  it('stops calling the provider once the per-minute budget is spent', async () => {
    const { ctx } = setup({ footballDataRpm: 1 }) as { ctx: AppContext };
    const app = createApp(() => ctx);
    const res = await app.request('/api/v1/matches?date=2026-10-18&tz=Asia/Kathmandu');
    const body = (await res.json()) as Envelope<Match[]>;
    // Budget of 1: the competitions list uses it, both day lists are refused.
    expect(res.status).toBe(503);
    expect((body as unknown as ErrorBody).error.code).toBe('UPSTREAM_RATE_LIMITED');
  });
});

describe('store listing pages', () => {
  it('serves the privacy policy with the publisher details from the environment', async () => {
    const { app } = setup({ publisherName: 'Sameer Kharel', contactEmail: 'support@example.com' });
    const res = await app.request('/privacy');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('<title>Pitchside privacy policy</title>');
    expect(html).toContain('published by Sameer Kharel');
    expect(html).toContain('mailto:support@example.com');
    expect(html).toContain('Google AdMob');
    expect(html).not.toContain('API-Football');
  });

  it('escapes what comes from the environment', async () => {
    const { app } = setup({ publisherName: '<script>x</script>' });
    const html = await (await app.request('/privacy')).text();
    expect(html).not.toContain('<script>');
  });

  it('serves app-ads.txt only once it is configured', async () => {
    expect((await setup().app.request('/app-ads.txt')).status).toBe(404);
    const res = await setup({ appAdsTxt: 'google.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0' }).app.request('/app-ads.txt');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('google.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0\n');
  });
});

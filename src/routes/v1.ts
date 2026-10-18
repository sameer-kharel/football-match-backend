import { Hono } from 'hono';
import { CDN } from '../config/ttl.js';
import type { PinSet } from '../domain/highlight.js';
import { AppError, NotConfiguredError, NotFoundError } from '../lib/errors.js';
import { sendData } from '../lib/http.js';
import { errorMessage } from '../lib/logger.js';
import {
  CompetitionMatchesQuery,
  CompetitionParams,
  EmptyQuery,
  HighlightsQuery,
  MatchesByDateQuery,
  MatchParams,
  PinnedQuery,
  ScorersQuery,
  TeamParams,
  assertNearToday,
  parse,
} from '../lib/validation.js';
import { activeCompetitions } from '../services/availability.js';
import { competitionMatches, competitionScorers, competitionStandings, listCompetitions } from '../services/competitions.js';
import type { AppContext } from '../services/context.js';
import { featuredIndex } from '../services/featured.js';
import { highlights } from '../services/highlights.js';
import { matchDetail } from '../services/match-detail.js';
import { dayMatches, matchesForLocalDate } from '../services/matches.js';
import { MetaCollector } from '../services/meta.js';
import { pinnedContent } from '../services/pinned.js';
import { teamProfile, teamsIndex } from '../services/teams.js';
import { toUtcDate, addDays } from '../domain/time.js';

const pinSet = (q: { teams: string[]; matches: string[]; competitions: string[] }): PinSet | undefined =>
  q.teams.length + q.matches.length + q.competitions.length > 0
    ? { teams: new Set(q.teams), matches: new Set(q.matches), competitions: new Set(q.competitions) }
    : undefined;

export function v1Routes(getCtx: () => AppContext) {
  const r = new Hono();

  r.use('*', async (c, next) => {
    const ctx = getCtx();
    if (!ctx.fd && !ctx.af && !c.req.path.endsWith('/health')) {
      throw new NotConfiguredError('No data provider is configured. Set FOOTBALL_DATA_API_KEY in the project environment.');
    }
    await next();
  });

  r.get('/health', async (c) => {
    const ctx = getCtx();
    let redis: 'ok' | 'memory' | 'error' = ctx.store.kind === 'memory' ? 'memory' : 'ok';
    if (redis === 'ok') {
      try {
        if (!(await ctx.store.ping())) redis = 'error';
      } catch {
        redis = 'error';
      }
    }
    const [fdBudget, afBudget] = await Promise.all([
      ctx.budgets.fd.snapshot().catch(() => null),
      ctx.budgets.af.snapshot().catch(() => null),
    ]);
    const healthy = redis !== 'error' && !!ctx.fd;
    c.header('Cache-Control', 'no-store');
    return c.json(
      {
        status: healthy && redis === 'ok' ? 'ok' : 'degraded',
        time: new Date(ctx.now()).toISOString(),
        redis,
        providers: {
          footballData: { configured: !!ctx.fd, plan: ctx.env.footballDataPlan, budget: fdBudget },
          apiFootball: { enabled: ctx.env.apiFootballEnabled, configured: !!ctx.af, budget: ctx.af ? afBudget : null },
        },
      },
      healthy ? 200 : 503,
    );
  });

  r.get('/competitions', async (c) => {
    const ctx = getCtx();
    parse(EmptyQuery, c.req.query());
    const meta = new MetaCollector();
    const data = await listCompetitions(ctx, meta);
    return sendData(c, data, meta, CDN.slow, ctx.now());
  });

  r.get('/competitions/:id/matches', async (c) => {
    const ctx = getCtx();
    const { id } = parse(CompetitionParams, c.req.param());
    const q = parse(CompetitionMatchesQuery, c.req.query());
    if (q.from) assertNearToday(q.from, ctx.now(), 'from');
    if (q.to) assertNearToday(q.to, ctx.now(), 'to');
    const meta = new MetaCollector();
    const data = await competitionMatches(ctx, id, { ...(q.from ? { from: q.from } : {}), ...(q.to ? { to: q.to } : {}), status: q.status }, meta);
    return sendData(c, data, meta, CDN.day, ctx.now());
  });

  r.get('/competitions/:id/standings', async (c) => {
    const ctx = getCtx();
    const { id } = parse(CompetitionParams, c.req.param());
    parse(EmptyQuery, c.req.query());
    const meta = new MetaCollector();
    const data = await competitionStandings(ctx, id, meta);
    return sendData(c, data, meta, CDN.standings, ctx.now());
  });

  r.get('/competitions/:id/scorers', async (c) => {
    const ctx = getCtx();
    const { id } = parse(CompetitionParams, c.req.param());
    const q = parse(ScorersQuery, c.req.query());
    const meta = new MetaCollector();
    const data = await competitionScorers(ctx, id, q.limit, meta);
    return sendData(c, data, meta, CDN.standings, ctx.now());
  });

  r.get('/matches', async (c) => {
    const ctx = getCtx();
    const q = parse(MatchesByDateQuery, c.req.query());
    assertNearToday(q.date, ctx.now());
    const meta = new MetaCollector();
    const { matches } = await matchesForLocalDate(ctx, { date: q.date, tz: q.tz, competitionIds: q.competitions }, meta);
    meta.throwIfNothingLoaded();
    const live = matches.some((m) => m.status === 'live' || m.status === 'paused');
    return sendData(c, matches, meta, live ? CDN.live : CDN.day, ctx.now());
  });

  // Registered before /matches/:id so "pinned" is not taken for an id.
  r.get('/matches/pinned', async (c) => {
    const ctx = getCtx();
    const q = parse(PinnedQuery, c.req.query());
    const meta = new MetaCollector();
    const data = await pinnedContent(ctx, q, meta);
    if (data.matches.length === 0) meta.throwIfNothingLoaded();
    return sendData(c, data, meta, CDN.live, ctx.now());
  });

  r.get('/matches/:id', async (c) => {
    const ctx = getCtx();
    const { id } = parse(MatchParams, c.req.param());
    parse(EmptyQuery, c.req.query());
    const meta = new MetaCollector();
    const data = await matchDetail(ctx, id, meta);
    const live = data.status === 'live' || data.status === 'paused';
    return sendData(c, data, meta, live ? CDN.live : CDN.day, ctx.now());
  });

  r.get('/highlights', async (c) => {
    const ctx = getCtx();
    const q = parse(HighlightsQuery, c.req.query());
    const meta = new MetaCollector();
    const pins = pinSet(q);
    const data = await highlights(ctx, { tz: q.tz, days: q.days, limit: q.limit, ...(pins ? { pins } : {}) }, meta);
    if (data.length === 0) meta.throwIfNothingLoaded();
    return sendData(c, data, meta, CDN.day, ctx.now());
  });

  r.get('/teams', async (c) => {
    const ctx = getCtx();
    parse(EmptyQuery, c.req.query());
    const meta = new MetaCollector();
    const data = await teamsIndex(ctx, meta);
    meta.throwIfNothingLoaded();
    return sendData(c, data, meta, CDN.slow, ctx.now());
  });

  r.get('/teams/:id', async (c) => {
    const ctx = getCtx();
    const { id } = parse(TeamParams, c.req.param());
    parse(EmptyQuery, c.req.query());
    const meta = new MetaCollector();
    const data = await teamProfile(ctx, id, meta);
    return sendData(c, data, meta, CDN.day, ctx.now());
  });

  /** Optional cache warmer. Vercel Hobby runs it once a day; the API works without it. */
  r.get('/cron/warm', async (c) => {
    const ctx = getCtx();
    if (!ctx.env.cronSecret) throw new NotFoundError();
    if (c.req.header('authorization') !== `Bearer ${ctx.env.cronSecret}`) {
      throw new AppError('UNAUTHORIZED', 401, 'Missing or wrong cron secret.');
    }
    const meta = new MetaCollector();
    const done: string[] = [];
    const failed: string[] = [];
    const step = async (name: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
        done.push(name);
      } catch (e) {
        failed.push(`${name}: ${errorMessage(e)}`);
      }
    };
    const today = toUtcDate(ctx.now());
    let active: Awaited<ReturnType<typeof activeCompetitions>> = [];
    await step('competitions', async () => (active = await activeCompetitions(ctx, meta)));
    await step('featured', () => featuredIndex(ctx, active, 4));
    if (ctx.fd) {
      await step(`fd:day:${today}`, () => dayMatches(ctx, 'football-data', today, meta));
      await step(`fd:day:${addDays(today, 1)}`, () => dayMatches(ctx, 'football-data', addDays(today, 1), meta));
    }
    for (const a of active.filter((x) => x.source === 'football-data' && x.config.hasStandings).slice(0, 2)) {
      await step(`standings:${a.config.id}`, () => competitionStandings(ctx, a.config.id, meta));
    }
    c.header('Cache-Control', 'no-store');
    return c.json({ done, failed, warnings: meta.warnings });
  });

  return r;
}

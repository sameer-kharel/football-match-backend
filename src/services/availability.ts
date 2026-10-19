import type { CompetitionConfig } from '../config/competitions.js';
import { COMPETITIONS, FOOTBALL_DATA_FREE_CODES } from '../config/competitions.js';
import { AF_TTL, TTL } from '../config/ttl.js';
import type { SeasonInfo, Source } from '../domain/types.js';
import type { UpstreamBudget } from '../lib/budget.js';
import { NotFoundError } from '../lib/errors.js';
import { errorMessage } from '../lib/logger.js';
import type { AfLeagueInfo } from '../providers/api-football/provider.js';
import type { FootballProvider, ProviderCompetitionMeta } from '../providers/types.js';
import type { AppContext } from './context.js';
import type { MetaCollector } from './meta.js';

export interface ActiveCompetition {
  config: CompetitionConfig;
  /** Where the competition's data comes from. */
  source: Source;
  /** Other configured providers that can serve it, in order, for when the source fails (services/failover.ts). */
  backups: Source[];
  emblem: string | null;
  season: SeasonInfo | null;
}

/** Registry competitions the football-data token can read, from the live /competitions list. */
export async function footballDataCompetitions(ctx: AppContext, meta?: MetaCollector, content = false): Promise<ProviderCompetitionMeta[]> {
  const fd = ctx.fd;
  if (!fd) return [];
  try {
    const res = await ctx.cache.get('fd:competitions:v1', () => fd.accessibleCompetitions(), { ttl: TTL.competitions });
    return meta ? meta.add(res, 'football-data', content) : res.data;
  } catch (e) {
    ctx.logger.warn('availability.fd_list_failed', { error: errorMessage(e) });
    return COMPETITIONS.filter((c) => c.providers.footballData && FOOTBALL_DATA_FREE_CODES.includes(c.providers.footballData.code)).map(
      (c) => ({ competitionId: c.id, emblem: null, season: null }),
    );
  }
}

/**
 * API-Football league ids for every mapped competition (it is the source for
 * some and a backup for the rest), resolved by name and country and cached for
 * a week: one lookup per competition, about 20 calls a week.
 */
export async function apiFootballLeagues(ctx: AppContext): Promise<Map<string, AfLeagueInfo>> {
  const af = ctx.af;
  if (!af) return new Map();
  const candidates = COMPETITIONS.filter((c) => c.providers.apiFootball);

  const res = await ctx.cache.get(
    `af:leagues:v1:${candidates.map((c) => c.id).join(',')}`,
    async () => {
      const entries: [string, AfLeagueInfo][] = [];
      let complete = true;
      for (const comp of candidates) {
        const mapping = comp.providers.apiFootball;
        if (!mapping) continue;
        try {
          const info = await ctx.cache.get(
            `af:league:${comp.id}`,
            async () => {
              const found = await af.lookupLeague(mapping.name, mapping.country);
              if (!found) throw new NotFoundError();
              return found;
            },
            { ttl: AF_TTL.league, notFoundTtl: 86_400 },
          );
          entries.push([comp.id, info.data]);
        } catch (e) {
          if (!(e instanceof NotFoundError)) complete = false;
          ctx.logger.warn('availability.af_league_unresolved', { competition: comp.id, error: errorMessage(e) });
        }
      }
      return { entries, complete };
    },
    { ttl: (v) => (v.complete ? AF_TTL.league : 600) },
  );
  return new Map(res.data.entries);
}

interface Offer {
  source: Source;
  emblem: string | null;
  season: SeasonInfo | null;
}

/**
 * Every registry competition that some configured provider can serve, in
 * priority order. The source is the first of football-data, OpenLigaDB and
 * API-Football that offers it; the rest are its backups.
 */
export async function activeCompetitions(ctx: AppContext, meta?: MetaCollector): Promise<ActiveCompetition[]> {
  const fdList = await footballDataCompetitions(ctx, meta);
  const fdById = new Map(fdList.map((c) => [c.competitionId, c]));
  const olById = new Map((ctx.ol ? await ctx.ol.accessibleCompetitions() : []).map((c) => [c.competitionId, c]));
  let afById = new Map<string, AfLeagueInfo>();
  if (ctx.af) {
    try {
      afById = await apiFootballLeagues(ctx);
    } catch (e) {
      ctx.logger.warn('availability.af_failed', { error: errorMessage(e) });
      meta?.warn('Extra competitions from API-Football are unavailable right now.');
    }
  }

  const out: ActiveCompetition[] = [];
  for (const config of COMPETITIONS) {
    const offers: Offer[] = [];
    const fd = fdById.get(config.id);
    if (fd) offers.push({ source: 'football-data', emblem: fd.emblem, season: fd.season });
    const ol = olById.get(config.id);
    if (ol) offers.push({ source: 'openligadb', emblem: ol.emblem, season: ol.season });
    const af = afById.get(config.id);
    if (af) {
      offers.push({
        source: 'api-football',
        emblem: af.logo,
        season: { label: String(af.season), startDate: af.seasonStart, endDate: af.seasonEnd, currentMatchday: null },
      });
    }
    const [primary, ...rest] = offers;
    if (!primary) continue;
    out.push({
      config,
      source: primary.source,
      backups: rest.map((o) => o.source),
      emblem: primary.emblem ?? rest.find((o) => o.emblem)?.emblem ?? null,
      season: primary.season ?? rest.find((o) => o.season)?.season ?? null,
    });
  }
  return out.sort((a, b) => a.config.priority - b.config.priority);
}

export async function activeCompetition(ctx: AppContext, id: string, meta?: MetaCollector): Promise<ActiveCompetition> {
  const found = (await activeCompetitions(ctx, meta)).find((c) => c.config.id === id);
  if (!found) throw new NotFoundError(`${id} is not available with the current data providers.`);
  return found;
}

export function providerFor(ctx: AppContext, source: Source): FootballProvider {
  const p = source === 'football-data' ? ctx.fd : source === 'openligadb' ? ctx.ol : ctx.af;
  if (!p) throw new NotFoundError(`The ${source} provider is not configured.`);
  return p;
}

export const hasProvider = (ctx: AppContext, source: Source) => !!(source === 'football-data' ? ctx.fd : source === 'openligadb' ? ctx.ol : ctx.af);

const PREFIX: Record<Source, string> = { 'football-data': 'fd', 'api-football': 'af', openligadb: 'ol' };

export const cachePrefix = (source: Source) => PREFIX[source];

export function budgetFor(ctx: AppContext, source: Source): UpstreamBudget {
  return source === 'football-data' ? ctx.budgets.fd : source === 'openligadb' ? ctx.budgets.ol : ctx.budgets.af;
}

/** Display names, as used in attributions and backup notices. */
export const SOURCE_NAMES: Record<Source, string> = {
  'football-data': 'football-data.org',
  'api-football': 'API-Football',
  openligadb: 'OpenLigaDB',
};

import type { CompetitionConfig } from '../../config/competitions.js';
import { COMPETITIONS } from '../../config/competitions.js';
import type { HeadToHead, Match, MatchDetail, Scorer, Standings, TeamRef } from '../../domain/types.js';
import type { UpstreamBudget } from '../../lib/budget.js';
import { NotFoundError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import type { DateRange, FootballProvider, ProviderCompetitionMeta, TeamBase } from '../types.js';
import { parseSourcedId } from '../types.js';
import type { FetchLike } from '../upstream.js';
import { UpstreamClient } from '../upstream.js';
import { normalizeOlDetail, normalizeOlSeason, normalizeOlTable, olId, olScorers, olSeasonLabel, olTeams, roundInfo, trimOlMatch } from './normalize.js';
import type { OlMatch, OlSeason, OlTableRow } from './raw.js';

export const OPENLIGADB_BASE_URL = 'https://api.openligadb.de/';

/** A league's current season with live matchdays laid over it; cached by the service layer. */
export type OlSeasonLoader = (shortcut: string) => Promise<OlSeason>;

/** German seasons run August to May and OpenLigaDB names them by their first year. */
export function olSeasonYear(now: number): number {
  const d = new Date(now);
  return d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
}

function rawId(id: string): string {
  const parsed = parseSourcedId(id);
  if (!parsed || parsed.source !== 'openligadb') throw new NotFoundError();
  return parsed.raw;
}

/**
 * OpenLigaDB (api.openligadb.de): free, keyless, community-maintained, ODbL.
 * Only leagues its own team maintains are mapped (see the registry). Every list
 * is cut from the cached season, so most calls cost no request at all.
 */
export class OpenLigaDbProvider implements FootballProvider {
  readonly source = 'openligadb' as const;
  private readonly client: UpstreamClient;
  private readonly comps: CompetitionConfig[];

  constructor(
    private readonly options: {
      budget: UpstreamBudget;
      logger: Logger;
      now: () => number;
      seasons: OlSeasonLoader;
      fetch?: FetchLike;
      baseUrl?: string;
    },
  ) {
    this.client = new UpstreamClient({
      providerName: 'OpenLigaDB',
      baseUrl: options.baseUrl ?? OPENLIGADB_BASE_URL,
      headers: { 'User-Agent': 'MatchBell/1.0 (football fixtures app)' },
      budget: options.budget,
      logger: options.logger,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
    this.comps = COMPETITIONS.filter((c) => c.providers.openLigaDb);
  }

  // ── Raw fetches, used by the season loader ──────────────────────────────

  /** The current season, or the last one while the new fixtures aren't published yet. */
  async fetchSeason(shortcut: string): Promise<OlSeason> {
    const year = olSeasonYear(this.options.now());
    for (const season of [year, year - 1]) {
      const matches = await this.client.getJson<OlMatch[]>(`getmatchdata/${shortcut}/${season}`);
      if (Array.isArray(matches) && matches.length > 0) return { shortcut, season, matches: matches.map(trimOlMatch) };
    }
    throw new NotFoundError(`OpenLigaDB has no ${shortcut} season.`);
  }

  async fetchMatchday(shortcut: string, season: number, matchday: number): Promise<OlMatch[]> {
    const matches = await this.client.getJson<OlMatch[]>(`getmatchdata/${shortcut}/${season}/${matchday}`);
    return Array.isArray(matches) ? matches.map(trimOlMatch) : [];
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private mapping(comp: CompetitionConfig): string {
    const shortcut = comp.providers.openLigaDb?.shortcut;
    if (!shortcut) throw new NotFoundError(`${comp.name} is not available from OpenLigaDB.`);
    return shortcut;
  }

  private async season(comp: CompetitionConfig): Promise<OlSeason> {
    return this.options.seasons(this.mapping(comp));
  }

  private async seasonMatches(comp: CompetitionConfig): Promise<Match[]> {
    return normalizeOlSeason(await this.season(comp), comp, this.options.now());
  }

  /** Every mapped competition's matches. One season that can't load fails the call, so callers fall back to their cache. */
  private async allMatches(): Promise<Match[]> {
    return (await Promise.all(this.comps.map((comp) => this.seasonMatches(comp)))).flat();
  }

  /** The raw match and its competition, searched through the cached seasons. */
  private async findRaw(matchId: string): Promise<{ raw: OlMatch; comp: CompetitionConfig; season: OlSeason } | null> {
    const id = Number(rawId(matchId));
    const seasons = await Promise.all(this.comps.map((comp) => this.season(comp)));
    for (const [i, season] of seasons.entries()) {
      const raw = season.matches.find((m) => m.matchID === id);
      const comp = this.comps[i];
      if (raw && comp) return { raw, comp, season };
    }
    return null;
  }

  // ── FootballProvider ────────────────────────────────────────────────────

  accessibleCompetitions(): Promise<ProviderCompetitionMeta[]> {
    const label = olSeasonLabel(olSeasonYear(this.options.now()));
    return Promise.resolve(
      this.comps.map((c) => ({ competitionId: c.id, emblem: null, season: { label, startDate: null, endDate: null, currentMatchday: null } })),
    );
  }

  async matchesOnDate(date: string): Promise<Match[]> {
    return (await this.allMatches()).filter((m) => m.utcDate.slice(0, 10) === date);
  }

  async matchesInRange(range: DateRange): Promise<Match[]> {
    return (await this.allMatches()).filter((m) => m.utcDate.slice(0, 10) >= range.from && m.utcDate.slice(0, 10) <= range.to);
  }

  competitionMatches(competition: CompetitionConfig): Promise<Match[]> {
    return this.seasonMatches(competition);
  }

  async standings(competition: CompetitionConfig): Promise<Standings> {
    if (!competition.hasStandings) throw new NotFoundError();
    const season = await this.season(competition);
    const rows = await this.client.getJson<OlTableRow[]>(`getbltable/${season.shortcut}/${season.season}`);
    if (!Array.isArray(rows) || rows.length === 0) throw new NotFoundError();
    return normalizeOlTable(rows, season, competition, this.options.now());
  }

  async scorers(competition: CompetitionConfig, limit: number): Promise<Scorer[]> {
    return olScorers(await this.season(competition), limit);
  }

  async matchDetail(matchId: string): Promise<MatchDetail> {
    const found = await this.findRaw(matchId);
    if (found) return normalizeOlDetail(found.raw, found.comp, this.options.now(), roundInfo(found.season.matches));
    // Not in a current season (an old pin): ask for the single match.
    const raw = await this.client.getJson<OlMatch | null>(`getmatchdata/${rawId(matchId)}`);
    const comp = this.comps.find((c) => c.providers.openLigaDb?.shortcut === raw?.leagueShortcut);
    if (!raw?.matchID || !comp) throw new NotFoundError();
    return normalizeOlDetail(trimOlMatch(raw), comp, this.options.now());
  }

  headToHead(_matchId: string, _detail: MatchDetail): Promise<HeadToHead | null> {
    return Promise.resolve(null);
  }

  async matchesByIds(matchIds: string[]): Promise<Match[]> {
    const wanted = new Set(matchIds);
    return (await this.allMatches()).filter((m) => wanted.has(m.id));
  }

  async team(teamId: string): Promise<TeamBase> {
    const id = Number(rawId(teamId));
    let team: TeamRef | null = null;
    const competitions: { id: string; name: string }[] = [];
    for (const comp of this.comps) {
      const found = olTeams(await this.season(comp)).find((t) => t.id === olId(id));
      if (!found) continue;
      team ??= found;
      competitions.push({ id: comp.id, name: comp.name });
    }
    if (!team) throw new NotFoundError();
    return { team, area: 'Germany', founded: null, venue: null, clubColors: null, website: null, coach: null, competitions, squad: [] };
  }

  async teamMatches(teamId: string, range: DateRange): Promise<Match[]> {
    rawId(teamId);
    return (await this.matchesInRange(range)).filter((m) => m.homeTeam.id === teamId || m.awayTeam.id === teamId);
  }

  async competitionTeams(competition: CompetitionConfig): Promise<TeamRef[]> {
    return olTeams(await this.season(competition));
  }
}

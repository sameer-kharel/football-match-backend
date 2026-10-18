import type { CompetitionCategory, CompetitionFormat, ZoneRule } from '../domain/types.js';

/**
 * The competitions registry. Adding a competition is a config change only:
 * add an entry, map it to at least one provider, done.
 *
 * - `id` is the internal id the app uses in URLs and pins.
 * - `priority`: lower numbers sort first everywhere (lists, pickers, grouping).
 * - `providers.footballData.code` is a football-data.org league code. Whether the
 *   configured token can access it is checked at runtime against /v4/competitions.
 * - `providers.apiFootball` is matched by name + country through /leagues at runtime
 *   (ids are resolved and cached, never hardcoded). Used only when
 *   ENABLE_API_FOOTBALL=true and football-data cannot serve the competition.
 * - `zones` are position ranges for the standings markers. They follow the usual
 *   allocation for the league and may need a tweak when UEFA coefficients shift places.
 */
export interface CompetitionConfig {
  id: string;
  name: string;
  shortName: string;
  category: CompetitionCategory;
  format: CompetitionFormat;
  region: string;
  priority: number;
  hasStandings: boolean;
  hasScorers: boolean;
  hasBracket: boolean;
  defaultEnabled: boolean;
  zones: ZoneRule[];
  /** Extra highlight points for this competition, split by knockout and other rounds. */
  highlightBonus?: { knockout: number; other: number };
  providers: {
    footballData?: { code: string };
    apiFootball?: { name: string; country: string };
  };
}

const z = (zone: ZoneRule['zone'], from: number, to: number, label: string): ZoneRule => ({ zone, from, to, label });

const UEFA_BIG_LEAGUE_20 = [
  z('ucl', 1, 4, 'Champions League'),
  z('uel', 5, 5, 'Europa League'),
  z('uecl', 6, 6, 'Conference League'),
  z('relegation', 18, 20, 'Relegation'),
];

const UEFA_LEAGUE_PHASE = [
  z('knockout', 1, 8, 'Round of 16'),
  z('knockout_playoff', 9, 24, 'Knockout play-offs'),
];

export const COMPETITIONS: readonly CompetitionConfig[] = [
  {
    id: 'WC',
    name: 'FIFA World Cup',
    shortName: 'World Cup',
    category: 'international',
    format: 'tournament',
    region: 'World',
    priority: 1,
    hasStandings: true,
    hasScorers: true,
    hasBracket: true,
    defaultEnabled: true,
    zones: [z('qualified', 1, 2, 'Round of 32'), z('knockout_playoff', 3, 3, 'Best third places advance')],
    highlightBonus: { knockout: 40, other: 20 },
    providers: { footballData: { code: 'WC' }, apiFootball: { name: 'World Cup', country: 'World' } },
  },
  {
    id: 'UCL',
    name: 'UEFA Champions League',
    shortName: 'Champions League',
    category: 'club',
    format: 'cup',
    region: 'Europe',
    priority: 2,
    hasStandings: true,
    hasScorers: true,
    hasBracket: true,
    defaultEnabled: true,
    zones: UEFA_LEAGUE_PHASE,
    highlightBonus: { knockout: 40, other: 20 },
    providers: { footballData: { code: 'CL' }, apiFootball: { name: 'UEFA Champions League', country: 'World' } },
  },
  {
    id: 'EC',
    name: 'UEFA European Championship',
    shortName: 'Euros',
    category: 'international',
    format: 'tournament',
    region: 'Europe',
    priority: 3,
    hasStandings: true,
    hasScorers: true,
    hasBracket: true,
    defaultEnabled: true,
    zones: [z('qualified', 1, 2, 'Round of 16'), z('knockout_playoff', 3, 3, 'Best third places advance')],
    highlightBonus: { knockout: 40, other: 20 },
    providers: { footballData: { code: 'EC' }, apiFootball: { name: 'Euro Championship', country: 'World' } },
  },
  {
    id: 'PL',
    name: 'Premier League',
    shortName: 'Premier League',
    category: 'club',
    format: 'league',
    region: 'England',
    priority: 4,
    hasStandings: true,
    hasScorers: true,
    hasBracket: false,
    defaultEnabled: true,
    zones: UEFA_BIG_LEAGUE_20,
    providers: { footballData: { code: 'PL' }, apiFootball: { name: 'Premier League', country: 'England' } },
  },
  {
    id: 'PD',
    name: 'La Liga',
    shortName: 'La Liga',
    category: 'club',
    format: 'league',
    region: 'Spain',
    priority: 5,
    hasStandings: true,
    hasScorers: true,
    hasBracket: false,
    defaultEnabled: true,
    zones: UEFA_BIG_LEAGUE_20,
    providers: { footballData: { code: 'PD' }, apiFootball: { name: 'La Liga', country: 'Spain' } },
  },
  {
    id: 'SA',
    name: 'Serie A',
    shortName: 'Serie A',
    category: 'club',
    format: 'league',
    region: 'Italy',
    priority: 6,
    hasStandings: true,
    hasScorers: true,
    hasBracket: false,
    defaultEnabled: true,
    zones: UEFA_BIG_LEAGUE_20,
    providers: { footballData: { code: 'SA' }, apiFootball: { name: 'Serie A', country: 'Italy' } },
  },
  {
    id: 'BL1',
    name: 'Bundesliga',
    shortName: 'Bundesliga',
    category: 'club',
    format: 'league',
    region: 'Germany',
    priority: 7,
    hasStandings: true,
    hasScorers: true,
    hasBracket: false,
    defaultEnabled: true,
    zones: [
      z('ucl', 1, 4, 'Champions League'),
      z('uel', 5, 5, 'Europa League'),
      z('uecl', 6, 6, 'Conference League'),
      z('relegation_playoff', 16, 16, 'Relegation play-off'),
      z('relegation', 17, 18, 'Relegation'),
    ],
    providers: { footballData: { code: 'BL1' }, apiFootball: { name: 'Bundesliga', country: 'Germany' } },
  },
  {
    id: 'FL1',
    name: 'Ligue 1',
    shortName: 'Ligue 1',
    category: 'club',
    format: 'league',
    region: 'France',
    priority: 8,
    hasStandings: true,
    hasScorers: true,
    hasBracket: false,
    defaultEnabled: true,
    zones: [
      z('ucl', 1, 4, 'Champions League'),
      z('uel', 5, 5, 'Europa League'),
      z('uecl', 6, 6, 'Conference League'),
      z('relegation_playoff', 16, 16, 'Relegation play-off'),
      z('relegation', 17, 18, 'Relegation'),
    ],
    providers: { footballData: { code: 'FL1' }, apiFootball: { name: 'Ligue 1', country: 'France' } },
  },
  {
    id: 'UEL',
    name: 'UEFA Europa League',
    shortName: 'Europa League',
    category: 'club',
    format: 'cup',
    region: 'Europe',
    priority: 9,
    hasStandings: true,
    hasScorers: true,
    hasBracket: true,
    defaultEnabled: true,
    zones: UEFA_LEAGUE_PHASE,
    highlightBonus: { knockout: 20, other: 5 },
    providers: { footballData: { code: 'EL' }, apiFootball: { name: 'UEFA Europa League', country: 'World' } },
  },
  {
    id: 'COPA',
    name: 'Copa América',
    shortName: 'Copa América',
    category: 'international',
    format: 'tournament',
    region: 'South America',
    priority: 10,
    hasStandings: true,
    hasScorers: true,
    hasBracket: true,
    defaultEnabled: true,
    zones: [z('qualified', 1, 2, 'Quarter-finals')],
    highlightBonus: { knockout: 30, other: 10 },
    providers: { footballData: { code: 'CA' }, apiFootball: { name: 'Copa America', country: 'World' } },
  },
  {
    id: 'UNL',
    name: 'UEFA Nations League',
    shortName: 'Nations League',
    category: 'international',
    format: 'cup',
    region: 'Europe',
    priority: 11,
    hasStandings: true,
    hasScorers: false,
    hasBracket: true,
    defaultEnabled: true,
    zones: [z('qualified', 1, 2, 'Quarter-finals / promotion')],
    highlightBonus: { knockout: 20, other: 5 },
    providers: { apiFootball: { name: 'UEFA Nations League', country: 'World' } },
  },
  {
    id: 'DED',
    name: 'Eredivisie',
    shortName: 'Eredivisie',
    category: 'club',
    format: 'league',
    region: 'Netherlands',
    priority: 12,
    hasStandings: true,
    hasScorers: true,
    hasBracket: false,
    defaultEnabled: true,
    zones: [
      z('ucl', 1, 2, 'Champions League'),
      z('uel', 3, 3, 'Europa League'),
      z('uecl', 4, 4, 'Conference League'),
      z('relegation_playoff', 16, 16, 'Relegation play-off'),
      z('relegation', 17, 18, 'Relegation'),
    ],
    providers: { footballData: { code: 'DED' }, apiFootball: { name: 'Eredivisie', country: 'Netherlands' } },
  },
  {
    id: 'PPL',
    name: 'Primeira Liga',
    shortName: 'Primeira Liga',
    category: 'club',
    format: 'league',
    region: 'Portugal',
    priority: 13,
    hasStandings: true,
    hasScorers: true,
    hasBracket: false,
    defaultEnabled: true,
    zones: [
      z('ucl', 1, 2, 'Champions League'),
      z('uel', 3, 3, 'Europa League'),
      z('uecl', 4, 4, 'Conference League'),
      z('relegation_playoff', 16, 16, 'Relegation play-off'),
      z('relegation', 17, 18, 'Relegation'),
    ],
    providers: { footballData: { code: 'PPL' }, apiFootball: { name: 'Primeira Liga', country: 'Portugal' } },
  },
  {
    id: 'BSA',
    name: 'Brasileirão Série A',
    shortName: 'Brasileirão',
    category: 'club',
    format: 'league',
    region: 'Brazil',
    priority: 14,
    hasStandings: true,
    hasScorers: true,
    hasBracket: false,
    defaultEnabled: true,
    zones: [
      z('libertadores', 1, 6, 'Copa Libertadores'),
      z('sudamericana', 7, 12, 'Copa Sudamericana'),
      z('relegation', 17, 20, 'Relegation'),
    ],
    providers: { footballData: { code: 'BSA' }, apiFootball: { name: 'Serie A', country: 'Brazil' } },
  },
  {
    id: 'ELC',
    name: 'EFL Championship',
    shortName: 'Championship',
    category: 'club',
    format: 'league',
    region: 'England',
    priority: 15,
    hasStandings: true,
    hasScorers: true,
    hasBracket: false,
    defaultEnabled: true,
    zones: [
      z('promotion', 1, 2, 'Promotion'),
      z('promotion_playoff', 3, 6, 'Promotion play-offs'),
      z('relegation', 22, 24, 'Relegation'),
    ],
    providers: { footballData: { code: 'ELC' }, apiFootball: { name: 'Championship', country: 'England' } },
  },
  {
    id: 'WCQ_UEFA',
    name: 'World Cup Qualifying · Europe',
    shortName: 'WCQ Europe',
    category: 'international',
    format: 'cup',
    region: 'Europe',
    priority: 16,
    hasStandings: true,
    hasScorers: false,
    hasBracket: false,
    defaultEnabled: true,
    zones: [z('qualified', 1, 1, 'Qualifies'), z('knockout_playoff', 2, 2, 'Play-offs')],
    providers: { footballData: { code: 'QUFA' }, apiFootball: { name: 'World Cup - Qualification Europe', country: 'World' } },
  },
  {
    id: 'WCQ_CONMEBOL',
    name: 'World Cup Qualifying · South America',
    shortName: 'WCQ South America',
    category: 'international',
    format: 'league',
    region: 'South America',
    priority: 17,
    hasStandings: true,
    hasScorers: false,
    hasBracket: false,
    defaultEnabled: true,
    zones: [z('qualified', 1, 6, 'Qualifies'), z('knockout_playoff', 7, 7, 'Inter-confederation play-off')],
    providers: {
      footballData: { code: 'QCBL' },
      apiFootball: { name: 'World Cup - Qualification South America', country: 'World' },
    },
  },
  {
    id: 'EUROQ',
    name: 'Euro Qualifying',
    shortName: 'Euro Qualifying',
    category: 'international',
    format: 'cup',
    region: 'Europe',
    priority: 18,
    hasStandings: true,
    hasScorers: false,
    hasBracket: false,
    defaultEnabled: true,
    zones: [z('qualified', 1, 2, 'Qualifies')],
    providers: { apiFootball: { name: 'Euro Championship - Qualification', country: 'World' } },
  },
  {
    id: 'FRIENDLIES',
    name: 'International Friendlies',
    shortName: 'Friendlies',
    category: 'international',
    format: 'cup',
    region: 'World',
    priority: 25,
    hasStandings: false,
    hasScorers: false,
    hasBracket: false,
    defaultEnabled: true,
    zones: [],
    providers: { apiFootball: { name: 'Friendlies', country: 'World' } },
  },
];

/** Codes football-data.org documents as free forever. Used only when the live competitions list is unavailable. */
export const FOOTBALL_DATA_FREE_CODES = ['WC', 'CL', 'EC', 'PL', 'PD', 'SA', 'BL1', 'FL1', 'DED', 'PPL', 'BSA', 'ELC'];

const BY_ID = new Map(COMPETITIONS.map((c) => [c.id, c]));

export function competitionById(id: string): CompetitionConfig | undefined {
  return BY_ID.get(id);
}

export function competitionByFootballDataCode(code: string): CompetitionConfig | undefined {
  return COMPETITIONS.find((c) => c.providers.footballData?.code === code);
}

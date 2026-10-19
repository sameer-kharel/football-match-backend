/**
 * Cache lifetimes in seconds. Soft TTLs: after this an entry is refreshed on the
 * next request, but it stays in Redis for HARD_TTL longer as a stale fallback.
 */
export const TTL = {
  /** A UTC day that has a live match, or one starting/ending within the hour. */
  dayActive: 45,
  /** Today, nothing happening right now. */
  dayToday: 300,
  dayFuture: 3_600,
  dayPast: 21_600,
  /** Ranged list used by /highlights (next 8 days). */
  range: 900,
  standings: 900,
  standingsActive: 300,
  scorers: 1_800,
  competitionMatches: 3_600,
  teamMatches: 3_600,
  team: 86_400,
  competitions: 86_400,
  competitionTeams: 86_400,
  matchLive: 30,
  matchSoon: 300,
  matchUpcoming: 3_600,
  matchFinished: 86_400,
  headToHead: 43_200,
  featuredMap: 7 * 86_400,
  notFound: 600,
} as const;

/**
 * API-Football's free plan allows 100 requests a day, so everything lives much
 * longer: today's list refreshes at most every 30 minutes.
 */
export const AF_TTL = {
  dayActive: 1_800,
  dayToday: 3_600,
  dayFuture: 43_200,
  dayPast: 86_400,
  standings: 43_200,
  scorers: 86_400,
  match: 1_800,
  matchFinished: 7 * 86_400,
  headToHead: 7 * 86_400,
  team: 7 * 86_400,
  teamMatches: 21_600,
  league: 7 * 86_400,
} as const;

/**
 * OpenLigaDB publishes no rate limit and has no per-date endpoint. Each league's
 * season file (~300 KB) is cached for hours; the matchdays being played are
 * refetched on their own (~16 KB) and laid over it.
 */
export const OL_TTL = {
  season: 21_600,
  /** A matchday with a match in play or about to start. */
  matchdayActive: 60,
  matchday: 900,
} as const;

export const HARD_TTL = 7 * 86_400;

/** CDN cache policy per endpoint: s-maxage and stale-while-revalidate, seconds. */
export const CDN = {
  live: { sMaxAge: 30, swr: 30 },
  day: { sMaxAge: 60, swr: 120 },
  standings: { sMaxAge: 300, swr: 600 },
  slow: { sMaxAge: 3_600, swr: 86_400 },
  stale: { sMaxAge: 15, swr: 30 },
} as const;

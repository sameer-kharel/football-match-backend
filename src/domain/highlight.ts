import type { FeaturedTier, Match } from './types.js';

/**
 * Highlight ranking. Pure and deterministic; the Flutter app has a line-for-line
 * port in app/lib/core/ranking/highlight.dart. Keep both in sync.
 *
 * Team weights (clubs and national teams use the same scale):
 *   tier 1 vs tier 1            +100
 *   tier 1 vs tier 2/3          +70
 *   tier 1 vs anyone else       +50
 *   no tier-1 team: each tier-2 team +30, each tier-3 team +15
 * Competition bonus (from the registry), e.g. Champions League knockout +40, other +20.
 * Rivalry +25. Live or today +10. Pinned matches always sort above everything.
 */

export const WEIGHTS = {
  bothTier1: 100,
  tier1VsFeatured: 70,
  tier1Alone: 50,
  tier2Each: 30,
  tier3Each: 15,
  rivalry: 25,
  liveOrToday: 10,
} as const;

export interface PinSet {
  teams: ReadonlySet<string>;
  matches: ReadonlySet<string>;
  competitions: ReadonlySet<string>;
}

export interface HighlightContext {
  todayStartMs: number;
  todayEndMs: number;
  pins?: PinSet;
  competitionBonus?: (competitionId: string) => { knockout: number; other: number } | undefined;
}

export interface HighlightResult {
  score: number;
  pinned: boolean;
  /** 3 the match itself is pinned, 2 one of its teams, 1 its competition, 0 not pinned. */
  pinStrength: number;
  live: boolean;
  reasons: string[];
}

export function tierPairScore(a: FeaturedTier | null, b: FeaturedTier | null): number {
  const tier1Count = (a === 1 ? 1 : 0) + (b === 1 ? 1 : 0);
  if (tier1Count === 2) return WEIGHTS.bothTier1;
  if (tier1Count === 1) {
    const other = a === 1 ? b : a;
    return other === 2 || other === 3 ? WEIGHTS.tier1VsFeatured : WEIGHTS.tier1Alone;
  }
  const each = (t: FeaturedTier | null) => (t === 2 ? WEIGHTS.tier2Each : t === 3 ? WEIGHTS.tier3Each : 0);
  return each(a) + each(b);
}

export function pinStrength(match: Match, pins: PinSet | undefined): number {
  if (!pins) return 0;
  if (pins.matches.has(match.id)) return 3;
  if (pins.teams.has(match.homeTeam.id) || pins.teams.has(match.awayTeam.id)) return 2;
  if (pins.competitions.has(match.competitionId)) return 1;
  return 0;
}

export function isPinned(match: Match, pins: PinSet | undefined): boolean {
  return pinStrength(match, pins) > 0;
}

export function isLive(match: Match): boolean {
  return match.status === 'live' || match.status === 'paused';
}

export function scoreMatch(match: Match, ctx: HighlightContext): HighlightResult {
  const reasons: string[] = [];
  let score = 0;

  const teamScore = tierPairScore(match.homeTeam.featuredTier, match.awayTeam.featuredTier);
  if (teamScore > 0) {
    score += teamScore;
    reasons.push(`teams:+${teamScore}`);
  }

  const bonus = ctx.competitionBonus?.(match.competitionId);
  if (bonus) {
    const add = match.isKnockout ? bonus.knockout : bonus.other;
    if (add > 0) {
      score += add;
      reasons.push(`${match.isKnockout ? 'knockout' : 'competition'}:+${add}`);
    }
  }

  if (match.rivalry) {
    score += WEIGHTS.rivalry;
    reasons.push(`rivalry:+${WEIGHTS.rivalry}`);
  }

  const live = isLive(match);
  const kickoff = Date.parse(match.utcDate);
  const today = kickoff >= ctx.todayStartMs && kickoff < ctx.todayEndMs;
  if (live || today) {
    score += WEIGHTS.liveOrToday;
    reasons.push(`${live ? 'live' : 'today'}:+${WEIGHTS.liveOrToday}`);
  }

  const strength = pinStrength(match, ctx.pins);
  return { score, pinned: strength > 0, pinStrength: strength, live, reasons };
}

export interface Ranked {
  match: Match;
  result: HighlightResult;
}

/**
 * Pinned first (live pinned at the very top, then the most directly pinned),
 * then score, then kickoff, then id for stability.
 */
export function compareRanked(a: Ranked, b: Ranked): number {
  if (a.result.pinned !== b.result.pinned) return a.result.pinned ? -1 : 1;
  if (a.result.pinned && a.result.live !== b.result.live) return a.result.live ? -1 : 1;
  if (a.result.pinStrength !== b.result.pinStrength) return b.result.pinStrength - a.result.pinStrength;
  if (a.result.score !== b.result.score) return b.result.score - a.result.score;
  const ka = Date.parse(a.match.utcDate);
  const kb = Date.parse(b.match.utcDate);
  if (ka !== kb) return ka - kb;
  return a.match.id < b.match.id ? -1 : a.match.id > b.match.id ? 1 : 0;
}

export function rankMatches(
  matches: readonly Match[],
  ctx: HighlightContext,
  options: { limit?: number; minScore?: number } = {},
): Match[] {
  const minScore = options.minScore ?? 0;
  return matches
    .map((match) => ({ match, result: scoreMatch(match, ctx) }))
    .filter((r) => r.result.pinned || r.result.score > minScore)
    .sort(compareRanked)
    .slice(0, options.limit ?? Number.POSITIVE_INFINITY)
    .map((r) => ({ ...r.match, highlightScore: r.result.score }));
}

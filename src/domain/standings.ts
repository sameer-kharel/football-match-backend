import type { FormResult, Match, StandingGroup, StandingRow, TeamRef, ZoneId, ZoneRule } from './types.js';

export function zoneFor(position: number, zones: readonly ZoneRule[]): ZoneId | null {
  return zones.find((z) => position >= z.from && position <= z.to)?.zone ?? null;
}

interface Acc {
  team: TeamRef;
  played: number;
  won: number;
  draw: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  results: { at: string; r: FormResult }[];
}

/**
 * Group tables computed from group-stage results, for tournaments whose
 * provider has no standings (football-data answers 404 for the World Cup).
 * Three points a win; ties broken by goal difference, goals scored, then name.
 * Head-to-head tiebreakers aren't applied, so a tight group can differ from
 * the official table.
 */
export function computeGroupStandings(matches: readonly Match[], zones: readonly ZoneRule[]): StandingGroup[] {
  const groups = new Map<string, Map<string, Acc>>();
  const blank = (team: TeamRef): Acc => ({ team, played: 0, won: 0, draw: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, results: [] });

  for (const m of matches) {
    if (m.stage !== 'GROUP_STAGE' || !m.group) continue;
    const table = groups.get(m.group) ?? new Map<string, Acc>();
    groups.set(m.group, table);
    const home = table.get(m.homeTeam.id) ?? blank(m.homeTeam);
    const away = table.get(m.awayTeam.id) ?? blank(m.awayTeam);
    table.set(m.homeTeam.id, home);
    table.set(m.awayTeam.id, away);

    const done = m.status === 'finished' || m.status === 'awarded';
    const h = m.score.home;
    const a = m.score.away;
    if (!done || h === null || a === null) continue;
    for (const [acc, gf, ga] of [[home, h, a], [away, a, h]] as const) {
      acc.played++;
      acc.goalsFor += gf;
      acc.goalsAgainst += ga;
      const r: FormResult = gf > ga ? 'W' : gf < ga ? 'L' : 'D';
      if (r === 'W') acc.won++;
      else if (r === 'L') acc.lost++;
      else acc.draw++;
      acc.results.push({ at: m.utcDate, r });
    }
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, table]) => {
      const sorted = [...table.values()].sort((x, y) => {
        const px = x.won * 3 + x.draw;
        const py = y.won * 3 + y.draw;
        if (px !== py) return py - px;
        const gx = x.goalsFor - x.goalsAgainst;
        const gy = y.goalsFor - y.goalsAgainst;
        if (gx !== gy) return gy - gx;
        if (x.goalsFor !== y.goalsFor) return y.goalsFor - x.goalsFor;
        return x.team.name.localeCompare(y.team.name);
      });
      const rows: StandingRow[] = sorted.map((acc, i) => ({
        position: i + 1,
        team: acc.team,
        played: acc.played,
        won: acc.won,
        draw: acc.draw,
        lost: acc.lost,
        goalsFor: acc.goalsFor,
        goalsAgainst: acc.goalsAgainst,
        goalDifference: acc.goalsFor - acc.goalsAgainst,
        points: acc.won * 3 + acc.draw,
        form: acc.results.sort((p, q) => p.at.localeCompare(q.at)).slice(-5).map((x) => x.r),
        zone: zoneFor(i + 1, zones),
      }));
      return { name, stage: 'GROUP_STAGE', rows };
    });
}

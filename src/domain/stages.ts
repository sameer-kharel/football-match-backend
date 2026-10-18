/** Canonical stage keys follow football-data's enum; API-Football round names map onto them. */
const LABELS: Record<string, string | null> = {
  FINAL: 'Final',
  THIRD_PLACE: 'Third place',
  SEMI_FINALS: 'Semi-finals',
  QUARTER_FINALS: 'Quarter-finals',
  LAST_16: 'Round of 16',
  LAST_32: 'Round of 32',
  LAST_64: 'Round of 64',
  ROUND_1: 'Round 1',
  ROUND_2: 'Round 2',
  ROUND_3: 'Round 3',
  ROUND_4: 'Round 4',
  GROUP_STAGE: 'Group stage',
  LEAGUE_STAGE: 'League phase',
  PRELIMINARY_ROUND: 'Preliminary round',
  QUALIFICATION: 'Qualifying',
  QUALIFICATION_ROUND_1: 'Qualifying round 1',
  QUALIFICATION_ROUND_2: 'Qualifying round 2',
  QUALIFICATION_ROUND_3: 'Qualifying round 3',
  PLAYOFF_ROUND_1: 'Play-off round 1',
  PLAYOFF_ROUND_2: 'Play-off round 2',
  PLAYOFFS: 'Knockout play-offs',
  REGULAR_SEASON: null,
  CLAUSURA: 'Clausura',
  APERTURA: 'Apertura',
  CHAMPIONSHIP: 'Championship round',
  RELEGATION: 'Relegation round',
  RELEGATION_ROUND: 'Relegation round',
};

const KNOCKOUT = new Set([
  'FINAL',
  'THIRD_PLACE',
  'SEMI_FINALS',
  'QUARTER_FINALS',
  'LAST_16',
  'LAST_32',
  'LAST_64',
  'PLAYOFFS',
  'PLAYOFF_ROUND_1',
  'PLAYOFF_ROUND_2',
]);

export function stageLabel(stage: string | null | undefined): string | null {
  if (!stage) return null;
  if (stage in LABELS) return LABELS[stage] ?? null;
  return stage
    .toLowerCase()
    .split('_')
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export function isKnockoutStage(stage: string | null | undefined): boolean {
  return !!stage && KNOCKOUT.has(stage);
}

/** "GROUP_A" → "Group A"; passes through already-readable names. */
export function groupLabel(group: string | null | undefined): string | null {
  if (!group) return null;
  const m = /^GROUP_([A-Z0-9]+)$/.exec(group);
  return m ? `Group ${m[1]}` : group;
}

export function seasonLabel(startDate: string | null | undefined, endDate: string | null | undefined): string | null {
  const start = startDate?.slice(0, 4);
  const end = endDate?.slice(0, 4);
  if (!start) return null;
  if (!end || end === start) return start;
  return `${start}/${end.slice(2)}`;
}

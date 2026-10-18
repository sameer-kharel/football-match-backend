const STOPWORDS = new Set([
  'fc', 'cf', 'afc', 'sc', 'ac', 'as', 'ss', 'ssc', 'sl', 'cr', 'bv', 'sv', 'club', 'de', 'cd', 'the', 'calcio', 'football', 'futbol',
]);

/**
 * Normalizes a team name for fuzzy-but-safe matching: lowercase, strips diacritics,
 * punctuation and club-form tokens ("FC", "CF", "AFC"...). "Club Atlético de Madrid"
 * and "Atletico Madrid" both become "atletico madrid".
 */
export function normalizeTeamName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length > 0 && !STOPWORDS.has(t) && !/^\d{2,4}$/.test(t))
    .join(' ');
}

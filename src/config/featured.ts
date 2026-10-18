import type { FeaturedTier } from '../domain/types.js';

/**
 * Featured teams drive the "Big matches" ranking. Teams are listed by name and
 * aliases only; provider ids are resolved at runtime by matching names against
 * each competition's team list (see services/featured.ts) and cached in Redis.
 *
 * `resolveIn` lists the registry competitions whose team lists are searched.
 * `color` is a brand color used for a subtle tint in the highlight card.
 * `tier: null` entries exist only so rivalries can reference them.
 */
export interface FeaturedTeam {
  key: string;
  name: string;
  aliases: string[];
  tier: FeaturedTier | null;
  kind: 'club' | 'national';
  resolveIn: string[];
  color: string;
}

export const FEATURED_CLUBS: readonly FeaturedTeam[] = [
  // Tier 1
  { key: 'real-madrid', name: 'Real Madrid', aliases: ['Real Madrid CF'], tier: 1, kind: 'club', resolveIn: ['PD'], color: '#FEBE10' },
  { key: 'barcelona', name: 'FC Barcelona', aliases: ['Barcelona', 'Barça'], tier: 1, kind: 'club', resolveIn: ['PD'], color: '#A50044' },
  { key: 'man-city', name: 'Manchester City', aliases: ['Manchester City FC', 'Man City'], tier: 1, kind: 'club', resolveIn: ['PL'], color: '#6CABDD' },
  { key: 'arsenal', name: 'Arsenal', aliases: ['Arsenal FC'], tier: 1, kind: 'club', resolveIn: ['PL'], color: '#EF0107' },
  // Tier 2
  { key: 'liverpool', name: 'Liverpool', aliases: ['Liverpool FC'], tier: 2, kind: 'club', resolveIn: ['PL'], color: '#C8102E' },
  { key: 'bayern', name: 'Bayern Munich', aliases: ['FC Bayern München', 'Bayern München', 'Bayern'], tier: 2, kind: 'club', resolveIn: ['BL1'], color: '#DC052D' },
  { key: 'psg', name: 'Paris Saint-Germain', aliases: ['Paris Saint-Germain FC', 'Paris Saint Germain', 'PSG'], tier: 2, kind: 'club', resolveIn: ['FL1'], color: '#004170' },
  { key: 'chelsea', name: 'Chelsea', aliases: ['Chelsea FC'], tier: 2, kind: 'club', resolveIn: ['PL'], color: '#034694' },
  // Tier 3
  { key: 'atletico', name: 'Atlético Madrid', aliases: ['Club Atlético de Madrid', 'Atletico Madrid', 'Atleti'], tier: 3, kind: 'club', resolveIn: ['PD'], color: '#CB3524' },
  { key: 'man-united', name: 'Manchester United', aliases: ['Manchester United FC', 'Man United', 'Man Utd'], tier: 3, kind: 'club', resolveIn: ['PL'], color: '#DA291C' },
  { key: 'inter', name: 'Inter', aliases: ['FC Internazionale Milano', 'Internazionale', 'Inter Milan'], tier: 3, kind: 'club', resolveIn: ['SA'], color: '#0068A8' },
  { key: 'juventus', name: 'Juventus', aliases: ['Juventus FC'], tier: 3, kind: 'club', resolveIn: ['SA'], color: '#A0A0A0' },
  { key: 'milan', name: 'AC Milan', aliases: ['Milan'], tier: 3, kind: 'club', resolveIn: ['SA'], color: '#FB090B' },
  { key: 'dortmund', name: 'Borussia Dortmund', aliases: ['BV Borussia 09 Dortmund', 'Dortmund', 'BVB'], tier: 3, kind: 'club', resolveIn: ['BL1'], color: '#FDE100' },
  { key: 'tottenham', name: 'Tottenham Hotspur', aliases: ['Tottenham Hotspur FC', 'Tottenham', 'Spurs'], tier: 3, kind: 'club', resolveIn: ['PL'], color: '#132257' },
  // Rivalry-only entries
  { key: 'marseille', name: 'Olympique de Marseille', aliases: ['Marseille', 'Olympique Marseille'], tier: null, kind: 'club', resolveIn: ['FL1'], color: '#2FAEE0' },
  { key: 'everton', name: 'Everton', aliases: ['Everton FC'], tier: null, kind: 'club', resolveIn: ['PL'], color: '#003399' },
  { key: 'roma', name: 'AS Roma', aliases: ['Roma'], tier: null, kind: 'club', resolveIn: ['SA'], color: '#8E1F2F' },
  { key: 'lazio', name: 'SS Lazio', aliases: ['Lazio'], tier: null, kind: 'club', resolveIn: ['SA'], color: '#87D8F7' },
  { key: 'benfica', name: 'SL Benfica', aliases: ['Sport Lisboa e Benfica', 'Benfica'], tier: null, kind: 'club', resolveIn: ['PPL'], color: '#E83030' },
  { key: 'porto', name: 'FC Porto', aliases: ['Porto'], tier: null, kind: 'club', resolveIn: ['PPL'], color: '#00428C' },
  { key: 'ajax', name: 'AFC Ajax', aliases: ['Ajax'], tier: null, kind: 'club', resolveIn: ['DED'], color: '#D2122E' },
  { key: 'feyenoord', name: 'Feyenoord', aliases: ['Feyenoord Rotterdam'], tier: null, kind: 'club', resolveIn: ['DED'], color: '#ED1C24' },
  { key: 'flamengo', name: 'CR Flamengo', aliases: ['Flamengo'], tier: null, kind: 'club', resolveIn: ['BSA'], color: '#C3281E' },
  { key: 'fluminense', name: 'Fluminense FC', aliases: ['Fluminense'], tier: null, kind: 'club', resolveIn: ['BSA'], color: '#7A0026' },
];

export const FEATURED_NATIONS: readonly FeaturedTeam[] = [
  // International tier 1
  { key: 'brazil', name: 'Brazil', aliases: ['Brasil'], tier: 1, kind: 'national', resolveIn: ['WC'], color: '#F9D616' },
  { key: 'argentina', name: 'Argentina', aliases: [], tier: 1, kind: 'national', resolveIn: ['WC'], color: '#75AADB' },
  { key: 'france', name: 'France', aliases: [], tier: 1, kind: 'national', resolveIn: ['WC', 'EC'], color: '#2A4BA0' },
  { key: 'england', name: 'England', aliases: [], tier: 1, kind: 'national', resolveIn: ['WC', 'EC'], color: '#CE1124' },
  { key: 'spain', name: 'Spain', aliases: ['España'], tier: 1, kind: 'national', resolveIn: ['WC', 'EC'], color: '#C60B1E' },
  { key: 'germany', name: 'Germany', aliases: ['Deutschland'], tier: 1, kind: 'national', resolveIn: ['WC', 'EC'], color: '#DD0000' },
  { key: 'portugal', name: 'Portugal', aliases: [], tier: 1, kind: 'national', resolveIn: ['WC', 'EC'], color: '#046A38' },
  // International tier 2
  { key: 'netherlands', name: 'Netherlands', aliases: ['Holland'], tier: 2, kind: 'national', resolveIn: ['WC', 'EC'], color: '#F36C21' },
  { key: 'italy', name: 'Italy', aliases: ['Italia'], tier: 2, kind: 'national', resolveIn: ['WC', 'EC'], color: '#0064AA' },
  { key: 'belgium', name: 'Belgium', aliases: [], tier: 2, kind: 'national', resolveIn: ['WC', 'EC'], color: '#ED2939' },
  { key: 'croatia', name: 'Croatia', aliases: ['Hrvatska'], tier: 2, kind: 'national', resolveIn: ['WC', 'EC'], color: '#E5262D' },
  { key: 'morocco', name: 'Morocco', aliases: [], tier: 2, kind: 'national', resolveIn: ['WC'], color: '#C1272D' },
  { key: 'uruguay', name: 'Uruguay', aliases: [], tier: 2, kind: 'national', resolveIn: ['WC'], color: '#55B5E5' },
  // International tier 3
  { key: 'usa', name: 'United States', aliases: ['USA'], tier: 3, kind: 'national', resolveIn: ['WC'], color: '#0A3161' },
  { key: 'mexico', name: 'Mexico', aliases: ['México'], tier: 3, kind: 'national', resolveIn: ['WC'], color: '#006847' },
  { key: 'japan', name: 'Japan', aliases: [], tier: 3, kind: 'national', resolveIn: ['WC'], color: '#1C2C5B' },
  { key: 'colombia', name: 'Colombia', aliases: [], tier: 3, kind: 'national', resolveIn: ['WC'], color: '#FCD116' },
  { key: 'senegal', name: 'Senegal', aliases: [], tier: 3, kind: 'national', resolveIn: ['WC'], color: '#00853F' },
];

export const ALL_FEATURED: readonly FeaturedTeam[] = [...FEATURED_CLUBS, ...FEATURED_NATIONS];

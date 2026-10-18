/** Rivalries reference featured team keys (config/featured.ts). Order inside a pair does not matter. */
export interface Rivalry {
  name: string;
  teams: [string, string];
}

export const RIVALRIES: readonly Rivalry[] = [
  { name: 'El Clásico', teams: ['real-madrid', 'barcelona'] },
  { name: 'Madrid derby', teams: ['real-madrid', 'atletico'] },
  { name: 'Manchester derby', teams: ['man-city', 'man-united'] },
  { name: 'North London derby', teams: ['arsenal', 'tottenham'] },
  { name: 'North West derby', teams: ['liverpool', 'man-united'] },
  { name: 'Merseyside derby', teams: ['liverpool', 'everton'] },
  { name: 'Derby della Madonnina', teams: ['inter', 'milan'] },
  { name: "Derby d'Italia", teams: ['inter', 'juventus'] },
  { name: 'Derby della Capitale', teams: ['roma', 'lazio'] },
  { name: 'Der Klassiker', teams: ['bayern', 'dortmund'] },
  { name: 'Le Classique', teams: ['psg', 'marseille'] },
  { name: 'O Clássico', teams: ['benfica', 'porto'] },
  { name: 'De Klassieker', teams: ['ajax', 'feyenoord'] },
  { name: 'Fla-Flu', teams: ['flamengo', 'fluminense'] },
  { name: 'Superclásico de las Américas', teams: ['brazil', 'argentina'] },
  { name: 'England v Germany', teams: ['england', 'germany'] },
  { name: 'Iberian derby', teams: ['spain', 'portugal'] },
  { name: 'Netherlands v Germany', teams: ['netherlands', 'germany'] },
  { name: 'England v Argentina', teams: ['england', 'argentina'] },
];

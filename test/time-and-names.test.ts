import { describe, expect, it } from 'vitest';
import { normalizeTeamName } from '../src/domain/names.js';
import { addDays, localDate, localDayWindow, tzOffsetMinutes, utcDatesCovering } from '../src/domain/time.js';
import { featuredByName, matchFeaturedTeams, rivalryFor } from '../src/services/featured.js';

const iso = (ms: number) => new Date(ms).toISOString();

describe('time zones', () => {
  it('handles Asia/Kathmandu (UTC+5:45)', () => {
    expect(tzOffsetMinutes('Asia/Kathmandu', Date.parse('2026-10-18T00:00:00Z'))).toBe(345);
    const w = localDayWindow('2026-10-18', 'Asia/Kathmandu');
    expect(iso(w.startMs)).toBe('2026-10-17T18:15:00.000Z');
    expect(iso(w.endMs)).toBe('2026-10-18T18:15:00.000Z');
    expect(utcDatesCovering(w.startMs, w.endMs)).toEqual(['2026-10-17', '2026-10-18']);
  });

  it('handles DST transitions (Europe/London, 25-hour day)', () => {
    const w = localDayWindow('2026-10-25', 'Europe/London');
    expect(iso(w.startMs)).toBe('2026-10-24T23:00:00.000Z');
    expect(iso(w.endMs)).toBe('2026-10-26T00:00:00.000Z');
    expect((w.endMs - w.startMs) / 3_600_000).toBe(25);
  });

  it('handles negative offsets and the date line', () => {
    expect(iso(localDayWindow('2026-10-18', 'America/Los_Angeles').startMs)).toBe('2026-10-18T07:00:00.000Z');
    expect(iso(localDayWindow('2026-10-18', 'Pacific/Kiritimati').startMs)).toBe('2026-10-17T10:00:00.000Z');
  });

  it('computes the local date of an instant', () => {
    expect(localDate(Date.parse('2026-10-17T19:00:00Z'), 'Asia/Kathmandu')).toBe('2026-10-18');
    expect(localDate(Date.parse('2026-10-17T19:00:00Z'), 'UTC')).toBe('2026-10-17');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('team name matching', () => {
  it('normalizes club forms and diacritics', () => {
    expect(normalizeTeamName('Club Atlético de Madrid')).toBe('atletico madrid');
    expect(normalizeTeamName('FC Bayern München')).toBe('bayern munchen');
    expect(normalizeTeamName('Paris Saint-Germain FC')).toBe('paris saint germain');
    expect(normalizeTeamName('BV Borussia 09 Dortmund')).toBe('borussia dortmund');
  });

  it('matches provider names to featured teams, keeping clubs and nations apart', () => {
    expect(featuredByName({ name: 'Real Madrid CF', shortName: 'Real Madrid', national: false })?.tier).toBe(1);
    expect(featuredByName({ name: 'Atletico Madrid', shortName: 'Atletico Madrid', national: false })?.key).toBe('atletico');
    expect(featuredByName({ name: 'Brazil', shortName: 'Brazil', national: true })?.tier).toBe(1);
    expect(featuredByName({ name: 'Brazil', shortName: 'Brazil', national: false })).toBeUndefined();
    expect(featuredByName({ name: 'Real Madrid Castilla', shortName: 'Castilla', national: false })).toBeUndefined();
  });

  it('resolves ids from a competition team list', () => {
    const teams = [
      { id: 'fd-57', name: 'Arsenal FC', shortName: 'Arsenal', tla: 'ARS', crest: null, national: false, featuredTier: null, color: null },
      { id: 'fd-1044', name: 'AFC Bournemouth', shortName: 'Bournemouth', tla: 'BOU', crest: null, national: false, featuredTier: null, color: null },
    ];
    expect(matchFeaturedTeams(teams, 'club')).toEqual({ 'fd-57': 'arsenal' });
  });

  it('detects rivalries in either order', () => {
    const t = (name: string) => ({ id: name, name, shortName: name, tla: null, crest: null, national: false, featuredTier: null, color: null });
    expect(rivalryFor(t('FC Barcelona'), t('Real Madrid CF'), null)).toBe('El Clásico');
    expect(rivalryFor(t('Tottenham Hotspur FC'), t('Arsenal FC'), null)).toBe('North London derby');
    expect(rivalryFor(t('Arsenal FC'), t('Chelsea FC'), null)).toBeNull();
  });
});

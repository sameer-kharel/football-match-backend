import { describe, expect, it } from 'vitest';
import { ValidationError } from '../src/lib/errors.js';
import {
  CompetitionMatchesQuery,
  HighlightsQuery,
  MatchParams,
  MatchesByDateQuery,
  PinnedQuery,
  ScorersQuery,
  TeamParams,
  parse,
} from '../src/lib/validation.js';

function issues(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    if (e instanceof ValidationError) return e.details?.map((d) => d.path) ?? [];
    throw e;
  }
  throw new Error('expected a ValidationError');
}

describe('query validation', () => {
  it('accepts a date, an IANA zone and a competition list', () => {
    const q = parse(MatchesByDateQuery, { date: '2026-10-18', tz: 'Asia/Kathmandu', competitions: 'PL, PD,PL,UCL' });
    expect(q).toEqual({ date: '2026-10-18', tz: 'Asia/Kathmandu', competitions: ['PL', 'PD', 'UCL'] });
  });

  it('defaults tz to UTC and competitions to empty', () => {
    expect(parse(MatchesByDateQuery, { date: '2026-10-18' })).toEqual({ date: '2026-10-18', tz: 'UTC', competitions: [] });
  });

  it.each([
    [{ date: '18-10-2026' }, 'date'],
    [{ date: '2026-02-30' }, 'date'],
    [{ date: '2026-10-18', tz: 'Mars/Olympus' }, 'tz'],
    [{ date: '2026-10-18', competitions: 'pl' }, 'competitions.0'],
  ])('rejects %j', (input, path) => {
    expect(issues(() => parse(MatchesByDateQuery, input))).toContain(path);
  });

  it('rejects unknown parameters', () => {
    expect(issues(() => parse(MatchesByDateQuery, { date: '2026-10-18', foo: 'bar' }))).toContain('(query)');
  });

  it('validates competition match ranges and statuses', () => {
    expect(parse(CompetitionMatchesQuery, { from: '2026-10-01', to: '2026-10-31', status: 'live,finished' })).toMatchObject({ status: ['live', 'finished'] });
    expect(issues(() => parse(CompetitionMatchesQuery, { from: '2026-10-31', to: '2026-10-01' }))).toContain('from');
    expect(issues(() => parse(CompetitionMatchesQuery, { from: '2025-01-01', to: '2026-10-01' }))).toContain('to');
    expect(issues(() => parse(CompetitionMatchesQuery, { status: 'halftime' }))).toContain('status.0');
  });

  it('caps pinned lists and checks id formats', () => {
    expect(parse(PinnedQuery, { teams: 'fd-57,af-541', matches: 'fd-1' })).toMatchObject({ teams: ['fd-57', 'af-541'], matches: ['fd-1'], competitions: [] });
    expect(issues(() => parse(PinnedQuery, { teams: '57' }))).toContain('teams.0');
    const many = Array.from({ length: 31 }, (_, i) => `fd-${i}`).join(',');
    expect(issues(() => parse(PinnedQuery, { teams: many }))).toContain('teams');
  });

  it('coerces and bounds numeric params', () => {
    expect(parse(ScorersQuery, {})).toEqual({ limit: 20 });
    expect(parse(ScorersQuery, { limit: '5' })).toEqual({ limit: 5 });
    expect(issues(() => parse(ScorersQuery, { limit: '500' }))).toContain('limit');
    expect(parse(HighlightsQuery, { days: '3' })).toMatchObject({ days: 3, limit: 12, tz: 'UTC' });
  });

  it('validates path ids', () => {
    expect(parse(MatchParams, { id: 'fd-497411' })).toEqual({ id: 'fd-497411' });
    expect(issues(() => parse(MatchParams, { id: 'pinned' }))).toContain('id');
    expect(issues(() => parse(TeamParams, { id: 'fd-12345678901' }))).toContain('id');
  });
});

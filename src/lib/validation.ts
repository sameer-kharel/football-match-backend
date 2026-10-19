import { z } from 'zod';
import { diffDays, isValidTimeZone } from '../domain/time.js';
import { ValidationError } from './errors.js';

export const competitionId = z.string().regex(/^[A-Z0-9_]{2,24}$/, 'Expected a competition id like PL or UCL');
export const teamId = z.string().regex(/^(fd|af|ol)-\d{1,10}$/, 'Expected a team id like fd-57');
export const matchId = z.string().regex(/^(fd|af|ol)-\d{1,10}$/, 'Expected a match id like fd-497411');
export const isoDate = z.iso.date('Expected a date as YYYY-MM-DD');
export const timeZone = z
  .string()
  .max(64)
  .refine(isValidTimeZone, 'Unknown IANA time zone, e.g. Asia/Kathmandu')
  .optional()
  .default('UTC');

export const matchStatus = z.enum(['scheduled', 'live', 'paused', 'finished', 'postponed', 'suspended', 'cancelled', 'awarded']);

/** "a,b,c" → ['a','b','c'], trimmed, de-duplicated, each item validated, at most `max`. */
export function csv<T extends z.ZodType<string, string>>(item: T, max: number) {
  return z
    .string()
    .max(4_000)
    .optional()
    .transform((s) => (s ? [...new Set(s.split(',').map((x) => x.trim()).filter(Boolean))] : []))
    .pipe(z.array(item).max(max, `At most ${max} items`));
}

const intParam = (min: number, max: number, fallback: number) => z.coerce.number().int().min(min).max(max).optional().default(fallback);

export const MatchesByDateQuery = z.strictObject({
  date: isoDate,
  tz: timeZone,
  competitions: csv(competitionId, 40),
});

export const CompetitionMatchesQuery = z
  .strictObject({
    from: isoDate.optional(),
    to: isoDate.optional(),
    status: csv(matchStatus, 8),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: '`from` must be on or before `to`', path: ['from'] })
  .refine((q) => !q.from || !q.to || diffDays(q.from, q.to) <= 400, { message: 'Date range is limited to 400 days', path: ['to'] });

export const ScorersQuery = z.strictObject({ limit: intParam(1, 30, 20) });

export const PinnedQuery = z.strictObject({
  teams: csv(teamId, 30),
  matches: csv(matchId, 50),
  competitions: csv(competitionId, 20),
  tz: timeZone,
});

export const HighlightsQuery = z.strictObject({
  tz: timeZone,
  days: intParam(1, 7, 7),
  limit: intParam(1, 30, 12),
  teams: csv(teamId, 30),
  matches: csv(matchId, 50),
  competitions: csv(competitionId, 20),
});

export const EmptyQuery = z.strictObject({});

export const CompetitionParams = z.strictObject({ id: competitionId });
export const MatchParams = z.strictObject({ id: matchId });
export const TeamParams = z.strictObject({ id: teamId });

/** Requests further than this from today are rejected: no provider has useful data there. */
export const MAX_DAYS_FROM_TODAY = 400;

export function assertNearToday(date: string, nowMs: number, path = 'date'): void {
  const today = new Date(nowMs).toISOString().slice(0, 10);
  if (Math.abs(diffDays(today, date)) > MAX_DAYS_FROM_TODAY) {
    throw new ValidationError([{ path, message: `Pick a date within ${MAX_DAYS_FROM_TODAY} days of today` }]);
  }
}

export function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(
      result.error.issues.map((i) => ({ path: i.path.length > 0 ? i.path.join('.') : '(query)', message: i.message })),
    );
  }
  return result.data;
}

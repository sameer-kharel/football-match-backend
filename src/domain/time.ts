const DAY_MS = 86_400_000;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Offset of `timeZone` from UTC at `instantMs`, in minutes (Asia/Kathmandu → 345). */
export function tzOffsetMinutes(timeZone: string, instantMs: number): number {
  const parts = formatterFor(timeZone).formatToParts(new Date(instantMs));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  const truncated = Math.floor(instantMs / 1000) * 1000;
  return Math.round((asUtc - truncated) / 60_000);
}

function parseDate(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y ?? 1970, (m ?? 1) - 1, d ?? 1];
}

/** UTC instant of local midnight for `date` (YYYY-MM-DD) in `timeZone`. DST-safe. */
export function localMidnightUtc(date: string, timeZone: string): number {
  const [y, m, d] = parseDate(date);
  const guess = Date.UTC(y, m, d);
  const first = guess - tzOffsetMinutes(timeZone, guess) * 60_000;
  const second = guess - tzOffsetMinutes(timeZone, first) * 60_000;
  return second;
}

/** [start, end) UTC instants covering the local calendar day. */
export function localDayWindow(date: string, timeZone: string): { startMs: number; endMs: number } {
  return { startMs: localMidnightUtc(date, timeZone), endMs: localMidnightUtc(addDays(date, 1), timeZone) };
}

export function toUtcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = parseDate(date);
  return toUtcDate(Date.UTC(y, m, d) + days * DAY_MS);
}

export function diffDays(from: string, to: string): number {
  const [y1, m1, d1] = parseDate(from);
  const [y2, m2, d2] = parseDate(to);
  return Math.round((Date.UTC(y2, m2, d2) - Date.UTC(y1, m1, d1)) / DAY_MS);
}

/** Calendar date (YYYY-MM-DD) of `instantMs` as seen in `timeZone`. */
export function localDate(instantMs: number, timeZone: string): string {
  return toUtcDate(instantMs + tzOffsetMinutes(timeZone, instantMs) * 60_000);
}

/** Every UTC calendar date touched by the half-open window [startMs, endMs). */
export function utcDatesCovering(startMs: number, endMs: number): string[] {
  const dates: string[] = [];
  let cursor = toUtcDate(startMs);
  const last = toUtcDate(endMs - 1);
  while (cursor <= last) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

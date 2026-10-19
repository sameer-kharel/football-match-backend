import type { Match, Source } from '../domain/types.js';
import { NotFoundError, PlanRestrictedError, isAppError } from '../lib/errors.js';
import { errorMessage } from '../lib/logger.js';
import type { ActiveCompetition } from './availability.js';
import { SOURCE_NAMES } from './availability.js';
import type { AppContext } from './context.js';
import type { MetaCollector } from './meta.js';

/**
 * Backups are used only when a competition's source fails and nothing is cached
 * (the cache serves stale data for a week first). Their ids carry their own prefix
 * ("ol-…"), so match and team pages keep working against the backup.
 */

export function backupNotice(comp: ActiveCompetition, used: Source): string {
  return `${comp.config.shortName} is coming from ${SOURCE_NAMES[used]} while ${SOURCE_NAMES[comp.source]} is unavailable.`;
}

/**
 * Loads from the competition's source, then each backup in turn. A not-found or
 * plan answer from the source is final: the data doesn't exist, it isn't down.
 */
export async function withFailover<T>(ctx: AppContext, comp: ActiveCompetition, meta: MetaCollector, load: (source: Source) => Promise<T>): Promise<T> {
  let firstError: unknown = null;
  for (const source of [comp.source, ...comp.backups]) {
    try {
      const value = await load(source);
      if (source !== comp.source) meta.warn(backupNotice(comp, source));
      return value;
    } catch (e) {
      if (source === comp.source && (e instanceof NotFoundError || e instanceof PlanRestrictedError)) throw e;
      firstError ??= e;
      ctx.logger.warn('failover.source_failed', { competition: comp.config.id, source, error: errorMessage(e) });
    }
  }
  throw firstError;
}

const key = (source: Source, date: string) => `${source}|${date}`;

/**
 * Which provider's day list each competition takes its matches from, per UTC day,
 * for a response built from several day lists: its source when that loaded, else
 * the first backup that did.
 */
export class DayCoverage {
  private readonly loaded = new Set<string>();
  private readonly failures = new Map<string, unknown>();

  markLoaded(source: Source, date: string): void {
    this.loaded.add(key(source, date));
  }

  markFailed(source: Source, date: string, error: unknown): void {
    this.failures.set(key(source, date), error);
  }

  isLoaded(source: Source, date: string): boolean {
    return this.loaded.has(key(source, date));
  }

  failed(source: Source, date: string): boolean {
    return this.failures.has(key(source, date));
  }

  sourceFor(comp: ActiveCompetition, date: string): Source | null {
    if (this.isLoaded(comp.source, date)) return comp.source;
    return comp.backups.find((b) => this.isLoaded(b, date)) ?? null;
  }

  /** Backups worth loading for a day: those that can stand in for a competition whose source failed. */
  backupsNeeded(comps: readonly ActiveCompetition[], date: string): Source[] {
    const out: Source[] = [];
    for (const c of comps) {
      if (!this.failed(c.source, date) || this.sourceFor(c, date)) continue;
      const next = c.backups.find((b) => !this.isLoaded(b, date) && !this.failed(b, date));
      if (next && !out.includes(next)) out.push(next);
    }
    return out;
  }

  /** Drops a competition's matches that came from a provider it isn't using for that day. */
  keep(m: Match, comp: ActiveCompetition): boolean {
    return this.sourceFor(comp, m.utcDate.slice(0, 10)) === m.source;
  }

  /** Backup notices, and failures for competitions nothing could stand in for. */
  report(comps: readonly ActiveCompetition[], dates: readonly string[], meta: MetaCollector): void {
    for (const c of comps) {
      for (const d of dates) {
        const used = this.sourceFor(c, d);
        if (used && used !== c.source) meta.warn(backupNotice(c, used));
        const error = used ? null : this.failures.get(key(c.source, d));
        if (error) meta.fail(error, failureMessage(error));
      }
    }
  }
}

export function failureMessage(e: unknown): string {
  return isAppError(e) && e.code === 'UPSTREAM_RATE_LIMITED' ? 'Some matches are missing while the data provider cools down.' : 'Some matches could not be loaded.';
}

export interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

/** One JSON line per event so Vercel's log search can filter on fields. */
export const consoleLogger: Logger = {
  info: (msg, data) => console.info(JSON.stringify({ level: 'info', msg, ...data })),
  warn: (msg, data) => console.warn(JSON.stringify({ level: 'warn', msg, ...data })),
  error: (msg, data) => console.error(JSON.stringify({ level: 'error', msg, ...data })),
};

export const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Vercel deploys the first of these that imports hono. A src/app.ts once shadowed
// src/index.ts and would have shipped a function with no default export.
const CANDIDATES = /^(app|index|server)\.(js|cjs|mjs|ts|cts|mts)$/;
// The check Vercel's Hono builder runs on a candidate's source (@vercel/hono).
const IMPORTS_HONO = /(?:from|require|import)\s*(?:\(\s*)?["']hono["']\s*(?:\))?/;

describe('Vercel entrypoint', () => {
  it('is src/index.ts and nothing else', () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const found = [
      ...readdirSync(root).filter((f) => CANDIDATES.test(f)),
      ...readdirSync(`${root}src`).filter((f) => CANDIDATES.test(f)).map((f) => `src/${f}`),
    ];
    expect(found).toEqual(['src/index.ts']);
    expect(readFileSync(`${root}src/index.ts`, 'utf8')).toMatch(IMPORTS_HONO);
  });
});

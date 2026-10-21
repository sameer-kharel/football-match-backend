/**
 * Runs the API on plain Node without the Vercel CLI: `npm run dev:local`.
 * Reads .env.local / .env if present. Without Upstash variables it falls back to
 * an in-process memory store, which is fine for a single local process.
 */
import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';

for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const { createApp } = await import('../src/create-app.js');
const port = Number(process.env.PORT ?? 3000);

serve({ fetch: createApp().fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.info(`MatchBell API on http://localhost:${info.port}/api/v1/health (Android emulator: http://10.0.2.2:${info.port})`);
});

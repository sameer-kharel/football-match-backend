import type { Hono } from 'hono';
import { createApp } from './create-app.js';

// Vercel's zero-config Hono support deploys the default export of the first of
// app.*, index.*, server.*, src/app.*, src/index.*, src/server.* whose source
// imports "hono", so this file must import it (the type is enough) and none of
// the others may exist (see test/entrypoint.test.ts).
const app: Hono = createApp();

export default app;

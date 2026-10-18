import { createApp } from './app.js';

// Vercel's zero-config Hono support picks up this default export (src/index.ts).
const app = createApp();

export default app;

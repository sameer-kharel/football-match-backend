# Pitchside API

A Hono app for Vercel Functions: it normalizes football-data.org (and, optionally, API-Football) into one schema, behind Upstash Redis caching, shared rate budgets and CDN cache headers.

- **Deploy:** import the repo in Vercel with **Root Directory = `backend`**, connect **Upstash for Redis** from the Marketplace, and set `FOOTBALL_DATA_API_KEY`. Full steps are in the [root README](../README.md#3-backend-deploy-to-vercel).
- **Local:** `npm install && cp .env.example .env.local && npm run dev:local` (http://localhost:3000), or `vercel dev`.
- **Checks:** `npm run check` runs typecheck, lint and the vitest suite.
- **Design:** see [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).

```
src/
  index.ts              default export picked up by Vercel's zero-config Hono support
  app.ts                middleware: security headers, CORS, per-IP limit, error shape
  routes/v1.ts          /api/v1 endpoints (zod-validated)
  config/               competitions registry, featured teams, rivalries, TTLs
  domain/               normalized types, highlight ranking, time zones, stage labels
  providers/            FootballProvider + football-data.org + API-Football, budgeted HTTP client
  services/             availability, matches, pinned, highlights, teams, match detail, featured ids
  lib/                  Redis/memory store, SWR cache, upstream budget, IP limiter, errors, validation
test/                   vitest: normalization fixtures, cache/stale fallback, budgets, ranking, validation, HTTP
```

To add a competition, add one entry to `src/config/competitions.ts` with a football-data code and/or an API-Football `{ name, country }`. Availability is checked at runtime, so nothing else needs to change.
# football-match-backend

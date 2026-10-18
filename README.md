# Pitchside API

A Hono app for Vercel Functions. It normalizes football-data.org (and, optionally, API-Football) into one schema behind Upstash Redis caching, shared rate budgets and CDN cache headers. The Pitchside Flutter app is its only client.

## Deploy to Vercel

1. In Vercel, choose **Add New → Project** and import this repository.
   - **Root Directory**: leave it as the repository root when deploying this standalone repo. In the monorepo it's `backend`.
   - The framework is detected as **Hono**, because `src/index.ts` exports the app. There's no build command to set.
   - Set Node.js to 22.x or newer.
2. Add Redis: **Storage → Create Database → Upstash for Redis**, then connect it to the project for every environment.
   - This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`. If you created the database on upstash.com instead, set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` by hand. Either pair works.
   - Pick the same region as your functions: `iad1`, which is Upstash `us-east-1`.
3. **Settings → Environment Variables**:

   | Name | Value |
   |---|---|
   | `FOOTBALL_DATA_API_KEY` | token from https://www.football-data.org/client/register (**required**) |
   | `FOOTBALL_DATA_PLAN` | `free` (default) · `standard` · `advanced` · `pro` |
   | `CRON_SECRET` | long random string (optional, enables the daily cache warmer) |
   | `ENABLE_API_FOOTBALL` / `API_FOOTBALL_KEY` | `true` and your key, for friendlies, qualifiers, Nations League and Europa League (optional) |
   | `API_FOOTBALL_DAILY_BUDGET` | `90` (default; the free plan allows 100/day) |
   | `IP_RATE_LIMIT_PER_MINUTE` | `120` (default) |

4. Deploy, then check: `curl -s https://<project>.vercel.app/api/v1/health` should return `"status":"ok"` and `"redis":"ok"`.

Cron is optional. Vercel's Hobby plan allows one run a day, and everything is fetched on demand and cached anyway.

## Local development

```bash
npm install
cp .env.example .env.local      # fill in FOOTBALL_DATA_API_KEY; Redis is optional locally
npm run dev:local               # http://localhost:3000 (Android emulator: http://10.0.2.2:3000)
# or: npm i -g vercel && vercel link && vercel env pull .env.local && vercel dev
npm run check                   # typecheck + lint + tests
```

## Endpoints (`/api/v1`)

| Route | Notes |
|---|---|
| `GET /health` | Redis and provider status, budget snapshots. |
| `GET /competitions` | Competitions the configured providers can serve. |
| `GET /competitions/:id/matches?from&to&status` | Current season, filtered. |
| `GET /competitions/:id/standings` | Tables with zones. |
| `GET /competitions/:id/scorers?limit` | Top scorers. |
| `GET /matches?date&tz&competitions` | One local day. Dates must be within 400 days of today. |
| `GET /matches/pinned?teams&matches&competitions&tz` | Everything pinned, in one call. |
| `GET /matches/:id` | Details, head-to-head and league positions. |
| `GET /highlights?tz&days&limit` | Ranked big matches. |
| `GET /teams` · `GET /teams/:id` | Team index · team profile with fixtures. |

Every response is `{ data, meta: { stale, fetchedAt, sources, delayed, partial, warnings } }`, and every error is `{ error: { code, message, details? } }`.

## Layout

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

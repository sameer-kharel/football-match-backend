# Pitchside API

A Hono app for Vercel Functions. It normalizes football-data.org, OpenLigaDB and (optionally) API-Football into one schema. Upstash Redis caching, shared rate budgets and CDN cache headers sit in front. The Pitchside Flutter app is its only client.

## Data sources

| Source | Key | Role |
|---|---|---|
| [football-data.org](https://www.football-data.org) v4 | `FOOTBALL_DATA_API_KEY` (**required**) | Main source: World Cup, Champions League, Euros, the top five leagues, Eredivisie, Primeira Liga, Brasileirão, Championship. Free tier: 10 requests/min, scores delayed. |
| [OpenLigaDB](https://www.openligadb.de) | none (on unless `ENABLE_OPENLIGADB=false`) | Source for **2. Bundesliga** and the **DFB-Pokal**, and the **Bundesliga backup**. Free, community-maintained, live goals with scorers. Data under the [ODbL](https://www.openligadb.de); the app credits it in Settings. |
| [API-Football](https://www.api-football.com) | `ENABLE_API_FOOTBALL=true` + `API_FOOTBALL_KEY` | Optional. Source for Nations League, Europa League, friendlies and qualifiers, and a backup for everything it maps. The free plan is 100 requests/day. Check that it covers the current season before relying on it. |

**Failover.** Each competition has one source: the first of football-data, OpenLigaDB and API-Football that offers it. The others are its backups. When the source fails, the cache answers first (stale entries are kept for a week). A backup is used only when nothing is cached.

- Backup data carries its own ids (`ol-…`), so match and team pages keep working.
- The response lists the backup in `meta.sources` and adds a `meta.warnings` notice, e.g. "Bundesliga is coming from OpenLigaDB while football-data.org is unavailable."
- A not-found or plan answer from the source is final; it doesn't trigger a backup.

**Why these.** Other free options were tested and left out:

- **TheSportsDB's** free key truncates results: 3 matches per day query, 5 table rows, 15 season fixtures. Using it needs the $9/month key.
- **openfootball** is a static GitHub dataset updated about weekly.
- Unofficial endpoints from ESPN, FotMob and SofaScore break their terms of use.

## Deploy to Vercel

### One-time setup

1. In Vercel, choose **Add New → Project** and import this repository.
   - **Root Directory**: the repository root (in the monorepo, `backend`).
   - The framework is detected as **Hono**, because `src/index.ts` exports the app. There's no build command to set.
   - Node.js comes from `package.json` (`22.x`).
2. Add Redis: **Storage → Create Database → Upstash for Redis**, then connect it to the project for every environment.
   - This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`. If you created the database on upstash.com instead, set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` by hand. Either pair works.
   - Keep Redis and functions in one region: `iad1` with Upstash `us-east-1` (the default), or `fra1` with `eu-central-1`, which is closer to both data providers.
3. **Settings → Environment Variables**, for **Production and Preview**:

   | Name | Value |
   |---|---|
   | `FOOTBALL_DATA_API_KEY` | token from https://www.football-data.org/client/register (**required**) |
   | `FOOTBALL_DATA_PLAN` | `free` (default) · `standard` · `advanced` · `pro` |
   | `CRON_SECRET` | long random string (optional, enables the daily cache warmer) |
   | `ENABLE_OPENLIGADB` | `true` (default) · `false` turns the German leagues and the Bundesliga backup off |
   | `ENABLE_API_FOOTBALL` / `API_FOOTBALL_KEY` | `true` and your key (optional, see above) |
   | `API_FOOTBALL_DAILY_BUDGET` | `90` (default; the free plan allows 100/day) |
   | `IP_RATE_LIMIT_PER_MINUTE` | `120` (default) |
   | `PUBLISHER_NAME` / `CONTACT_EMAIL` | your name (or company) and a support address, shown in the privacy policy (**needed for the Play Store**) |
   | `APP_NAME` | `Pitchside` (default), the name used in the privacy policy |
   | `APP_ADS_TXT` | your AdMob line, `google.com, pub-…, DIRECT, f08c47fec0942fa0` (**needed for real ads**) |

### Play Store pages

The API also serves the two public pages a store listing needs, so there's no separate website to host:

- `https://<project>.vercel.app/privacy`: the privacy policy (use it as the Play Console privacy policy URL; the app links to it from Settings).
- `https://<project>.vercel.app/app-ads.txt`: AdMob's authorised-sellers file. Set the listing's website to `https://<project>.vercel.app` so AdMob finds it.

### Continuous deployment (GitHub Actions)

`.github/workflows/ci.yml` runs typecheck, lint and tests on every pull request and every push to `main`. When they pass, it deploys with the Vercel CLI:

- **Pull request:** a preview deployment, linked from the PR's checks.
- **Push to `main`:** production.
- **After every deploy:** `npm run smoke` checks `/api/v1/health` and `/api/v1/competitions`.

`vercel.json` turns off Vercel's own Git deployments (`git.deploymentEnabled: false`), so nothing deploys without passing CI and nothing deploys twice.

Set it up once:

1. Link the project and read its ids:
   ```bash
   npx vercel@62.2.0 link        # creates .vercel/project.json (git-ignored)
   cat .vercel/project.json      # {"orgId": "...", "projectId": "..."}
   ```
2. Create a token at https://vercel.com/account/tokens.
3. In GitHub, go to **Settings → Secrets and variables → Actions** and add:
   - **Secrets:** `VERCEL_TOKEN`, `VERCEL_ORG_ID` (the `orgId` value), `VERCEL_PROJECT_ID` (the `projectId` value).
   - **Variable:** `PRODUCTION_URL`, e.g. `https://your-project.vercel.app`. The production smoke test runs against this public domain.
   - **Optional secret:** `VERCEL_AUTOMATION_BYPASS_SECRET` (Vercel → Project → Settings → Deployment Protection → Protection Bypass for Automation). This lets the smoke test reach protected preview URLs.
4. Push to `main`. The **Actions** tab shows the run, and the deployment URL appears in its summary.

Dependabot (`.github/dependabot.yml`) opens weekly grouped update PRs, which go through the same checks.

### Check a deployment

```bash
npm run smoke -- https://<project>.vercel.app
curl -s https://<project>.vercel.app/api/v1/health   # "status":"ok", "redis":"ok"
```

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
  providers/            FootballProvider + football-data.org, OpenLigaDB, API-Football; budgeted HTTP client
  services/             availability, failover, matches, pinned, highlights, teams, match detail, featured ids
scripts/                local server, post-deploy smoke test
  lib/                  Redis/memory store, SWR cache, upstream budget, IP limiter, errors, validation
test/                   vitest: normalization fixtures, cache/stale fallback, failover, budgets, ranking, validation, HTTP
.github/                CI + Vercel deploys, Dependabot
```

To add a competition, add one entry to `src/config/competitions.ts`. Give it a football-data code, an OpenLigaDB shortcut and/or an API-Football `{ name, country }`. Availability is checked at runtime, and every extra mapping becomes a backup, so nothing else needs to change.

# football-match-backend

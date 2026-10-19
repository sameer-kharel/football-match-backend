/**
 * Post-deploy check, run by CI after every Vercel deployment:
 * `npm run smoke -- https://<deployment>`. Fails when the API doesn't answer,
 * has no football-data key, or serves no competitions.
 *
 * Preview deployments sit behind Vercel Deployment Protection: set
 * VERCEL_AUTOMATION_BYPASS_SECRET (Project → Settings → Deployment Protection →
 * Protection Bypass for Automation) and it is sent as a header.
 */
const base = (process.argv[2] ?? '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(base)) {
  console.error('Usage: npm run smoke -- https://your-deployment.vercel.app');
  process.exit(2);
}

const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const headers: Record<string, string> = bypass ? { 'x-vercel-protection-bypass': bypass } : {};

/** A fresh deployment can take a few seconds to answer; retry before failing. */
async function get(path: string): Promise<{ status: number; body: unknown }> {
  let last = '';
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(20_000) });
      const text = await res.text();
      if (res.status === 401 || res.status === 403) {
        throw new Error(`${path} answered ${res.status}: the deployment is protected. Set VERCEL_AUTOMATION_BYPASS_SECRET or smoke-test the production domain.`);
      }
      if (res.status < 500 || attempt === 5) return { status: res.status, body: JSON.parse(text) as unknown };
      last = `${res.status}: ${text.slice(0, 200)}`;
    } catch (e) {
      if (e instanceof Error && e.message.includes('protected')) throw e;
      last = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, attempt * 3_000));
  }
  throw new Error(`${path} never answered: ${last}`);
}

interface Health {
  status?: string;
  redis?: string;
  providers?: { footballData?: { configured?: boolean }; openLigaDb?: { configured?: boolean } };
}

async function main(): Promise<string[]> {
  const failures: string[] = [];

  const health = await get('/api/v1/health');
  const h = health.body as Health;
  if (health.status !== 200) failures.push(`/api/v1/health answered ${health.status}: ${JSON.stringify(h)}`);
  if (!h.providers?.footballData?.configured) failures.push('FOOTBALL_DATA_API_KEY is not set for this Vercel environment.');
  if (h.redis !== 'ok') console.warn(`::warning::Redis is "${h.redis ?? 'unknown'}": connect Upstash so caches and rate limits are shared across instances.`);
  if (!h.providers?.openLigaDb?.configured) console.warn('::warning::OpenLigaDB is off: the Bundesliga has no backup.');

  const comps = await get('/api/v1/competitions');
  const list = (comps.body as { data?: unknown[] }).data;
  if (comps.status !== 200 || !Array.isArray(list) || list.length === 0) {
    failures.push(`/api/v1/competitions answered ${comps.status} with ${Array.isArray(list) ? list.length : 'no'} competitions.`);
  }
  if (failures.length === 0) console.info(`Smoke test passed: ${base} (redis ${h.redis}, ${list?.length} competitions).`);
  return failures;
}

const failures = await main().catch((e: unknown) => [e instanceof Error ? e.message : String(e)]);
for (const f of failures) console.error(`::error::${f}`);
process.exit(failures.length > 0 ? 1 : 0);

import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

/** Like `bool`, but on unless set to "false" or "0". */
const boolDefaultOn = z
  .string()
  .optional()
  .transform((v) => !(v === 'false' || v === '0'));

const positiveInt = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
    });

const EnvSchema = z.object({
  FOOTBALL_DATA_API_KEY: z.string().optional().default(''),
  FOOTBALL_DATA_PLAN: z.enum(['free', 'standard', 'advanced', 'pro']).catch('free').default('free'),
  FOOTBALL_DATA_RPM: z.string().optional(),
  ENABLE_API_FOOTBALL: bool,
  API_FOOTBALL_KEY: z.string().optional().default(''),
  API_FOOTBALL_DAILY_BUDGET: positiveInt(90),
  API_FOOTBALL_RPM: positiveInt(8),
  ENABLE_OPENLIGADB: boolDefaultOn,
  OPENLIGADB_RPM: positiveInt(30),
  IP_RATE_LIMIT_PER_MINUTE: positiveInt(120),
  CRON_SECRET: z.string().optional().default(''),
  APP_NAME: z.string().optional().default('Pitchside'),
  PUBLISHER_NAME: z.string().optional().default(''),
  CONTACT_EMAIL: z.string().optional().default(''),
  APP_ADS_TXT: z.string().optional().default(''),
  VERCEL_ENV: z.string().optional(),
});

export interface Env {
  footballDataKey: string;
  footballDataPlan: 'free' | 'standard' | 'advanced' | 'pro';
  footballDataRpm: number;
  apiFootballEnabled: boolean;
  apiFootballKey: string;
  apiFootballDailyBudget: number;
  apiFootballRpm: number;
  /** OpenLigaDB: keyless German league data, on unless ENABLE_OPENLIGADB=false. */
  openLigaDbEnabled: boolean;
  openLigaDbRpm: number;
  ipLimitPerMinute: number;
  cronSecret: string;
  /** Shown in the privacy policy at /privacy. */
  appName: string;
  publisherName: string;
  contactEmail: string;
  /** Served at /app-ads.txt for AdMob; "\n" separates lines. */
  appAdsTxt: string;
  isProduction: boolean;
}

/** Plan limits are 10 / 30 / 60 rpm; keep two requests of headroom for clock skew between instances. */
const FD_DEFAULT_RPM = { free: 8, standard: 28, advanced: 55, pro: 55 } as const;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const e = EnvSchema.parse(source);
  const rpmOverride = Number(e.FOOTBALL_DATA_RPM);
  return {
    footballDataKey: e.FOOTBALL_DATA_API_KEY.trim(),
    footballDataPlan: e.FOOTBALL_DATA_PLAN,
    footballDataRpm: Number.isFinite(rpmOverride) && rpmOverride > 0 ? Math.floor(rpmOverride) : FD_DEFAULT_RPM[e.FOOTBALL_DATA_PLAN],
    apiFootballEnabled: e.ENABLE_API_FOOTBALL,
    apiFootballKey: e.API_FOOTBALL_KEY.trim(),
    apiFootballDailyBudget: e.API_FOOTBALL_DAILY_BUDGET,
    apiFootballRpm: e.API_FOOTBALL_RPM,
    openLigaDbEnabled: e.ENABLE_OPENLIGADB,
    openLigaDbRpm: e.OPENLIGADB_RPM,
    ipLimitPerMinute: e.IP_RATE_LIMIT_PER_MINUTE,
    cronSecret: e.CRON_SECRET,
    appName: e.APP_NAME.trim() || 'Pitchside',
    publisherName: e.PUBLISHER_NAME.trim(),
    contactEmail: e.CONTACT_EMAIL.trim(),
    appAdsTxt: e.APP_ADS_TXT.trim(),
    isProduction: e.VERCEL_ENV === 'production',
  };
}

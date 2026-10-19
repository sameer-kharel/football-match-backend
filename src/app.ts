import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { AppError, isAppError } from './lib/errors.js';
import { sendError } from './lib/http.js';
import { checkIpLimit, clientIp } from './lib/ip-limit.js';
import { errorMessage } from './lib/logger.js';
import { v1Routes } from './routes/v1.js';
import type { AppContext } from './services/context.js';
import { createContext } from './services/context.js';

/**
 * Builds the Hono app. The context (env, Redis, providers) is created lazily on
 * the first request and reused for the life of the function instance; it holds
 * no request data, only clients.
 */
export function createApp(contextFactory: () => AppContext = createContext) {
  let ctx: AppContext | undefined;
  const getCtx = () => (ctx ??= contextFactory());

  const app = new Hono();

  app.use('*', secureHeaders({ crossOriginResourcePolicy: 'cross-origin' }));
  app.use(
    '/api/*',
    cors({ origin: '*', allowMethods: ['GET', 'OPTIONS'], allowHeaders: ['Content-Type'], exposeHeaders: ['Retry-After'], maxAge: 86_400 }),
  );

  app.use('/api/v1/*', async (c, next) => {
    if (c.req.method === 'OPTIONS' || c.req.path.endsWith('/health') || c.req.path.includes('/cron/')) {
      await next();
      return;
    }
    const context = getCtx();
    const decision = await checkIpLimit(context.store, clientIp(c.req.raw.headers), context.env.ipLimitPerMinute, context.now());
    c.header('X-RateLimit-Limit', String(decision.limit));
    c.header('X-RateLimit-Remaining', String(decision.remaining));
    if (!decision.allowed) {
      throw new AppError('RATE_LIMITED', 429, 'Too many requests. Slow down a little.', undefined, decision.resetSeconds);
    }
    await next();
  });

  app.route('/api/v1', v1Routes(getCtx));

  app.get('/', (c) =>
    c.json({ name: 'Pitchside API', version: 'v1', health: '/api/v1/health', attribution: 'Football data provided by football-data.org. German league data from OpenLigaDB (openligadb.de), ODbL 1.0.' }),
  );

  app.notFound((c) => sendError(c, new AppError('NOT_FOUND', 404, `No route for ${c.req.method} ${c.req.path}.`)));

  app.onError((err, c) => {
    if (isAppError(err)) return sendError(c, err);
    (ctx?.logger ?? console).error('unhandled', { path: c.req.path, error: errorMessage(err) });
    return sendError(c, new AppError('INTERNAL', 500, 'Something went wrong on our side.'));
  });

  return app;
}

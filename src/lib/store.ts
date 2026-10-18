import { Redis } from '@upstash/redis';

/**
 * Minimal key-value surface the API needs. Production uses Upstash Redis so that
 * caches and counters are shared by every serverless instance. The memory store
 * exists for tests and for `npm run dev:local` without Redis; it is per-process.
 */
export interface KeyValueStore {
  readonly kind: 'redis' | 'memory';
  getJson<T>(key: string): Promise<T | null>;
  setJson(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  /** SET key value NX EX ttl. Returns true when the key was set. */
  setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  del(key: string): Promise<void>;
  /** INCR + EXPIRE in one round trip. Returns the new value. */
  incrWithExpiry(key: string, ttlSeconds: number): Promise<number>;
  ping(): Promise<boolean>;
}

export class RedisStore implements KeyValueStore {
  readonly kind = 'redis' as const;
  constructor(private readonly redis: Redis) {}

  async getJson<T>(key: string): Promise<T | null> {
    return (await this.redis.get<T>(key)) ?? null;
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, value, { ex: Math.max(1, Math.round(ttlSeconds)) });
  }

  async setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const res = await this.redis.set(key, value, { nx: true, ex: Math.max(1, Math.round(ttlSeconds)) });
    return res === 'OK';
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async incrWithExpiry(key: string, ttlSeconds: number): Promise<number> {
    const [count] = await this.redis.multi().incr(key).expire(key, Math.max(1, Math.round(ttlSeconds))).exec<[number, number]>();
    return count;
  }

  async ping(): Promise<boolean> {
    return (await this.redis.ping()) === 'PONG';
  }
}

export class MemoryStore implements KeyValueStore {
  readonly kind = 'memory' as const;
  private readonly data = new Map<string, { value: unknown; expiresAt: number }>();
  constructor(private readonly now: () => number = Date.now) {}

  private read(key: string): unknown {
    const hit = this.data.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.now()) {
      this.data.delete(key);
      return undefined;
    }
    return hit.value;
  }

  getJson<T>(key: string): Promise<T | null> {
    const v = this.read(key);
    // Round-trip through JSON so callers never share references with the store.
    return Promise.resolve(v === undefined ? null : (JSON.parse(JSON.stringify(v)) as T));
  }

  setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    this.data.set(key, { value: JSON.parse(JSON.stringify(value)) as unknown, expiresAt: this.now() + ttlSeconds * 1000 });
    return Promise.resolve();
  }

  setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (this.read(key) !== undefined) return Promise.resolve(false);
    this.data.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 });
    return Promise.resolve(true);
  }

  del(key: string): Promise<void> {
    this.data.delete(key);
    return Promise.resolve();
  }

  incrWithExpiry(key: string, ttlSeconds: number): Promise<number> {
    const current = this.read(key);
    const next = (typeof current === 'number' ? current : 0) + 1;
    this.data.set(key, { value: next, expiresAt: this.now() + ttlSeconds * 1000 });
    return Promise.resolve(next);
  }

  ping(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

/** Accepts both the Vercel Marketplace names (KV_REST_API_*) and Upstash's own (UPSTASH_REDIS_REST_*). */
export function redisCredentials(env: NodeJS.ProcessEnv): { url: string; token: string } | null {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

export function createStore(env: NodeJS.ProcessEnv): KeyValueStore {
  const creds = redisCredentials(env);
  if (!creds) return new MemoryStore();
  return new RedisStore(new Redis({ url: creds.url, token: creds.token, automaticDeserialization: true }));
}

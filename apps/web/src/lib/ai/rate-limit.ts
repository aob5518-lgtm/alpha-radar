import { createClient, type RedisClientType } from "redis";
import { createHash, randomUUID } from "node:crypto";

export type LimitReason = "client_rate" | "global_rate" | "global_concurrency";

export interface LimitLease {
  acquired: boolean;
  token: string;
  reason?: LimitReason;
}

export interface AnalystLimitStore {
  acquire(input: {
    clientId: string;
    token: string;
    clientLimit: number;
    globalLimit: number;
    concurrencyLimit: number;
    windowMs: number;
    leaseMs: number;
  }): Promise<LimitReason | null>;
  release(token: string): Promise<void>;
}

export class AnalystLimiter {
  private readonly store: AnalystLimitStore;
  readonly limits: ReturnType<typeof analystLimits>;

  constructor(store: AnalystLimitStore, limits = analystLimits()) {
    this.store = store;
    this.limits = limits;
  }

  async acquire(clientId: string): Promise<LimitLease> {
    const token = randomUUID();
    const reason = await this.store.acquire({
      clientId,
      token,
      ...this.limits,
    });
    return reason
      ? { acquired: false, token, reason }
      : { acquired: true, token };
  }

  async release(lease: LimitLease): Promise<void> {
    if (lease.acquired) await this.store.release(lease.token);
  }
}

const acquireScript = `
local t = redis.call('TIME')
local now = tonumber(t[1])*1000 + tonumber(t[2])/1000
redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', now)
if tonumber(redis.call('GET', KEYS[1]) or '0') >= tonumber(ARGV[2]) then return 1 end
if tonumber(redis.call('GET', KEYS[2]) or '0') >= tonumber(ARGV[3]) then return 2 end
if redis.call('ZCARD', KEYS[3]) >= tonumber(ARGV[4]) then return 3 end
redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], ARGV[5])
redis.call('INCR', KEYS[2])
redis.call('PEXPIRE', KEYS[2], ARGV[5])
redis.call('ZADD', KEYS[3], now + tonumber(ARGV[6]), ARGV[1])
redis.call('PEXPIRE', KEYS[3], ARGV[6])
return 0
`;

class RedisAnalystLimitStore implements AnalystLimitStore {
  private readonly client: RedisClientType;

  constructor(client: RedisClientType) {
    this.client = client;
  }

  async acquire(input: {
    clientId: string;
    token: string;
    clientLimit: number;
    globalLimit: number;
    concurrencyLimit: number;
    windowMs: number;
    leaseMs: number;
  }): Promise<LimitReason | null> {
    const result = Number(
      await this.client.eval(acquireScript, {
        keys: [
          `alpha-radar:analyst:rate:client:${input.clientId}`,
          "alpha-radar:analyst:rate:global",
          "alpha-radar:analyst:concurrency",
        ],
        arguments: [
          input.token,
          String(input.clientLimit),
          String(input.globalLimit),
          String(input.concurrencyLimit),
          String(input.windowMs),
          String(input.leaseMs),
        ],
      }),
    );
    return result === 1
      ? "client_rate"
      : result === 2
        ? "global_rate"
        : result === 3
          ? "global_concurrency"
          : null;
  }

  async release(token: string): Promise<void> {
    await this.client.zRem("alpha-radar:analyst:concurrency", token);
  }
}

let limiterPromise: Promise<AnalystLimiter> | undefined;

export function getAnalystLimiter(): Promise<AnalystLimiter> {
  limiterPromise ??= connectLimiter().catch((error: unknown) => {
    limiterPromise = undefined;
    throw error;
  });
  return limiterPromise;
}

async function connectLimiter(): Promise<AnalystLimiter> {
  const client = createClient({
    url: process.env.REDIS_URL ?? "redis://localhost:6379/0",
  });
  await client.connect();
  return new AnalystLimiter(new RedisAnalystLimitStore(client));
}

export function analystLimits() {
  return {
    clientLimit: positiveInt(process.env.AI_RATE_LIMIT_PER_CLIENT, 10),
    globalLimit: positiveInt(process.env.AI_RATE_LIMIT_GLOBAL, 60),
    concurrencyLimit: positiveInt(process.env.AI_CONCURRENCY_LIMIT_GLOBAL, 3),
    windowMs: 60_000,
    leaseMs: positiveInt(process.env.AI_CONCURRENCY_LEASE_SECONDS, 120) * 1000,
  };
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function analystClientId(request: Request): string {
  const address =
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  return createHash("sha256").update(address).digest("hex");
}

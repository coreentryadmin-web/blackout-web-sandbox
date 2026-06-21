import { dbConfigured, getMeta, setMeta } from "@/lib/db";

const MIN_INTERVAL_MS = Number(process.env.SPX_COMMENTARY_MIN_INTERVAL_MS ?? 55_000);
const DAILY_CAP = Number(process.env.SPX_COMMENTARY_DAILY_CAP ?? 80);

// BUG-03: The interval TTL must be at least MIN_INTERVAL_MS rounded up to the
// nearest second, so Redis enforces the per-instance call spacing across all
// server instances rather than only within a single process.
const INTERVAL_TTL_SEC = Math.ceil(MIN_INTERVAL_MS / 1000);

type BudgetRow = { date: string; count: number };

function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

// Fallback in-process map used only when Redis is unavailable.
const lastCallByUserFallback = new Map<string, number>();

function budgetKey(userId: string): string {
  return `spx_commentary_budget:${userId}:${todayEt()}`;
}

/** Redis key for the per-user interval throttle. */
function intervalKey(userId: string): string {
  return `spx_commentary_interval:${userId}`;
}

/** Returns a connected ioredis client, or null if REDIS_URL is not set. */
async function getRedis(): Promise<import("ioredis").default | null> {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  try {
    const mod = await import("ioredis");
    const Redis = mod.default;
    // Re-use a module-level singleton to avoid opening a new connection on
    // every request.
    if (!_redisClient) {
      _redisClient = new Redis(url, {
        maxRetriesPerRequest: 1,
        lazyConnect: true,
        connectTimeout: 2_000,
      });
      await _redisClient.connect();
    }
    return _redisClient;
  } catch {
    return null;
  }
}
let _redisClient: import("ioredis").default | null = null;

async function readBudget(userId: string): Promise<BudgetRow> {
  const today = todayEt();
  const key = budgetKey(userId);
  if (dbConfigured()) {
    const raw = await getMeta(key);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as BudgetRow;
        if (parsed.date === today) return { date: today, count: parsed.count ?? 0 };
      } catch {
        /* fresh */
      }
    }
  }
  return { date: today, count: 0 };
}

async function incrementBudget(userId: string): Promise<BudgetRow> {
  const current = await readBudget(userId);
  const next = { date: current.date, count: current.count + 1 };
  if (dbConfigured()) {
    await setMeta(budgetKey(userId), JSON.stringify(next));
  }
  return next;
}

export type CommentaryLimitResult =
  | { ok: true }
  | { ok: false; status: 429 | 503; error: string; retry_after_sec?: number };

/** Per-user throttle + daily Anthropic call cap for commentary.
 *
 * BUG-03 fix: the per-user interval throttle is now enforced via a Redis key
 * with a short TTL so the limit applies across all server instances, not just
 * within a single process's memory Map. Falls back to the in-process Map when
 * Redis is unavailable so behaviour is unchanged in development.
 */
export async function checkCommentaryLimits(userId: string): Promise<CommentaryLimitResult> {
  const redis = await getRedis();

  if (redis) {
    // Redis path: key is set with NX (only if not existing) and a TTL equal to
    // MIN_INTERVAL_MS. If the key already exists the user is still within the
    // cooldown window.
    try {
      const key = intervalKey(userId);
      const existing = await redis.get(key);
      if (existing !== null) {
        const ttlSec = await redis.ttl(key);
        return {
          ok: false,
          status: 429,
          error: "Commentary rate limit — wait before next request",
          retry_after_sec: ttlSec > 0 ? ttlSec : 1,
        };
      }
    } catch (err) {
      // Redis error: fall through to in-process fallback below.
      console.warn("[spx-commentary-limits] Redis interval check failed, falling back:", err);
    }
  } else {
    // In-process fallback (single-instance only).
    const now = Date.now();
    const last = lastCallByUserFallback.get(userId) ?? 0;
    const elapsed = now - last;
    if (elapsed < MIN_INTERVAL_MS) {
      return {
        ok: false,
        status: 429,
        error: "Commentary rate limit — wait before next request",
        retry_after_sec: Math.ceil((MIN_INTERVAL_MS - elapsed) / 1000),
      };
    }
  }

  const budget = await readBudget(userId);
  if (budget.count >= DAILY_CAP) {
    return {
      ok: false,
      status: 429,
      error: `Daily commentary cap reached (${DAILY_CAP}/day)`,
    };
  }

  return { ok: true };
}

export async function recordCommentaryCall(userId: string): Promise<void> {
  const redis = await getRedis();
  if (redis) {
    try {
      // SET NX EX — only set if key absent; TTL enforces the cooldown window.
      await redis.set(intervalKey(userId), "1", "EX", INTERVAL_TTL_SEC, "NX");
    } catch (err) {
      console.warn("[spx-commentary-limits] Redis interval record failed, using fallback:", err);
      lastCallByUserFallback.set(userId, Date.now());
    }
  } else {
    lastCallByUserFallback.set(userId, Date.now());
  }
  await incrementBudget(userId);
}

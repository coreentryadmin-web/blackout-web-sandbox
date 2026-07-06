import { before, test, mock } from "node:test";
import assert from "node:assert/strict";
import type { checkIpRateLimit as CheckIpRateLimit } from "./ip-rate-limit";

// Task #177 (security audit): a probe sent 30 rapid POSTs to /api/telemetry/client-error
// (20/min limit) and got zero 429s. Root cause: checkIpRateLimit()'s two "Redis is
// unavailable" branches (`getRedis()` -> null, and the `client.eval(...)` catch) returned
// an unconditional `{ ok: true, ... }` — during any Redis outage, EVERY caller of this
// shared helper had rate limiting fully off, not degraded. The fix adds an in-memory,
// per-process fallback counter that activates ONLY on those two branches, enforcing the
// same limit/windowSecs the caller passed. These tests cover that fallback plus a
// regression guard proving the Redis-available happy path is byte-for-byte unaffected.
//
// mock.module() resolves bare specifiers relative to THIS file (see
// src/app/api/cron/spx-issues-sync/route.test.ts for the same pattern) — "./make-redis"
// here matches ip-rate-limit.ts's own `await import("./make-redis")` exactly, since both
// files live in src/lib/.
//
// `evalImpl`/`makeRedisCalls` are mutable so later tests can reconfigure the SAME fake
// client's behavior — this matters because ip-rate-limit.ts caches a successfully-connected
// client in its module-level `_redis` var, so once one test connects successfully, later
// tests in this file reuse that identical client object rather than calling makeRedis again
// (this is itself part of what's being regression-tested).
let evalImpl: (...args: unknown[]) => Promise<unknown> = async () => {
  throw new Error("evalImpl not configured for this test");
};
let makeRedisCalls = 0;
const fakeClient = {
  eval: (...args: unknown[]) => evalImpl(...args),
  quit: async () => {},
};

mock.module("./make-redis", {
  namedExports: {
    makeRedis: async () => {
      makeRedisCalls++;
      return fakeClient;
    },
  },
});

// Dynamic import (not top-level await, which esbuild/tsx's CJS transform rejects) so
// mock.module() above is guaranteed registered before ip-rate-limit.ts's own lazy
// `await import("./make-redis")` (inside getRedis()) ever runs — see
// src/app/api/cron/spx-issues-sync/route.test.ts for the same before()-hook pattern.
let checkIpRateLimit: typeof CheckIpRateLimit;
before(async () => {
  ({ checkIpRateLimit } = await import("./ip-rate-limit"));
});

// Ordering note: this must run BEFORE any test that induces a Redis failure. Module-level
// `_redisFailedAt` (the 30s retry backoff) and `_redis` (the cached client) persist across
// tests in this file since it's the same imported module instance — a prior failure would
// arm the backoff and make getRedis() short-circuit to null here, defeating the point of
// this specific regression guard (proving the Redis-available path is untouched).
test("Redis available: happy path is byte-for-byte unaffected by the fallback change (regression guard)", async () => {
  const prevUrl = process.env.REDIS_URL;
  process.env.REDIS_URL = "redis://fake-host:6379";
  try {
    let calls = 0;
    evalImpl = async () => {
      calls++;
      return [calls, 45_000]; // [count, ttlMs]
    };

    const r1 = await checkIpRateLimit("203.0.113.1", "test:redis-happy-path", 2, 60);
    assert.deepEqual({ ok: r1.ok, remaining: r1.remaining, limit: r1.limit }, { ok: true, remaining: 1, limit: 2 });
    assert.ok(Math.abs(r1.resetAt - (Date.now() + 45_000)) < 2_000, "resetAt derived from Redis PTTL");

    const r2 = await checkIpRateLimit("203.0.113.1", "test:redis-happy-path", 2, 60);
    assert.deepEqual({ ok: r2.ok, remaining: r2.remaining }, { ok: true, remaining: 0 });

    // 3rd request exceeds limit=2 -> ok:false, straight from Redis's own count, same as before this fix.
    const r3 = await checkIpRateLimit("203.0.113.1", "test:redis-happy-path", 2, 60);
    assert.deepEqual({ ok: r3.ok, remaining: r3.remaining }, { ok: false, remaining: 0 });

    // Client is cached after the first successful connect (unchanged behavior) — only one
    // makeRedis() call for all 3 requests.
    assert.equal(makeRedisCalls, 1);
  } finally {
    if (prevUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevUrl;
  }
});

test("Redis eval() throws mid-request: falls through to the in-memory fallback enforcing the same limit", async () => {
  const prevUrl = process.env.REDIS_URL;
  process.env.REDIS_URL = "redis://fake-host:6379";
  try {
    evalImpl = async () => {
      throw new Error("ECONNRESET (simulated)");
    };

    // limit=2: 1st and 2nd requests pass via the fallback counter, 3rd is rejected.
    // (Only the 1st call actually re-enters the try/eval-throws path; per the real
    // REDIS_RETRY_MS backoff this arms, calls 2 and 3 short-circuit to the `if (!client)`
    // branch instead — both branches route through the identical fallback, and this
    // mirrors real production behavior after one Redis failure.)
    const r1 = await checkIpRateLimit("203.0.113.2", "test:redis-throws-fallback", 2, 60);
    assert.deepEqual({ ok: r1.ok, remaining: r1.remaining, limit: r1.limit }, { ok: true, remaining: 1, limit: 2 });

    const r2 = await checkIpRateLimit("203.0.113.2", "test:redis-throws-fallback", 2, 60);
    assert.deepEqual({ ok: r2.ok, remaining: r2.remaining }, { ok: true, remaining: 0 });

    const r3 = await checkIpRateLimit("203.0.113.2", "test:redis-throws-fallback", 2, 60);
    assert.deepEqual({ ok: r3.ok, remaining: r3.remaining }, { ok: false, remaining: 0 });
  } finally {
    if (prevUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevUrl;
  }
});

test("Redis unavailable (no REDIS_URL): N requests under the limit pass, the (N+1)th is rejected by the in-memory fallback", async (t) => {
  const prevUrl = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  try {
    // Fixed clock so every call in this test lands in the same fixed-window bucket.
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-07-05T14:00:00.000Z") });

    const limit = 3;
    for (let i = 1; i <= limit; i++) {
      const r = await checkIpRateLimit("203.0.113.3", "test:fallback-basic", limit, 60);
      assert.equal(r.ok, true, `request ${i} of ${limit} should pass`);
      assert.equal(r.remaining, limit - i);
      assert.equal(r.limit, limit);
    }

    const over = await checkIpRateLimit("203.0.113.3", "test:fallback-basic", limit, 60);
    assert.equal(over.ok, false, "the (limit+1)th request must be rejected");
    assert.equal(over.remaining, 0);
  } finally {
    if (prevUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevUrl;
  }
});

test("Redis unavailable: a fresh window resets the in-memory fallback count", async (t) => {
  const prevUrl = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  try {
    const windowSecs = 60;
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-07-05T14:05:00.000Z") });

    const limit = 2;
    const first = await checkIpRateLimit("203.0.113.4", "test:fallback-window-reset", limit, windowSecs);
    assert.equal(first.ok, true);
    const second = await checkIpRateLimit("203.0.113.4", "test:fallback-window-reset", limit, windowSecs);
    assert.equal(second.ok, true);
    const third = await checkIpRateLimit("203.0.113.4", "test:fallback-window-reset", limit, windowSecs);
    assert.equal(third.ok, false, "limit is exhausted within the first window");

    // Advance exactly one full window. Since `bucket = floor(now / windowMs)` and we're
    // advancing `now` by exactly windowMs, the bucket (and thus the fallback's key) always
    // rolls over by exactly 1 regardless of alignment within the original window.
    t.mock.timers.tick(windowSecs * 1000);

    const afterReset = await checkIpRateLimit("203.0.113.4", "test:fallback-window-reset", limit, windowSecs);
    assert.equal(afterReset.ok, true, "new window must start a fresh count");
    assert.equal(afterReset.remaining, limit - 1);
  } finally {
    if (prevUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevUrl;
  }
});

test("Redis unavailable: in-memory fallback map does not grow unbounded across many distinct IPs/keys (memory safety)", { timeout: 20_000 }, async (t) => {
  const prevUrl = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  try {
    // Fixed clock: nothing in this test expires on its own, so the only way the map can
    // stay bounded is the size-cap eviction in checkInMemoryFallback (FALLBACK_MAX_ENTRIES
    // = 5_000) actually firing. We don't have (and shouldn't add) a way to read the map's
    // size directly from a test, so we prove eviction happened indirectly: plant a
    // "sentinel" key, exhaust it (ok:false), flood the map with far more than
    // FALLBACK_MAX_ENTRIES distinct keys, then re-check the sentinel. If the map had grown
    // unbounded, the sentinel's count would keep climbing (still ok:false). If the map was
    // ever fully cleared by the cap (our documented "simplicity over LRU" strategy), the
    // sentinel reads as a brand-new key again (ok:true) — which is what a bounded map must
    // produce here.
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-07-05T14:10:00.000Z") });

    const sentinelIp = "198.51.100.9";
    const sentinelKey = "test:mem-sentinel";
    const s1 = await checkIpRateLimit(sentinelIp, sentinelKey, 1, 60);
    assert.equal(s1.ok, true);
    const s2 = await checkIpRateLimit(sentinelIp, sentinelKey, 1, 60);
    assert.equal(s2.ok, false, "sentinel is exhausted before flooding");

    // Flood well past FALLBACK_MAX_ENTRIES (5_000) with distinct ip+key pairs so the map's
    // size-cap eviction must trigger at least once.
    const FLOOD_COUNT = 5_200;
    for (let i = 0; i < FLOOD_COUNT; i++) {
      await checkIpRateLimit(`198.51.100.${100 + (i % 50)}.${i}`, `test:mem-flood:${i}`, 100, 60);
    }

    const sentinelAfterFlood = await checkIpRateLimit(sentinelIp, sentinelKey, 1, 60);
    assert.equal(
      sentinelAfterFlood.ok,
      true,
      "sentinel must read as a fresh key after the flood, proving the map was bounded (evicted), not left to grow unbounded",
    );
  } finally {
    if (prevUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevUrl;
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LARGO_INFLIGHT_KEY,
  LARGO_INFLIGHT_ACQUIRE_LUA,
  largoGlobalMaxConcurrent,
  largoInflightTtlMs,
  inflightStaleCutoff,
  DEFAULT_LARGO_GLOBAL_MAX_CONCURRENT,
  DEFAULT_LARGO_INFLIGHT_TTL_MS,
} from "./largo-global-gate";

// Pure unit tests for the cross-replica Largo concurrency ceiling. Alias-free, runnable via
// `tsx --test` — no Redis, no Next boot. The Lua itself can't run without Redis, so we (a) assert
// its shape and (b) model the same algorithm in JS to prove the prune→count→reserve logic.

// ---- env parsing ----
test("global cap: unset falls back to default (40)", () => {
  assert.equal(largoGlobalMaxConcurrent({} as NodeJS.ProcessEnv), DEFAULT_LARGO_GLOBAL_MAX_CONCURRENT);
  assert.equal(largoGlobalMaxConcurrent({} as NodeJS.ProcessEnv), 40);
});

test("global cap: valid parsed; zero/negative/non-numeric fall back; fractional floored", () => {
  assert.equal(largoGlobalMaxConcurrent({ LARGO_GLOBAL_MAX_CONCURRENT: "100" } as NodeJS.ProcessEnv), 100);
  assert.equal(largoGlobalMaxConcurrent({ LARGO_GLOBAL_MAX_CONCURRENT: "0" } as NodeJS.ProcessEnv), 40);
  assert.equal(largoGlobalMaxConcurrent({ LARGO_GLOBAL_MAX_CONCURRENT: "-9" } as NodeJS.ProcessEnv), 40);
  assert.equal(largoGlobalMaxConcurrent({ LARGO_GLOBAL_MAX_CONCURRENT: "nope" } as NodeJS.ProcessEnv), 40);
  assert.equal(largoGlobalMaxConcurrent({ LARGO_GLOBAL_MAX_CONCURRENT: "12.7" } as NodeJS.ProcessEnv), 12);
});

test("inflight TTL: unset falls back to default (150000ms > the 120s maxDuration)", () => {
  assert.equal(largoInflightTtlMs({} as NodeJS.ProcessEnv), DEFAULT_LARGO_INFLIGHT_TTL_MS);
  assert.ok(DEFAULT_LARGO_INFLIGHT_TTL_MS > 120_000, "TTL must exceed maxDuration so live queries aren't pruned");
  assert.equal(largoInflightTtlMs({ LARGO_INFLIGHT_TTL_MS: "0" } as NodeJS.ProcessEnv), DEFAULT_LARGO_INFLIGHT_TTL_MS);
  assert.equal(largoInflightTtlMs({ LARGO_INFLIGHT_TTL_MS: "200000" } as NodeJS.ProcessEnv), 200_000);
});

test("inflightStaleCutoff = now − ttl", () => {
  assert.equal(inflightStaleCutoff(1_000_000, 150_000), 850_000);
});

// ---- Lua shape ----
test("acquire Lua prunes leaked entries, caps, reserves, refreshes TTL", () => {
  const lua = LARGO_INFLIGHT_ACQUIRE_LUA;
  assert.match(lua, /ZREMRANGEBYSCORE/); // prune leaked
  assert.match(lua, /ZCARD/); // count live
  assert.match(lua, /ZADD/); // reserve
  assert.match(lua, /PEXPIRE/); // self-removing key
  assert.match(lua, /return 0/); // at-cap path
  assert.match(lua, /return 1/); // acquired path
  // the cap comparison must precede the reservation, else it could over-admit
  assert.ok(lua.indexOf("ZCARD") < lua.indexOf("ZADD"));
  assert.equal(LARGO_INFLIGHT_KEY, "blackout:largo:inflight");
});

// ---- algorithm model: same logic the Lua runs, in JS ----
// Redis ZREMRANGEBYSCORE '-inf' cutoff is INCLUSIVE, so entries scored <= cutoff are pruned.
function simulateAcquire(
  zset: Map<string, number>,
  opts: { now: number; ttlMs: number; cap: number; reqId: string }
): 0 | 1 {
  const cutoff = inflightStaleCutoff(opts.now, opts.ttlMs);
  for (const [member, score] of [...zset]) if (score <= cutoff) zset.delete(member);
  if (zset.size >= opts.cap) return 0;
  zset.set(opts.reqId, opts.now);
  return 1;
}

test("admits up to the cap across replicas, then rejects", () => {
  const z = new Map<string, number>();
  const base = { now: 1_000_000, ttlMs: 150_000, cap: 3 };
  assert.equal(simulateAcquire(z, { ...base, reqId: "a" }), 1);
  assert.equal(simulateAcquire(z, { ...base, reqId: "b" }), 1);
  assert.equal(simulateAcquire(z, { ...base, reqId: "c" }), 1);
  assert.equal(z.size, 3);
  assert.equal(simulateAcquire(z, { ...base, reqId: "d" }), 0); // at cap
  assert.equal(z.size, 3);
});

test("a released (ZREM'd) slot frees capacity", () => {
  const z = new Map<string, number>();
  const base = { now: 1_000_000, ttlMs: 150_000, cap: 1 };
  assert.equal(simulateAcquire(z, { ...base, reqId: "a" }), 1);
  assert.equal(simulateAcquire(z, { ...base, reqId: "b" }), 0); // full
  z.delete("a"); // release
  assert.equal(simulateAcquire(z, { ...base, reqId: "b" }), 1); // freed
});

test("LEAK SELF-HEAL: a crashed replica's stale reservation is pruned on the next acquire", () => {
  const z = new Map<string, number>();
  const ttlMs = 150_000;
  const cap = 1;
  // t0: replica A reserves, then CRASHES (never releases) → "a" lingers at score t0.
  assert.equal(simulateAcquire(z, { now: 1_000_000, ttlMs, cap, reqId: "a" }), 1);
  // t0 + 100s: still within TTL → "a" counts, so a new request is correctly rejected (not yet leaked).
  assert.equal(simulateAcquire(z, { now: 1_100_000, ttlMs, cap, reqId: "b" }), 0);
  assert.equal(z.has("a"), true);
  // t0 + 151s: "a" is now older than TTL → pruned, and the new request gets the freed slot.
  assert.equal(simulateAcquire(z, { now: 1_151_000, ttlMs, cap, reqId: "b" }), 1);
  assert.equal(z.has("a"), false); // self-healed
});

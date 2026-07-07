import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HUNT_INFLIGHT_KEY,
  HUNT_INFLIGHT_ACQUIRE_LUA,
  huntGlobalMaxConcurrent,
  huntInflightTtlMs,
  huntInflightStaleCutoff,
  DEFAULT_HUNT_GLOBAL_MAX_CONCURRENT,
  DEFAULT_HUNT_INFLIGHT_TTL_MS,
} from "./hunt-global-gate";

test("hunt global cap: unset falls back to default (24)", () => {
  assert.equal(huntGlobalMaxConcurrent({} as NodeJS.ProcessEnv), DEFAULT_HUNT_GLOBAL_MAX_CONCURRENT);
  assert.equal(huntGlobalMaxConcurrent({} as NodeJS.ProcessEnv), 24);
});

test("hunt global cap: valid parsed; invalid values fall back", () => {
  assert.equal(huntGlobalMaxConcurrent({ HUNT_GLOBAL_MAX_CONCURRENT: "50" } as NodeJS.ProcessEnv), 50);
  assert.equal(huntGlobalMaxConcurrent({ HUNT_GLOBAL_MAX_CONCURRENT: "0" } as NodeJS.ProcessEnv), 24);
  assert.equal(huntGlobalMaxConcurrent({ HUNT_GLOBAL_MAX_CONCURRENT: "nope" } as NodeJS.ProcessEnv), 24);
});

test("hunt inflight TTL: unset falls back to default (>120s maxDuration)", () => {
  assert.equal(huntInflightTtlMs({} as NodeJS.ProcessEnv), DEFAULT_HUNT_INFLIGHT_TTL_MS);
  assert.ok(DEFAULT_HUNT_INFLIGHT_TTL_MS > 120_000);
});

test("huntInflightStaleCutoff = now − ttl", () => {
  assert.equal(huntInflightStaleCutoff(1_000_000, 150_000), 850_000);
});

test("hunt acquire Lua prunes, caps, reserves, refreshes TTL", () => {
  const lua = HUNT_INFLIGHT_ACQUIRE_LUA;
  assert.match(lua, /ZREMRANGEBYSCORE/);
  assert.match(lua, /ZCARD/);
  assert.match(lua, /ZADD/);
  assert.match(lua, /PEXPIRE/);
  assert.equal(HUNT_INFLIGHT_KEY, "blackout:hunt:inflight");
});

function simulateAcquire(
  zset: Map<string, number>,
  opts: { now: number; ttlMs: number; cap: number; reqId: string }
): 0 | 1 {
  const cutoff = huntInflightStaleCutoff(opts.now, opts.ttlMs);
  for (const [member, score] of [...zset]) if (score <= cutoff) zset.delete(member);
  if (zset.size >= opts.cap) return 0;
  zset.set(opts.reqId, opts.now);
  return 1;
}

test("hunt global gate admits up to cap then rejects", () => {
  const z = new Map<string, number>();
  const base = { now: 1_000_000, ttlMs: 150_000, cap: 2 };
  assert.equal(simulateAcquire(z, { ...base, reqId: "a" }), 1);
  assert.equal(simulateAcquire(z, { ...base, reqId: "b" }), 1);
  assert.equal(simulateAcquire(z, { ...base, reqId: "c" }), 0);
});

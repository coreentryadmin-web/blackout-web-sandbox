import { test } from "node:test";
import assert from "node:assert/strict";

// Set a deterministic threshold BEFORE the target module loads (it reads the env at
// load time). The import is dynamic + inside each async test to avoid top-level await,
// which this project's CJS transform does not support. uw-rate-limiter.ts has no
// @/lib/* imports, so it loads cleanly under `npx tsx --test`.
process.env.UW_CIRCUIT_429_THRESHOLD = "5";

test("breaker trips at exactly THRESHOLD distinct 429s, not half (the double-count regression guard)", async () => {
  const { noteUw429, isUwCircuitOpen, resetUwCircuitForTest } = await import("./uw-rate-limiter");
  resetUwCircuitForTest();
  for (let i = 0; i < 4; i++) noteUw429("test");
  // 4 < 5 -> still closed. If a 429 were double-counted, 4 calls would register 8 and
  // the breaker would (wrongly) already be open here.
  assert.equal(isUwCircuitOpen(), false, "breaker opened too early — 429 likely double-counted");
  noteUw429("test"); // 5th -> reaches threshold
  assert.equal(isUwCircuitOpen(), true, "breaker should open at the configured threshold");
});

test("reset clears breaker state between cases", async () => {
  const { isUwCircuitOpen, resetUwCircuitForTest } = await import("./uw-rate-limiter");
  resetUwCircuitForTest();
  assert.equal(isUwCircuitOpen(), false);
});

test("computeDegradedLocalRps divides the global budget across replicas — exact cluster cap (gap #1)", async () => {
  const { computeDegradedLocalRps } = await import("./uw-rate-limiter");
  // 1 replica → full budget: no regression for the common single-replica case (it IS the cluster).
  assert.equal(computeDegradedLocalRps(2, 1), 2);
  // N replicas → GLOBAL/N, so the cluster sum (N * per-replica) equals GLOBAL exactly, never N*MAX.
  assert.equal(computeDegradedLocalRps(2, 2), 1);
  assert.equal(computeDegradedLocalRps(2, 4), 0.5);
  // Fractional is intentional: a floor-to-1 would yield 1 at N=3 and breach (cluster 3 > 2 ceiling).
  assert.ok(Math.abs(computeDegradedLocalRps(2, 3) - 2 / 3) < 1e-9);
  assert.ok(Math.abs(3 * computeDegradedLocalRps(2, 3) - 2) < 1e-9, "3 replicas must sum to the 2-rps ceiling");
  // Polygon-scale budget divides the same way (40 rps / 3 replicas).
  assert.ok(Math.abs(computeDegradedLocalRps(40, 3) - 40 / 3) < 1e-9);
  // Guards: a misconfigured replica count never produces 0 / negative / NaN pacing.
  assert.equal(computeDegradedLocalRps(2, 0), 2, "floor(0) must clamp the divisor to 1");
  assert.equal(computeDegradedLocalRps(2, 1000), 0.1, "absurd replica count clamps to the starvation floor");
});

test("computeDegradedLocalConcurrency divides in-flight budget across replicas", async () => {
  const { computeDegradedLocalConcurrency } = await import("./uw-rate-limiter");
  assert.equal(computeDegradedLocalConcurrency(2, 1), 2);
  assert.equal(computeDegradedLocalConcurrency(2, 2), 1);
  assert.equal(computeDegradedLocalConcurrency(2, 3), 1);
  assert.equal(computeDegradedLocalConcurrency(3, 3), 1);
});

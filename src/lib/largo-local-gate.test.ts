import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LocalConcurrencyBackstop,
  largoLocalMaxConcurrent,
  DEFAULT_LARGO_LOCAL_MAX_CONCURRENT,
} from "./largo-local-gate";

// Pure unit tests for the process-local Largo concurrency backstop. Alias-free,
// runnable via `tsx --test` — no Redis, no Next boot.

// ---- largoLocalMaxConcurrent env parsing ----
test("env cap: unset falls back to default", () => {
  assert.equal(largoLocalMaxConcurrent({} as NodeJS.ProcessEnv), DEFAULT_LARGO_LOCAL_MAX_CONCURRENT);
  assert.equal(largoLocalMaxConcurrent({} as NodeJS.ProcessEnv), 6);
});

test("env cap: valid integer parsed; zero/negative/non-numeric fall back; fractional floored", () => {
  assert.equal(largoLocalMaxConcurrent({ LARGO_LOCAL_MAX_CONCURRENT: "10" } as NodeJS.ProcessEnv), 10);
  assert.equal(largoLocalMaxConcurrent({ LARGO_LOCAL_MAX_CONCURRENT: "0" } as NodeJS.ProcessEnv), 6);
  assert.equal(largoLocalMaxConcurrent({ LARGO_LOCAL_MAX_CONCURRENT: "-3" } as NodeJS.ProcessEnv), 6);
  assert.equal(largoLocalMaxConcurrent({ LARGO_LOCAL_MAX_CONCURRENT: "abc" } as NodeJS.ProcessEnv), 6);
  assert.equal(largoLocalMaxConcurrent({ LARGO_LOCAL_MAX_CONCURRENT: "8.9" } as NodeJS.ProcessEnv), 8);
});

// ---- LocalConcurrencyBackstop acquire/release ----
test("acquires up to the cap, then rejects", () => {
  const b = new LocalConcurrencyBackstop(2);
  assert.equal(b.capacity, 2);
  assert.equal(b.tryAcquire(), true); // 1
  assert.equal(b.tryAcquire(), true); // 2
  assert.equal(b.activeCount, 2);
  assert.equal(b.tryAcquire(), false); // at cap → rejected
  assert.equal(b.activeCount, 2);
});

test("release frees a slot so a new acquire succeeds", () => {
  const b = new LocalConcurrencyBackstop(1);
  assert.equal(b.tryAcquire(), true);
  assert.equal(b.tryAcquire(), false); // full
  b.release();
  assert.equal(b.activeCount, 0);
  assert.equal(b.tryAcquire(), true); // freed slot reused
});

test("release clamps at 0 (stray/double release cannot go negative)", () => {
  const b = new LocalConcurrencyBackstop(2);
  b.release(); // nothing held
  b.release();
  assert.equal(b.activeCount, 0);
  assert.equal(b.tryAcquire(), true);
  b.release();
  b.release(); // double release for one acquire
  assert.equal(b.activeCount, 0);
});

test("cap is floored at >=1 even for bogus constructor values", () => {
  assert.equal(new LocalConcurrencyBackstop(0).capacity, 1);
  assert.equal(new LocalConcurrencyBackstop(-5).capacity, 1);
  assert.equal(new LocalConcurrencyBackstop(3.9).capacity, 3);
});

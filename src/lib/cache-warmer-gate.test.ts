import { test } from "node:test";
import assert from "node:assert/strict";

test("shouldRunCacheWarmer: force always runs", async () => {
  delete process.env.CACHE_WARM_ALWAYS;
  const { shouldRunCacheWarmer } = await import("./cache-warmer-gate");
  assert.equal(shouldRunCacheWarmer(true), true);
});

test("shouldRunCacheWarmer: CACHE_WARM_ALWAYS bypasses hours", async () => {
  process.env.CACHE_WARM_ALWAYS = "1";
  const { shouldRunCacheWarmer } = await import("./cache-warmer-gate");
  assert.equal(shouldRunCacheWarmer(false, new Date("2026-07-08T07:00:00Z")), true);
  delete process.env.CACHE_WARM_ALWAYS;
});

import test from "node:test";
import assert from "node:assert";
import { withFallbacks, globalDiagnostics } from "./diagnostics.js";

test("withFallbacks executes sources in order and returns first success", async () => {
  const calls: string[] = [];

  const result = await withFallbacks("SPY", "price_fetch", [
    {
      name: "daily_close",
      fetch: async () => {
        calls.push("daily_close");
        return null; // fail
      }
    },
    {
      name: "hourly_close",
      fetch: async () => {
        calls.push("hourly_close");
        return 500.25; // success
      }
    },
    {
      name: "last_trade",
      fetch: async () => {
        calls.push("last_trade");
        return 501;
      }
    }
  ]);

  assert.strictEqual(result.value, 500.25, "Should return first successful source");
  assert.strictEqual(result.attempts.length, 2, "Should have 2 attempts (1 fail, 1 success)");
  assert.deepStrictEqual(calls, ["daily_close", "hourly_close"], "Should try sources in order, stop on success");
});

test("withFallbacks handles all failures and returns null", async () => {
  const result = await withFallbacks("SPX", "atr_fetch", [
    {
      name: "daily_bars",
      fetch: async () => {
        throw new Error("no daily bars");
      }
    },
    {
      name: "hourly_bars",
      fetch: async () => {
        return null; // no data
      }
    }
  ]);

  assert.strictEqual(result.value, null, "Should return null when all sources fail");
  assert.strictEqual(result.attempts.length, 2, "Should have attempts for all sources");
  assert(result.attempts[0]?.error, "First attempt should have error");
  assert(result.attempts[1]?.ok === false, "Second attempt should be marked failed");
});

test("withFallbacks respects 5000ms timeout per source", async () => {
  const start = Date.now();

  const result = await withFallbacks("AAPL", "test_timeout", [
    {
      name: "slow_source",
      fetch: async () => {
        // This will be interrupted by the 5000ms timeout
        await new Promise(resolve => setTimeout(resolve, 10000)); // 10s
        return 42;
      }
    },
    {
      name: "fallback",
      fetch: async () => {
        return 100;
      }
    }
  ]);

  const elapsed = Date.now() - start;

  // Should timeout on first source and use fallback
  assert.strictEqual(result.value, 100, "Should use fallback after timeout");
  assert(elapsed < 8000, "Total time should be under 8s (5s timeout + overhead)");
});

test("Diagnostics records data sourcing attempts with full details", async () => {
  // Clear diagnostics for this test
  const start = globalDiagnostics.summary("test", 0, 0, 0).data_sourcing_trails.length;

  await withFallbacks("TEST", "verification_fetch", [
    {
      name: "source1",
      fetch: async () => 42
    }
  ]);

  const summary = globalDiagnostics.summary("test", 0, 0, 0);
  const trails = summary.data_sourcing_trails.slice(start);

  assert(trails.length > 0, "Should record data sourcing trail");
  assert.strictEqual(trails[0]?.ticker, "TEST", "Should record ticker");
  assert.strictEqual(trails[0]?.stage, "verification_fetch", "Should record stage");
  assert(trails[0]?.timestamp, "Should record timestamp");
  assert(trails[0]?.attempts.length === 1, "Should have 1 attempt");
  assert(trails[0]?.attempts[0]?.ok === true, "Attempt should be marked successful");
  assert.strictEqual(trails[0]?.final_value, 42, "Should record final value");
});

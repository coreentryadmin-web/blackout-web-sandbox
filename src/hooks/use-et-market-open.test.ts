import { test } from "node:test";
import assert from "node:assert/strict";
import { useDeskSessionPollIntervalMs } from "@/hooks/use-et-market-open";

test("useDeskSessionPollIntervalMs: fast poll during active desk session (RTH + premarket)", () => {
  assert.equal(useDeskSessionPollIntervalMs(true, 8000, 20_000), 8000);
  assert.equal(useDeskSessionPollIntervalMs(false, 8000, 20_000), 20_000);
  assert.equal(useDeskSessionPollIntervalMs(undefined, 8000, 20_000), 20_000);
});

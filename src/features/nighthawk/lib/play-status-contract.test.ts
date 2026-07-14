import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Source contract for /api/nighthawk/play-status: the "morning confirmation not yet run" branch is
 * the EXPECTED state for most of every day (before the 9:15am ET cron, and all evening once the
 * date rolls to the next ET day), so it must respond 200 — a 404 there printed a red console error
 * on every Night Hawk pane load and read as breakage in member devtools + our zero-console-error
 * E2E gates. True failure states (Redis unconfigured/down) keep their error codes.
 */
test("play-status route: not-yet-run is a 200 (expected state), never a 404", () => {
  const src = readFileSync(
    join(process.cwd(), "src/app/api/nighthawk/play-status/route.ts"),
    "utf8"
  );

  const notYetRun = src.slice(src.indexOf("if (!raw)"), src.indexOf("const result = JSON.parse"));
  assert.match(notYetRun, /available:\s*false/, "not-yet-run branch keeps the honest available:false body");
  assert.match(notYetRun, /status:\s*200/, "not-yet-run branch responds 200");
  assert.doesNotMatch(notYetRun, /status:\s*404/, "no 404 for the expected pre-cron state");

  // The real error states stay loud: Redis unconfigured/down must NOT be silently 200'd.
  assert.match(src, /status:\s*503/, "Redis-unavailable states keep an error status");
});

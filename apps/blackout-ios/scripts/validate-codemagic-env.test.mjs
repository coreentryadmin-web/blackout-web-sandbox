import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { APPLE_BUNDLE_ID } from "./ios-bundle-ids.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "validate-codemagic-env.mjs");

function run(env) {
  return spawnSync(process.execPath, [script], { env: { ...process.env, ...env }, encoding: "utf8" });
}

test("passes with expected Codemagic env", () => {
  const r = run({ APPLE_TEAM_ID: "ZA32C782N5", BUNDLE_ID: APPLE_BUNDLE_ID });
  assert.equal(r.status, 0, r.stderr);
});

test("rejects wrong team ID", () => {
  const r = run({ APPLE_TEAM_ID: "663D77E68E", BUNDLE_ID: APPLE_BUNDLE_ID });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /663D77E68E/);
});

test("rejects wrong bundle ID typo", () => {
  const r = run({ APPLE_TEAM_ID: "ZA32C782N5", BUNDLE_ID: "com.blackout-trader.app" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /blackout-trader/);
});

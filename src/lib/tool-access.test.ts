import { test } from "node:test";
import assert from "node:assert/strict";
import { getLaunchStatusSnapshot, isToolLaunched, lockedToolKeys, toolKeyForHref, TOOLS } from "./tool-access";

// Pure unit tests for launch gating. Alias-free, runnable via `tsx --test` — no Clerk, no Next.

const E = (v?: string): NodeJS.ProcessEnv => ({ LAUNCHED_TOOLS: v } as NodeJS.ProcessEnv);

test("defaults: all tools live except Largo and Vector", () => {
  const env = {} as NodeJS.ProcessEnv;
  assert.equal(isToolLaunched("spx", env), true);
  assert.equal(isToolLaunched("flows", env), true);
  assert.equal(isToolLaunched("heatmap", env), true);
  assert.equal(isToolLaunched("nighthawk", env), true);
  assert.equal(isToolLaunched("grid", env), true);
  assert.equal(isToolLaunched("largo", env), false);
  assert.equal(isToolLaunched("vector", env), false);
  assert.deepEqual(lockedToolKeys(env), ["largo", "vector"]);
});

test("LAUNCHED_TOOLS is additive — can still unlock Largo without affecting defaults", () => {
  const env = E("largo");
  assert.equal(isToolLaunched("largo", env), true);
  assert.equal(isToolLaunched("heatmap", env), true);
  assert.deepEqual(lockedToolKeys(env), ["vector"]);
});

test("LAUNCHED_TOOLS parses CSV, trims, lowercases, ignores unknown keys", () => {
  const env = E("  Largo , bogus ");
  assert.equal(isToolLaunched("largo", env), true);
  assert.equal(isToolLaunched("grid", env), true);
  assert.deepEqual(lockedToolKeys(env), ["vector"]);
});

test("can never accidentally lock the default-live tools via env", () => {
  const env = {} as NodeJS.ProcessEnv;
  assert.equal(isToolLaunched("spx", env), true);
  assert.equal(isToolLaunched("flows", env), true);
  assert.equal(isToolLaunched("heatmap", env), true);
  assert.equal(isToolLaunched("grid", env), true);
});

test("toolKeyForHref maps in-app routes to keys, null for non-tools", () => {
  assert.equal(toolKeyForHref("/terminal"), "largo");
  assert.equal(toolKeyForHref("/heatmap"), "heatmap");
  assert.equal(toolKeyForHref("/nighthawk"), "nighthawk");
  assert.equal(toolKeyForHref("/dashboard"), "spx");
  assert.equal(toolKeyForHref("/flows"), "flows");
  assert.equal(toolKeyForHref("/pricing"), null);
});

test("every tool has a unique key + href", () => {
  assert.equal(new Set(TOOLS.map((t) => t.key)).size, TOOLS.length);
  assert.equal(new Set(TOOLS.map((t) => t.href)).size, TOOLS.length);
});

test("getLaunchStatusSnapshot reflects env and default-live tools", () => {
  const unset = getLaunchStatusSnapshot({} as NodeJS.ProcessEnv);
  assert.equal(unset.launched_tools_env, null);
  assert.equal(unset.open_count, 5);
  assert.equal(unset.total_count, 7);
  assert.deepEqual(unset.locked_keys, ["largo", "vector"]);
  assert.equal(unset.tools.find((t) => t.key === "spx")?.launch_source, "default");
  assert.equal(unset.tools.find((t) => t.key === "heatmap")?.launch_source, "default");
  assert.equal(unset.tools.find((t) => t.key === "largo")?.launch_source, "locked");
  assert.equal(unset.tools.find((t) => t.key === "vector")?.launch_source, "locked");

  const largoOnly = getLaunchStatusSnapshot(E("largo"));
  assert.equal(largoOnly.open_count, 6);
  assert.deepEqual(largoOnly.locked_keys, ["vector"]);
  assert.equal(largoOnly.tools.find((t) => t.key === "largo")?.launch_source, "env");
});

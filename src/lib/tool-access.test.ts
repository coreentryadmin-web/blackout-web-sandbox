import { test } from "node:test";
import assert from "node:assert/strict";
import { isToolLaunched, lockedToolKeys, toolKeyForHref, TOOLS } from "./tool-access";

// Pure unit tests for launch gating. Alias-free, runnable via `tsx --test` — no Clerk, no Next.

const E = (v?: string): NodeJS.ProcessEnv => ({ LAUNCHED_TOOLS: v } as NodeJS.ProcessEnv);

test("defaults: SPX + HELIX live; Heatmaps/Largo/Night Hawk/Grid locked", () => {
  const env = {} as NodeJS.ProcessEnv;
  assert.equal(isToolLaunched("spx", env), true);
  assert.equal(isToolLaunched("flows", env), true);
  assert.equal(isToolLaunched("heatmap", env), false);
  assert.equal(isToolLaunched("largo", env), false);
  assert.equal(isToolLaunched("nighthawk", env), false);
  assert.equal(isToolLaunched("grid", env), false);
  assert.deepEqual(lockedToolKeys(env).sort(), ["grid", "heatmap", "largo", "nighthawk"]);
});

test("LAUNCHED_TOOLS is additive — unlocking one tool leaves the others locked", () => {
  const env = E("heatmap");
  assert.equal(isToolLaunched("heatmap", env), true);
  assert.equal(isToolLaunched("largo", env), false);
  assert.equal(isToolLaunched("nighthawk", env), false);
  assert.deepEqual(lockedToolKeys(env).sort(), ["grid", "largo", "nighthawk"]);
});

test("LAUNCHED_TOOLS unlocks grid when included", () => {
  const env = E("grid");
  assert.equal(isToolLaunched("grid", env), true);
  assert.equal(isToolLaunched("heatmap", env), false);
});

test("LAUNCHED_TOOLS parses CSV, trims, lowercases, ignores unknown keys", () => {
  const env = E("  Largo , NIGHTHAWK , GRID , bogus ");
  assert.equal(isToolLaunched("largo", env), true);
  assert.equal(isToolLaunched("nighthawk", env), true);
  assert.equal(isToolLaunched("grid", env), true);
  assert.equal(isToolLaunched("heatmap", env), false);
  assert.deepEqual(lockedToolKeys(env), ["heatmap"]);
});

test("can never accidentally lock the default-live tools via env", () => {
  const env = E("heatmap,largo,nighthawk,grid");
  assert.equal(isToolLaunched("spx", env), true);
  assert.equal(isToolLaunched("flows", env), true);
  assert.deepEqual(lockedToolKeys(env), []); // all unlocked
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

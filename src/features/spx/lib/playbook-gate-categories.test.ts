import test from "node:test";
import assert from "node:assert/strict";
import { classifyGateBlock, categorizeGateBlocks, firstGateBlockCategory } from "./playbook-gate-categories";

test("classifyGateBlock: playbook validity", () => {
  assert.equal(classifyGateBlock("Playbook PB-03 not in live allowlist"), "playbook_validity");
  assert.equal(classifyGateBlock("Unknown EMA regime — playbook live gate fail-closed"), "playbook_validity");
});

test("classifyGateBlock: operational vs risk", () => {
  assert.equal(classifyGateBlock("Opening range — no BUY until 9:50 AM ET"), "operational");
  assert.equal(classifyGateBlock("Buy cooldown (10m after any exit)"), "risk");
});

test("categorizeGateBlocks: buckets all blocks", () => {
  const cats = categorizeGateBlocks([
    "Opening range — no BUY",
    "Buy cooldown",
    "Grade B below minimum",
  ]);
  assert.equal(cats.operational.length, 1);
  assert.equal(cats.risk.length, 1);
  assert.equal(cats.quality.length, 1);
});

test("firstGateBlockCategory: operational before quality", () => {
  assert.equal(
    firstGateBlockCategory(["Opening range — no BUY", "Grade B below minimum"]),
    "operational"
  );
});

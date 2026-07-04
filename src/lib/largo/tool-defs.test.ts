import { test } from "node:test";
import assert from "node:assert/strict";
import { BIE_TOOL_NAMES, LARGO_TOOL_DEFS, TOOL_GROUPS } from "./tool-defs";

test("BIE_TOOL_NAMES: every name is a real, callable Largo tool", () => {
  const known = new Set(LARGO_TOOL_DEFS.map((t) => t.name));
  for (const name of BIE_TOOL_NAMES) {
    assert.ok(known.has(name), `${name} is in BIE_TOOL_NAMES but not in LARGO_TOOL_DEFS`);
  }
});

test("BIE_TOOL_NAMES: every name is reachable through TOOL_GROUPS.platform", () => {
  for (const name of BIE_TOOL_NAMES) {
    assert.ok(
      TOOL_GROUPS.platform.includes(name),
      `${name} is in BIE_TOOL_NAMES but not routed via TOOL_GROUPS.platform — Largo would never call it`
    );
  }
});

test("BIE_TOOL_NAMES: no duplicates", () => {
  assert.equal(new Set(BIE_TOOL_NAMES).size, BIE_TOOL_NAMES.length);
});

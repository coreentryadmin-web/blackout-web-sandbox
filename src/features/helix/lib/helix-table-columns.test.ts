import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  columnsForDensity,
  groupHeaderSpans,
  matchesDteFilter,
} from "./helix-table-columns.ts";

describe("columnsForDensity", () => {
  it("essential keeps scan-path columns only", () => {
    const ids = columnsForDensity("essential").map((c) => c.id);
    assert.deepEqual(ids, [
      "time",
      "ticker",
      "side",
      "expiry",
      "strike",
      "premium",
      "dte",
      "signals",
    ]);
  });

  it("standard adds fill, oi, rule", () => {
    const ids = columnsForDensity("standard").map((c) => c.id);
    assert.ok(ids.includes("fill"));
    assert.ok(ids.includes("oi"));
    assert.ok(ids.includes("rule"));
    assert.equal(ids.includes("spot"), false);
  });

  it("full exposes chain context columns", () => {
    const ids = columnsForDensity("full").map((c) => c.id);
    assert.ok(ids.includes("spot"));
    assert.ok(ids.includes("iv"));
    assert.ok(ids.includes("score"));
  });
});

describe("groupHeaderSpans", () => {
  it("merges adjacent columns in the same group", () => {
    const cols = columnsForDensity("essential");
    const spans = groupHeaderSpans(cols);
    assert.deepEqual(
      spans.map((s) => s.label),
      ["Print", "Contract", "Notional", "Chain", "Intel"]
    );
    assert.equal(spans.find((s) => s.group === "contract")?.span, 3);
  });
});

describe("matchesDteFilter", () => {
  it("filters 0dte and week buckets", () => {
    assert.equal(matchesDteFilter(0, "0dte"), true);
    assert.equal(matchesDteFilter(3, "0dte"), false);
    assert.equal(matchesDteFilter(7, "week"), true);
    assert.equal(matchesDteFilter(8, "month+"), true);
  });
});

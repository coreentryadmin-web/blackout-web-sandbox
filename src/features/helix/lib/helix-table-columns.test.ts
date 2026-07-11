import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  columnsForDensity,
  groupHeaderSpans,
  groupStartIds,
  matchesDteFilter,
  tableMinWidth,
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

describe("tableMinWidth", () => {
  it("sums column widths for essential density", () => {
    const cols = columnsForDensity("essential");
    assert.equal(tableMinWidth(cols), `${cols.reduce((s, c) => s + parseFloat(c.width), 0)}rem`);
  });
});

describe("groupStartIds", () => {
  it("marks the first column in each group", () => {
    const starts = groupStartIds(columnsForDensity("essential"));
    assert.ok(starts.has("time"));
    assert.ok(starts.has("side"));
    assert.ok(starts.has("premium"));
    assert.ok(starts.has("dte"));
    assert.ok(starts.has("signals"));
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

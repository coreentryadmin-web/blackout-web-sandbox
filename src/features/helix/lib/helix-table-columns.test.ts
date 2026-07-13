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

  // Full-width contract: the tape uses table-layout:fixed + width:100%. For the
  // browser to STRETCH the fixed columns across the desk (rather than leave a
  // right-hand gutter), every column must carry a real positive width and the
  // summed min width must stay comfortably under a desktop viewport so there is
  // always slack to distribute. A NaN/zero width here would silently collapse
  // the table back to content width — the exact "crammed into 40%" regression.
  it("every column has a positive rem width at every density", () => {
    for (const density of ["essential", "standard", "full"] as const) {
      for (const col of columnsForDensity(density)) {
        const w = parseFloat(col.width);
        assert.ok(Number.isFinite(w) && w > 0, `${col.id} width invalid: ${col.width}`);
      }
    }
  });

  it("min width stays well under a desktop rail so width:100% always has slack", () => {
    const full = parseFloat(tableMinWidth(columnsForDensity("full")));
    assert.ok(full < 80, `full-density min width ${full}rem should be < 80rem desktop rail`);
  });
});

describe("column slack distribution", () => {
  // Under table-layout:fixed the leftover width is spread proportionally to the
  // specified column widths, so the WIDEST column absorbs the most slack. Signals
  // (the intel column) is intentionally the widest so the extra desk space makes
  // the flags/notional context breathe — not the 3rem TIME/DTE columns.
  it("signals is the widest column at every density so it absorbs the most slack", () => {
    for (const density of ["essential", "standard", "full"] as const) {
      const cols = columnsForDensity(density);
      const widest = cols.reduce((a, b) => (parseFloat(b.width) > parseFloat(a.width) ? b : a));
      assert.equal(widest.id, "signals", `widest at ${density} was ${widest.id}`);
    }
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

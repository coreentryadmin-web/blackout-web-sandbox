import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  columnsForDensity,
  groupHeaderSpans,
  groupStartIds,
  matchesDteFilter,
  tableMinWidth,
  tableGridTemplate,
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
  // The grid tracks are minmax(<rem>, <rem>fr): leftover desk width is spread proportionally to
  // the fr weights (= the rem widths), so the WIDEST column absorbs the most slack. Signals (the
  // intel column) is intentionally the widest so the extra desk space makes the flags/notional
  // context breathe — not the narrow TIME/DTE columns.
  it("signals has the largest grow weight at every density so it absorbs the most slack", () => {
    // Grow weight = growWeight ?? rem width. `time` has a large 9rem FLOOR (to fit the full
    // timestamp) but a deliberately small grow weight, so signals stays the widest-growing column.
    for (const density of ["essential", "standard", "full"] as const) {
      const cols = columnsForDensity(density);
      const grow = (c: (typeof cols)[number]) => c.growWeight ?? parseFloat(c.width);
      const widest = cols.reduce((a, b) => (grow(b) > grow(a) ? b : a));
      assert.equal(widest.id, "signals", `widest-growing at ${density} was ${widest.id}`);
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

describe("tableGridTemplate", () => {
  it("emits one minmax(<floor>, <weight>fr) track per column, floor = the column rem width", () => {
    for (const density of ["essential", "standard", "full"] as const) {
      const cols = columnsForDensity(density);
      const tracks = tableGridTemplate(cols).split(" ").reduce<string[]>((acc, part) => {
        // Re-join the space-split pieces back into whole `minmax(a, b)` tokens.
        if (part.startsWith("minmax(")) acc.push(part);
        else acc[acc.length - 1] += ` ${part}`;
        return acc;
      }, []);
      assert.equal(tracks.length, cols.length, `${density}: one track per column`);
      tracks.forEach((track, i) => {
        assert.match(track, /^minmax\(.+,\s.+fr\)$/, `${density}: track ${i} is minmax(...fr)`);
        assert.ok(track.includes(cols[i].width), `${density}: track ${i} floor is ${cols[i].width}`);
      });
    }
  });

  it("the largest fr weight belongs to signals (the widest-growing column)", () => {
    const cols = columnsForDensity("full");
    const frOf = (track: string) => parseFloat(track.match(/,\s*([\d.]+)fr\)/)?.[1] ?? "0");
    const tracks = tableGridTemplate(cols).match(/minmax\([^)]*\)/g) ?? [];
    const widestFrIdx = tracks.reduce((mi, t, i) => (frOf(t) > frOf(tracks[mi]) ? i : mi), 0);
    assert.equal(cols[widestFrIdx].id, "signals", "signals carries the largest fr weight");
  });

  it("floors and grow weights can diverge — time keeps a 9rem floor but a small fr", () => {
    // Regression guard for the timestamp widening: the floor must be the large 9rem (so the full
    // "MM/DD/YYYY - HH:MM" fits) while the fr weight stays small so time doesn't hog desk slack.
    const cols = columnsForDensity("essential");
    const tracks = tableGridTemplate(cols).match(/minmax\([^)]*\)/g) ?? [];
    const timeIdx = cols.findIndex((c) => c.id === "time");
    assert.match(tracks[timeIdx], /minmax\(9rem,\s*3\.25fr\)/, "time = minmax(9rem, 3.25fr)");
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

import assert from "node:assert/strict";
import test from "node:test";
import {
  parseTreasuryYields,
  parseInflation,
  buildMacroBackdrop,
  pickLatestByDate,
} from "./polygon-macro";

// Field shapes mirror the live /fed/v1 payloads captured in scratchpad/polygon-arsenal.log:
//   treasury-yields → [date, yield_1_year, yield_5_year, yield_10_year]
//   inflation       → [date, cpi]

test("parseTreasuryYields: maps fields and derives the 10y−1y spread", () => {
  const t = parseTreasuryYields([
    { date: "2026-07-10", yield_1_year: 4.1, yield_5_year: 3.9, yield_10_year: 4.35 },
  ]);
  assert.equal(t.date, "2026-07-10");
  assert.equal(t.yield_1_year, 4.1);
  assert.equal(t.yield_10_year, 4.35);
  assert.equal(t.curve_10y_1y_spread, 0.25); // 4.35 − 4.10
});

test("parseTreasuryYields: NEGATIVE spread on an inverted curve", () => {
  const t = parseTreasuryYields([{ date: "2026-07-10", yield_1_year: 5.0, yield_10_year: 4.2 }]);
  assert.equal(t.curve_10y_1y_spread, -0.8);
  assert.equal(t.yield_5_year, null); // absent leg stays null, never fabricated
});

test("parseTreasuryYields: spread null when either leg missing", () => {
  assert.equal(parseTreasuryYields([{ date: "2026-07-10", yield_10_year: 4.2 }]).curve_10y_1y_spread, null);
  assert.equal(parseTreasuryYields([{ date: "2026-07-10", yield_1_year: 4.1 }]).curve_10y_1y_spread, null);
});

test("parseTreasuryYields: empty rows → all null", () => {
  const t = parseTreasuryYields([]);
  assert.deepEqual(t, {
    date: null,
    yield_1_year: null,
    yield_5_year: null,
    yield_10_year: null,
    curve_10y_1y_spread: null,
  });
});

test("parseInflation: maps cpi + date", () => {
  const i = parseInflation([{ date: "2026-06-30", cpi: 321.5 }]);
  assert.deepEqual(i, { date: "2026-06-30", cpi: 321.5 });
});

test("parseInflation: non-finite cpi → null (no fabrication)", () => {
  assert.equal(parseInflation([{ date: "2026-06-30", cpi: "n/a" }]).cpi, null);
  assert.deepEqual(parseInflation([]), { date: null, cpi: null });
});

test("pickLatestByDate: returns the freshest row even when upstream sort is not honored", () => {
  const row = pickLatestByDate([
    { date: "2026-07-01", cpi: 1 },
    { date: "2026-07-10", cpi: 2 }, // newest, but returned second
    { date: "2026-06-15", cpi: 3 },
  ]);
  assert.equal(row?.cpi, 2);
});

test("buildMacroBackdrop: as_of prefers treasury date, then inflation", () => {
  const full = buildMacroBackdrop(
    [{ date: "2026-07-10", yield_1_year: 4.1, yield_10_year: 4.35 }],
    [{ date: "2026-06-30", cpi: 321.5 }]
  );
  assert.equal(full.as_of, "2026-07-10");
  assert.equal(full.treasury.curve_10y_1y_spread, 0.25);
  assert.equal(full.inflation.cpi, 321.5);

  // Treasury missing → as_of falls back to the inflation date.
  const cpiOnly = buildMacroBackdrop([], [{ date: "2026-06-30", cpi: 321.5 }]);
  assert.equal(cpiOnly.as_of, "2026-06-30");
  assert.equal(cpiOnly.treasury.date, null);

  // Both empty → as_of null (caller treats as "no macro data").
  assert.equal(buildMacroBackdrop([], []).as_of, null);
});

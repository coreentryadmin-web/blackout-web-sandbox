import { test } from "node:test";
import assert from "node:assert/strict";
import {
  expiriesForHorizon,
  resolveHorizonExpiries,
  horizonScopeShortLabel,
  formatExpiryShort,
  normalizeDteHorizon,
  isVectorDteHorizon,
  dteHorizonLabel,
  pickHorizonScopedValue,
  VECTOR_DTE_HORIZONS,
} from "./vector-dte-horizon";

// Monday 2026-07-13 is an expiry; today is a trading day.
const EXPS = ["2026-07-13", "2026-07-14", "2026-07-17", "2026-07-20", "2026-08-15", "2026-09-18"];

test("expiriesForHorizon: 0dte on a trading day returns only today's expiry", () => {
  assert.deepEqual(expiriesForHorizon(EXPS, "0dte", "2026-07-13"), ["2026-07-13"]);
});

test("expiriesForHorizon: weekly is DTE<=7, monthly DTE<=35", () => {
  assert.deepEqual(expiriesForHorizon(EXPS, "weekly", "2026-07-13"), [
    "2026-07-13",
    "2026-07-14",
    "2026-07-17",
    "2026-07-20",
  ]);
  assert.deepEqual(expiriesForHorizon(EXPS, "monthly", "2026-07-13"), [
    "2026-07-13",
    "2026-07-14",
    "2026-07-17",
    "2026-07-20",
    "2026-08-15",
  ]);
});

test("expiriesForHorizon: all returns every non-expired expiry, sorted by DTE", () => {
  assert.deepEqual(expiriesForHorizon(EXPS, "all", "2026-07-13"), EXPS);
});

test("expiriesForHorizon: past expiries are always dropped", () => {
  // today after the first two expiries → they must not appear in any horizon.
  assert.deepEqual(expiriesForHorizon(EXPS, "all", "2026-07-18"), [
    "2026-07-20",
    "2026-08-15",
    "2026-09-18",
  ]);
});

test("expiriesForHorizon: HONEST FALLBACK — bounded horizon with no match returns the nearest expiry, never empty", () => {
  // Saturday 2026-07-11: no expiry today → 0dte must fall back to the nearest (Mon 13),
  // not blank the walls.
  assert.deepEqual(expiriesForHorizon(EXPS, "0dte", "2026-07-11"), ["2026-07-13"]);
});

test("expiriesForHorizon: no live expiries → empty (genuinely nothing to show)", () => {
  assert.deepEqual(expiriesForHorizon(["2026-07-01"], "all", "2026-07-13"), []);
});

test("expiriesForHorizon: malformed expiry strings are ignored, valid ones survive", () => {
  assert.deepEqual(expiriesForHorizon(["garbage", "2026-07-20", ""], "all", "2026-07-13"), ["2026-07-20"]);
});

test("normalizeDteHorizon / isVectorDteHorizon: junk falls back to 'all'", () => {
  assert.equal(normalizeDteHorizon("weekly"), "weekly");
  assert.equal(normalizeDteHorizon("0dte"), "0dte");
  assert.equal(normalizeDteHorizon("nonsense"), "all");
  assert.equal(normalizeDteHorizon(undefined), "all");
  assert.equal(isVectorDteHorizon("monthly"), true);
  assert.equal(isVectorDteHorizon("yearly"), false);
});

test("every horizon has a label", () => {
  for (const h of VECTOR_DTE_HORIZONS) assert.ok(dteHorizonLabel(h).length > 0);
});

test("pickHorizonScopedValue: 'all' always uses the live stream value, ignoring any scoped value", () => {
  assert.equal(pickHorizonScopedValue("all", 190, 197), 197);
  assert.equal(pickHorizonScopedValue("all", null, 197), 197);
});

test("pickHorizonScopedValue: a narrowed horizon uses the scoped value when present", () => {
  // This is the coherence contract: 0DTE walls/flip drive the terminal, not the near-term stream.
  assert.equal(pickHorizonScopedValue("0dte", 190, 197), 190);
  assert.equal(pickHorizonScopedValue("weekly", 180, 197), 180);
  assert.equal(pickHorizonScopedValue("monthly", 180, 197), 180);
});

test("pickHorizonScopedValue: narrowed horizon with no scoped value falls back to the stream (never blanks)", () => {
  // Scoped fetch hasn't landed / yielded nothing → show the stream value rather than nothing.
  assert.equal(pickHorizonScopedValue("0dte", null, 197), 197);
  assert.equal(pickHorizonScopedValue("weekly", undefined, 197), 197);
});

test("pickHorizonScopedValue: works for walls objects, not just numbers (generic)", () => {
  const stream = { callWalls: [{ strike: 210, pct: 5 }], putWalls: [{ strike: 197.5, pct: 4 }] };
  const scoped = { callWalls: [{ strike: 210, pct: 9 }], putWalls: [{ strike: 190, pct: 7 }] };
  assert.equal(pickHorizonScopedValue("all", scoped, stream), stream);
  assert.equal(pickHorizonScopedValue("0dte", scoped, stream), scoped);
  assert.equal(pickHorizonScopedValue("0dte", null, stream), stream);
});

test("pickHorizonScopedValue: a falsy-but-non-null scoped value (0) is still selected under a narrowed horizon", () => {
  // Guards the `!= null` check — 0 is a legitimate scoped flip and must not fall through to stream.
  assert.equal(pickHorizonScopedValue("0dte", 0, 197), 0);
});

test("normalizeDteHorizon: case-insensitive — UI-cased '0DTE'/'WEEKLY' must not silently re-scope to 'all'", () => {
  assert.equal(normalizeDteHorizon("0DTE"), "0dte");
  assert.equal(normalizeDteHorizon("WEEKLY"), "weekly");
  assert.equal(normalizeDteHorizon("Monthly"), "monthly");
  assert.equal(normalizeDteHorizon("ALL"), "all");
  assert.equal(normalizeDteHorizon("garbage"), "all");
  assert.equal(normalizeDteHorizon(null), "all");
});

// ---- P1-B: honest nearest-expiry fallback signal (0DTE silently showing the next expiry) ----

test("resolveHorizonExpiries: in-window match is NOT a fallback", () => {
  const r = resolveHorizonExpiries(EXPS, "0dte", "2026-07-13"); // 07-13 is a same-day expiry
  assert.deepEqual(r.expiries, ["2026-07-13"]);
  assert.equal(r.isFallback, false);
  assert.equal(r.fallbackExpiry, null);
});

test("resolveHorizonExpiries: 0DTE with NO same-day expiry falls back to nearest + flags it", () => {
  // Tuesday 07-14, but the chain's nearest expiry is 07-15 (TSLA/NVDA on a Tuesday — the live bug).
  const exps = ["2026-07-15", "2026-07-18", "2026-08-15"];
  const r = resolveHorizonExpiries(exps, "0dte", "2026-07-14");
  assert.deepEqual(r.expiries, ["2026-07-15"], "returns the nearest expiry so walls never blank");
  assert.equal(r.isFallback, true);
  assert.equal(r.fallbackExpiry, "2026-07-15");
  // expiriesForHorizon (the array-only delegate) still returns the same set — backward compatible.
  assert.deepEqual(expiriesForHorizon(exps, "0dte", "2026-07-14"), ["2026-07-15"]);
});

test("resolveHorizonExpiries: 'all' and empty chains never report a fallback", () => {
  assert.equal(resolveHorizonExpiries(EXPS, "all", "2026-07-13").isFallback, false);
  assert.deepEqual(resolveHorizonExpiries([], "0dte", "2026-07-14"), {
    expiries: [],
    isFallback: false,
    fallbackExpiry: null,
  });
});

test("horizonScopeShortLabel: plain label normally, honest 'no 0DTE · <expiry>' on fallback", () => {
  assert.equal(horizonScopeShortLabel("0dte", { isFallback: false, fallbackExpiry: null }), "0DTE");
  assert.equal(horizonScopeShortLabel("all", null), "near-term");
  assert.equal(horizonScopeShortLabel("weekly", undefined), "Weekly");
  assert.equal(
    horizonScopeShortLabel("0dte", { isFallback: true, fallbackExpiry: "2026-07-15" }),
    "no 0DTE · Jul 15"
  );
});

test("formatExpiryShort: UTC-parsed so it never drifts a day; bad date passes through", () => {
  assert.equal(formatExpiryShort("2026-07-15"), "Jul 15");
  assert.equal(formatExpiryShort("2026-01-01"), "Jan 1");
  assert.equal(formatExpiryShort("not-a-date"), "not-a-date");
});

import test from "node:test";
import assert from "node:assert/strict";
import { isLiveOdteSession, safeTicker, safePathSegment, safeDateSegment, sym } from "./unusual-whales";
import { UW_REST_SECTIONS } from "../uw-docs-catalog";

// 2026-07-03 is a US market holiday (July 4th observed) per nighthawk/session.ts's calendar.
test("isLiveOdteSession: false on a market holiday even during normal trading hours", () => {
  assert.equal(isLiveOdteSession(new Date("2026-07-03T15:00:00.000Z")), false); // 11:00 ET
});

test("isLiveOdteSession: false on a weekend", () => {
  assert.equal(isLiveOdteSession(new Date("2026-07-04T15:00:00.000Z")), false); // Saturday
});

test("isLiveOdteSession: false off-hours on an otherwise real trading day", () => {
  assert.equal(isLiveOdteSession(new Date("2026-07-06T09:00:00.000Z")), false); // Mon 05:00 ET — before the 7am window
});

test("isLiveOdteSession: true during the trading window on a real trading day", () => {
  assert.equal(isLiveOdteSession(new Date("2026-07-06T15:00:00.000Z")), true); // Mon 11:00 ET
});

// ── safeTicker/safePathSegment/safeDateSegment/sym: `ticker` (and related identifiers) are
// untrusted, user-supplied input that this file splices into ~60 URL PATH segments via
// template literal — same class of bug as polygon-options-gex.ts's `resolveOptionsRoot`,
// flagged there by CodeQL as request-forgery. A crafted value must not reach the outbound URL.

test("safeTicker: normal tickers pass through uppercased, unchanged", () => {
  assert.equal(safeTicker("spy"), "SPY");
  assert.equal(safeTicker("nvda"), "NVDA");
});

test("safeTicker: dotted share classes (BRK.A/BRK.B) are preserved", () => {
  assert.equal(safeTicker("brk.b"), "BRK.B");
});

test("safeTicker: rejects (empty string) anything with path-injection characters, does not mangle-and-pass-through", () => {
  assert.equal(safeTicker("AAPL/../../evil.com"), "");
  assert.equal(safeTicker("SPY@evil.com"), "");
  assert.equal(safeTicker("SPY:8080"), "");
  assert.equal(safeTicker("SPY\nHost: evil.com"), "");
});

test("safeTicker: null/undefined/empty never throws", () => {
  assert.equal(safeTicker(""), "");
  assert.equal(safeTicker(undefined as unknown as string), "");
});

test("safePathSegment: lowercases legitimate [a-z0-9-] values, rejects anything else", () => {
  assert.equal(safePathSegment("SMA"), "sma");
  assert.equal(safePathSegment("technology"), "technology");
  assert.equal(safePathSegment("../../etc/passwd"), "");
  assert.equal(safePathSegment("foo bar@baz"), "");
});

test("safeDateSegment: passes through a clean digits-and-hyphens date, rejects anything else", () => {
  assert.equal(safeDateSegment("2026-07-06"), "2026-07-06");
  assert.equal(safeDateSegment("2026-07-06/../evil"), "");
});

test("sym: uppercases, strips the I: index prefix, then applies the same allowlist-and-reject guard", () => {
  assert.equal(sym("spy"), "SPY");
  assert.equal(sym("I:SPX"), "SPX");
  assert.equal(sym("i:vix"), "VIX");
  assert.equal(sym("AAPL/../evil"), "");
});

// ── Catalog-path regression guard. Four endpoints in this provider were calling
// paths that don't exist in the UW API (wrong pluralization / renamed routes),
// so `uwGetSafe` swallowed the 404 and returned null — the data was silently
// MISSING (short screener, ETF in/out-flow, ETF tide, screener option-contracts)
// with no error surfaced. The catalog (auto-generated from UW's own OpenAPI) is
// ground truth: every path we call must appear in it. These assertions pin the
// corrected paths so a copy/paste or a "helpful" rename can't regress them back
// to a silently-404ing route.
const CATALOG_PATHS = new Set(UW_REST_SECTIONS.flatMap((s) => s.endpoints.map((e) => e.path)));

test("UW provider paths exist in the docs catalog (no silent 404s)", () => {
  // Concrete tickers in code map to `{ticker}` in the catalog template.
  for (const p of [
    "/api/short_screener",
    "/api/etfs/{ticker}/in-outflow",
    "/api/market/{ticker}/etf-tide",
    "/api/screener/option-contracts",
  ]) {
    assert.ok(CATALOG_PATHS.has(p), `${p} must exist in UW_REST_SECTIONS (catalog is ground truth)`);
  }
});

test("the old broken UW paths are NOT in the catalog (they were the bug)", () => {
  for (const p of [
    "/api/shorts/screener",
    "/api/etf/{ticker}/in-outflow",
    "/api/etf/{ticker}/tide",
    "/api/screener/contracts",
  ]) {
    assert.ok(!CATALOG_PATHS.has(p), `${p} is a non-existent route — must not be reintroduced`);
  }
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nhFromRows, pageSpxMatchesPublic } from "@/lib/track-record-page";
import type { PublicTrackRecord } from "@/lib/track-record-public";
import type { NighthawkPlayOutcomeRow } from "@/lib/db";

function nhRow(overrides: Partial<NighthawkPlayOutcomeRow>): NighthawkPlayOutcomeRow {
  return {
    id: 1,
    edition_for: "2026-06-30",
    ticker: "TEST",
    direction: "LONG",
    conviction: "high",
    entry_range_low: null,
    entry_range_high: null,
    target: null,
    stop: null,
    score: null,
    sector: null,
    next_day_open: null,
    next_day_close: null,
    session_high: null,
    session_low: null,
    hit_target: false,
    hit_stop: false,
    outcome: "target",
    created_at: new Date().toISOString(),
    // PR-N2: fixtures are current-methodology by default — a legacy-tagged row is
    // quarantined out of every headline surface via isNighthawkOutcomeScoreable.
    grade_methodology: "v2_fillability",
    ...overrides,
  };
}

describe("track-record-page", () => {
  it("pageSpxMatchesPublic agrees when SPX block matches public ledger", () => {
    const pub: PublicTrackRecord = {
      available: true,
      generated_at: new Date().toISOString(),
      total_closed: 3,
      days_of_data: 1,
      win_rate_pct: 0,
      wins: 0,
      losses: 3,
      breakeven: 0,
      paths: {
        cold_buy: { count: 1, win_rate_pct: 0, avg_mfe_pts: 0 },
        watch_promote: { count: 2, win_rate_pct: 0, avg_mfe_pts: 0 },
      },
      adaptive_active: false,
      summary: "test",
    };
    const page = {
      spxSlayer: { total: 3, wins: 0, losses: 3, winRatePct: 0 },
      nightHawk: {
        total: 0,
        wins: 0,
        losses: 0,
        winRatePct: null,
        avgWinnerPct: null,
        avgLoserPct: null,
        profitFactor: null,
      },
      methodology: "",
      liveData: true,
    };
    assert.equal(pageSpxMatchesPublic(page, pub), true);
  });

  it("pageSpxMatchesPublic flags split-brain mismatch", () => {
    const pub: PublicTrackRecord = {
      available: true,
      generated_at: new Date().toISOString(),
      total_closed: 3,
      days_of_data: 1,
      win_rate_pct: 0,
      wins: 0,
      losses: 3,
      breakeven: 0,
      paths: {
        cold_buy: { count: 0, win_rate_pct: 0, avg_mfe_pts: 0 },
        watch_promote: { count: 0, win_rate_pct: 0, avg_mfe_pts: 0 },
      },
      adaptive_active: false,
      summary: "test",
    };
    const page = {
      spxSlayer: { total: 0, wins: 0, losses: 0, winRatePct: null },
      nightHawk: {
        total: 0,
        wins: 0,
        losses: 0,
        winRatePct: null,
        avgWinnerPct: null,
        avgLoserPct: null,
        profitFactor: null,
      },
      methodology: "",
      liveData: true,
    };
    assert.equal(pageSpxMatchesPublic(page, pub), false);
  });

  it("pageSpxMatchesPublic catches a double-rounding win-rate divergence, not just totals", () => {
    // Regression: page.winRatePct (1 decimal) and pub.win_rate_pct (integer) used to be
    // computed by two independently hand-written rounding formulas over the same raw
    // fraction. A raw win_rate of 0.6245 rounds to page="62.5" (1dp) and, if pub had used
    // a *different* formula, could independently land on "62" instead of the consistent
    // "63" that rounding 62.5 itself gives -- a real member-visible split-brain even
    // though total/wins/losses all agree. This asserts that mismatch is caught.
    const pub: PublicTrackRecord = {
      available: true,
      generated_at: new Date().toISOString(),
      total_closed: 10,
      days_of_data: 5,
      win_rate_pct: 62, // deliberately wrong vs. the page's 62.5 -- should NOT agree
      wins: 6,
      losses: 4,
      breakeven: 0,
      paths: {
        cold_buy: { count: 0, win_rate_pct: 0, avg_mfe_pts: 0 },
        watch_promote: { count: 0, win_rate_pct: 0, avg_mfe_pts: 0 },
      },
      adaptive_active: false,
      summary: "test",
    };
    const page = {
      spxSlayer: { total: 10, wins: 6, losses: 4, winRatePct: 62.5 },
      nightHawk: {
        total: 0,
        wins: 0,
        losses: 0,
        winRatePct: null,
        avgWinnerPct: null,
        avgLoserPct: null,
        profitFactor: null,
      },
      methodology: "",
      liveData: true,
    };
    assert.equal(pageSpxMatchesPublic(page, pub), false, "62.5 rounds to 63, not 62 -- must be flagged");

    const consistentPub = { ...pub, win_rate_pct: 63 };
    assert.equal(pageSpxMatchesPublic(page, consistentPub), true, "63 is the correct re-round of 62.5");
  });

  it("nhFromRows excludes a corrupt entry range from winner stats instead of corrupting them", () => {
    // Corrupt row: entry_range_low=17 is a garbage placeholder against a stock
    // trading near $450 — the range width is wildly outside a plausible intraday
    // band. Should be dropped from the return math entirely (not clamped/averaged in).
    const corruptWinner = nhRow({
      id: 1,
      entry_range_low: 17,
      entry_range_high: 448,
      outcome: "target",
      next_day_close: 450,
    });
    // Normal tight-range winner: legitimate published entry zone, should be counted.
    const normalWinner = nhRow({
      id: 2,
      entry_range_low: 443,
      entry_range_high: 447,
      outcome: "target",
      next_day_close: 452,
    });

    const corruptOnly = nhFromRows([corruptWinner]);
    assert.equal(corruptOnly.avgWinnerPct, null, "corrupt row alone must not produce a winner return");
    assert.equal(corruptOnly.profitFactor, null, "corrupt row alone must not produce a profit factor");

    const mixed = nhFromRows([corruptWinner, normalWinner]);
    // entry_mid = (443+447)/2 = 445; return = (452-445)/445*100 ≈ 1.573% → rounds to 1.6
    assert.equal(mixed.avgWinnerPct, 1.6, "avgWinnerPct should reflect only the legitimate row");
    assert.equal(
      mixed.profitFactor,
      null,
      "profitFactor should stay null (no loser rows), not an absurd value driven by the corrupt row"
    );
  });

  it("nhFromRows: total reconciles with wins + losses + unresolved (matches the live QQQ/AAPL/SPY board shape)", () => {
    // Regression: isNighthawkOutcomeScoreable() admits 'open' and 'ambiguous' outcomes
    // alongside 'target'/'stop' into `total`, but only 'target'/'stop' were ever counted
    // into wins/losses — so total could exceed wins + losses with no field explaining the
    // gap. Confirmed live: an admin track-record pull showed total:10, wins:6, losses:3
    // (6+3=9≠10) with nothing accounting for the 10th play.
    const target = nhRow({ id: 1, outcome: "target" });
    const stop = nhRow({ id: 2, outcome: "stop" });
    const open = nhRow({ id: 3, outcome: "open", session_high: 100, session_low: 90 });
    const ambiguous = nhRow({ id: 4, outcome: "ambiguous", session_high: 100, session_low: 90 });

    const stats = nhFromRows([target, stop, open, ambiguous]);
    assert.equal(stats.total, 4);
    assert.equal(stats.wins, 1);
    assert.equal(stats.losses, 1);
    assert.equal(stats.unresolved, 2, "'open' + 'ambiguous' rows must be accounted for, not silently dropped");
    assert.equal(
      stats.total,
      stats.wins + stats.losses + (stats.unresolved ?? 0),
      "total must always reconcile with wins + losses + unresolved"
    );
  });

  it("nhFromRows quarantines legacy-methodology grades out of the public record (PR-N2 anti-blend)", () => {
    // The N-2 phantom-win shape: a legacy 'target' graded before the fillability rule.
    // It must not enter total/wins on any headline surface until the honest regrade
    // re-verifies it under current rules and stamps it current.
    const legacyPhantomWin = nhRow({ id: 1, outcome: "target", grade_methodology: "v1_level_touch" });
    const unstamped = nhRow({ id: 2, outcome: "target", grade_methodology: null });
    const currentWin = nhRow({ id: 3, outcome: "target" });
    const currentStop = nhRow({ id: 4, outcome: "stop" });

    const stats = nhFromRows([legacyPhantomWin, unstamped, currentWin, currentStop]);
    assert.equal(stats.total, 2, "legacy + unstamped rows must not count");
    assert.equal(stats.wins, 1);
    assert.equal(stats.losses, 1);
    assert.equal(stats.winRatePct, 50, "the phantom wins must not inflate the win rate");
  });
});

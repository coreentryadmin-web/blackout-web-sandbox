import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parsePriceTargetFromText,
  computeFundamentalSignals,
  type PolygonIncomeStatement,
  type PolygonBalanceSheet,
  type PolygonCashFlowStatement,
} from "@/lib/providers/polygon";
import {
  stripPriceTargetClaims,
  PRICE_TARGET_TOLERANCE_PCT,
} from "./grounding";

// ── Benzinga PT parser (target-anchored, NEW-target-wins) ──────────────────────

test("PT parse: 'BofA raised MU price target to $1,500' → 1500, raised, BofA", () => {
  const r = parsePriceTargetFromText("BofA raised MU price target to $1,500 from $1,200");
  assert.ok(r);
  assert.equal(r!.value, 1500); // NEW target near the cue wins, not the old $1,200
  assert.equal(r!.action, "raised");
  assert.equal((r!.firm ?? "").toLowerCase().includes("bofa"), true);
});

test("PT parse: lowered action + firm before figure ('$95 price target')", () => {
  const r = parsePriceTargetFromText("Morgan Stanley cut its $95 price target on the stock");
  assert.ok(r);
  assert.equal(r!.value, 95);
  assert.equal(r!.action, "lowered");
  assert.equal((r!.firm ?? "").toLowerCase().includes("morgan"), true);
});

test("PT parse: a random $ figure with NO price-target cue is NOT a PT", () => {
  assert.equal(parsePriceTargetFromText("The company reported $4.2 billion in quarterly revenue"), null);
});

test("PT parse: empty / no-target text → null", () => {
  assert.equal(parsePriceTargetFromText(""), null);
  assert.equal(parsePriceTargetFromText("Analyst commentary with no number at all"), null);
});

// ── Grounding PT reconciliation (±20%) ─────────────────────────────────────────

test("grounding: prose PT within ±20% of source PT is KEPT", () => {
  // source 100, claim 110 (10% off) → keep
  const out = stripPriceTargetClaims("Street price target of $110 ahead", 100);
  assert.equal(out.stripped, false);
  assert.ok(out.text.includes("110"));
});

test("grounding: prose PT outside ±20% of source PT is STRIPPED", () => {
  // source 100, claim 200 (100% off) → strip
  const out = stripPriceTargetClaims("analyst price target of $200", 100);
  assert.equal(out.stripped, true);
  assert.ok(out.text.includes("[price target unavailable]"));
});

test("grounding: NO source PT → any prose PT is STRIPPED", () => {
  const out = stripPriceTargetClaims("PT $150 per the desk", null);
  assert.equal(out.stripped, true);
  assert.ok(out.text.includes("[price target unavailable]"));
});

test("grounding: tolerance constant is 20%", () => {
  assert.equal(PRICE_TARGET_TOLERANCE_PCT, 0.2);
});

// ── computeFundamentalSignals (newest-first arrays) ────────────────────────────

function inc(over: Partial<PolygonIncomeStatement>): PolygonIncomeStatement {
  return {
    period_end: null,
    fiscal_year: null,
    fiscal_quarter: null,
    timeframe: "quarterly",
    revenue: null,
    cost_of_revenue: null,
    gross_profit: null,
    operating_income: null,
    net_income: null,
    basic_eps: null,
    diluted_eps: null,
    research_development: null,
    ebitda: null,
    basic_shares: null,
    diluted_shares: null,
    ...over,
  };
}

test("signals: quarterly revenue YoY uses the period 4 quarters back", () => {
  // newest-first: idx0 = latest, idx4 = same quarter last year
  const income: PolygonIncomeStatement[] = [
    inc({ revenue: 118, net_income: 20, gross_profit: 60, operating_income: 30, diluted_eps: 2.0, diluted_shares: 100, period_end: "2026-03-31" }),
    inc({ revenue: 115 }),
    inc({ revenue: 112 }),
    inc({ revenue: 110 }),
    inc({ revenue: 100 }), // a year ago
  ];
  const s = computeFundamentalSignals(income, [], []);
  assert.ok(s);
  assert.equal(Math.round(s!.revenue_yoy_pct ?? 0), 18); // (118-100)/100
  assert.equal(Math.round(s!.gross_margin_pct ?? 0), 51); // 60/118
  assert.equal(Math.round(s!.net_margin_pct ?? 0), 17);   // 20/118
});

test("signals: FCF = operating CF − |capex|; positive + rising", () => {
  const cf: PolygonCashFlowStatement[] = [
    { period_end: "2026-03-31", fiscal_year: 2026, timeframe: "quarterly", operating_cash_flow: 100, capex: -30, dividends: null, net_income: 50 },
    { period_end: "2025-12-31", fiscal_year: 2025, timeframe: "quarterly", operating_cash_flow: 80, capex: -30, dividends: null, net_income: 40 },
  ];
  const s = computeFundamentalSignals([inc({})], [], cf);
  assert.ok(s);
  assert.equal(s!.fcf, 70);             // 100 - 30
  assert.equal(s!.fcf_positive, true);
  assert.equal(s!.fcf_trend, "rising"); // 70 vs prior 50
});

test("signals: net cash when cash exceeds total debt; buyback on falling share count", () => {
  const balance: PolygonBalanceSheet[] = [
    {
      period_end: "2026-03-31",
      fiscal_year: 2026,
      timeframe: "quarterly",
      cash_and_equivalents: 500,
      debt_current: 50,
      long_term_debt: 100,
      total_assets: null,
      total_liabilities: null,
      total_equity: null,
      inventories: null,
      goodwill: null,
    },
  ];
  const income: PolygonIncomeStatement[] = [
    inc({ diluted_shares: 95 }),
    inc({ diluted_shares: 100 }), // prior had more shares → buyback
  ];
  const s = computeFundamentalSignals(income, balance, []);
  assert.ok(s);
  assert.equal(s!.total_debt, 150);
  assert.equal(s!.net_cash, 350);          // 500 - 150
  assert.equal(s!.net_cash_positive, true);
  assert.equal(s!.share_count_trend, "buyback");
});

test("signals: all-empty inputs → null", () => {
  assert.equal(computeFundamentalSignals([], [], []), null);
});

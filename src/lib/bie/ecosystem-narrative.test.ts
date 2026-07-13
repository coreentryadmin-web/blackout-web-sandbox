import { test } from "node:test";
import assert from "node:assert/strict";
import { formatEcosystemNarrative } from "@/lib/bie/ecosystem-narrative";
import type { EcosystemContext, EcosystemArsenal } from "@/lib/bie/ecosystem-context";

// The narrative is a pure formatter over EcosystemContext. These tests lock the #60 behavior: the
// arsenal (macro / earnings / breadth / short-interest / news / peers) is CITED in the narrative, so
// every composer that renders the ecosystem — not only the verdict — surfaces the Track-B color.

function ctx(over: Partial<EcosystemContext> = {}, arsenal?: Partial<EcosystemArsenal>): EcosystemContext {
  const baseArsenal: EcosystemArsenal = {
    scope: "single_name",
    earnings: null,
    fundamentals: null,
    related: null,
    news: null,
    macro: null,
    breadth: null,
    unavailable_sources: [],
    ...arsenal,
  };
  return {
    ticker: "NVDA",
    zerodte_today: null,
    nighthawk_recent: null,
    recent_audit_entries: [],
    recent_flow: null,
    flow_full_state: null,
    recent_anomalies: [],
    spx_play: null,
    spx_full_state: null,
    flow_feed_fresh: true,
    gex_positioning: null,
    vector_full_state: null,
    arsenal: baseArsenal,
    ...over,
  } as EcosystemContext;
}

test("narrative cites the single-name arsenal: earnings lead, short-interest + news + peers watch", () => {
  const md = formatEcosystemNarrative(
    ctx({ ticker: "NVDA" }, {
      scope: "single_name",
      earnings: { earnings_date: "2026-07-20", days_until: 3, report_time: "afterhours", is_confirmed: true },
      fundamentals: { days_to_cover: 6.4, short_volume_ratio: 0.41, price_target: null, as_of: "2026-07-10" },
      news: { count: 2, newest: "2026-07-12", headlines: ["NVDA guidance raised", "new GPU"] },
      related: ["AMD", "AVGO"],
    })
  );
  assert.match(md, /earnings 3d out/i);
  assert.match(md, /confirmed/i);
  assert.match(md, /days-to-cover 6\.4/i);
  assert.match(md, /recent news/i);
  assert.match(md, /peers AMD, AVGO/i);
});

test("narrative cites the index arsenal: macro + breadth in the lead", () => {
  const md = formatEcosystemNarrative(
    ctx({ ticker: "SPX" }, {
      scope: "index",
      macro: { yield_10_year: 4.2, curve_10y_1y_spread: -0.3, cpi: 3.1, as_of: "2026-07-11" },
      breadth: { tone: "risk_on", summary: "Market breadth: 62% advancing — risk on.", as_of: "2026-07-13" },
    })
  );
  assert.match(md, /10y 4\.2%/);
  assert.match(md, /10y-1y -0\.3 \(inverted\)/);
  assert.match(md, /CPI 3\.1/);
  assert.match(md, /risk on/i);
});

test("narrative surfaces requested-but-thin arsenal legs, never silently dropping them", () => {
  const md = formatEcosystemNarrative(
    ctx({ ticker: "SPX", gex_positioning: { gamma_posture: "long", flip: 5500 } as EcosystemContext["gex_positioning"] }, {
      scope: "index",
      unavailable_sources: [{ source: "macro backdrop", reason: "unavailable" }],
    })
  );
  assert.match(md, /Unavailable this turn: macro backdrop \(unavailable\)/i);
});

test("low days-to-cover is NOT flagged as squeeze fuel (only elevated SI is a watch item)", () => {
  const md = formatEcosystemNarrative(
    ctx({ ticker: "AAPL", nighthawk_recent: { edition_for: "2026-07-12", direction: "long", conviction: "high", outcome: "pending", score: 80 } }, {
      scope: "single_name",
      fundamentals: { days_to_cover: 1.2, short_volume_ratio: 0.2, price_target: null, as_of: "2026-07-10" },
    })
  );
  assert.doesNotMatch(md, /days-to-cover/i);
});

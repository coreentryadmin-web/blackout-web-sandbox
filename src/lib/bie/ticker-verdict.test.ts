import { before, test, mock } from "node:test";
import assert from "node:assert/strict";
import type { EcosystemContext, EcosystemArsenal } from "@/lib/bie/ecosystem-context";

// findSimilarPrecedents pulls @/lib/db + ./knowledge (embeddings) — irrelevant to this file's concern
// (does the verdict CITE ctx.arsenal). Mock it to [] so the test stays hermetic and precedentLine is
// simply absent. Registered before the dynamic import below, same ordering pattern the other BIE
// terminal tests use.
mock.module("./precedent-search", {
  namedExports: {
    findSimilarPrecedents: async () => [],
  },
});

let synthesizeTickerVerdict: typeof import("./ticker-verdict").synthesizeTickerVerdict;
let formatTickerVerdictMarkdown: typeof import("./ticker-verdict").formatTickerVerdictMarkdown;

before(async () => {
  ({ synthesizeTickerVerdict, formatTickerVerdictMarkdown } = await import("./ticker-verdict"));
});

function arsenal(over: Partial<EcosystemArsenal> = {}): EcosystemArsenal {
  return {
    scope: "single_name",
    earnings: null,
    fundamentals: null,
    related: null,
    news: null,
    macro: null,
    breadth: null,
    unavailable_sources: [],
    ...over,
  };
}

function ctx(over: Partial<EcosystemContext> = {}, ars?: Partial<EcosystemArsenal>): EcosystemContext {
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
    arsenal: arsenal(ars),
    ...over,
  } as EcosystemContext;
}

async function md(c: EcosystemContext, q: string): Promise<string> {
  return formatTickerVerdictMarkdown(await synthesizeTickerVerdict(c, q));
}

test("single-name verdict cites the arsenal: earnings countdown, squeeze-fuel SI, news, peers", async () => {
  const out = await md(
    ctx({ ticker: "NVDA" }, {
      scope: "single_name",
      earnings: { earnings_date: "2026-07-16", days_until: 3, report_time: "afterhours", is_confirmed: true },
      fundamentals: { days_to_cover: 6.4, short_volume_ratio: 0.41, price_target: null, as_of: "2026-07-10" },
      news: { count: 2, newest: "2026-07-12", headlines: ["NVDA guidance raised", "new GPU"] },
      related: ["AMD", "AVGO"],
    }),
    "should I hold NVDA into earnings"
  );
  // Earnings countdown surfaces as CONTEXT + drives the event-risk verdict line.
  assert.match(out, /earnings 3d out afterhours \(confirmed\)/);
  assert.match(out, /HIGH event-window risk/);
  // Elevated days-to-cover is an ALIGNMENT (squeeze) tell.
  assert.match(out, /days-to-cover 6\.4 \(squeeze fuel\)/);
  // News + peers cited.
  assert.match(out, /2 recent news \("NVDA guidance raised"\)/);
  assert.match(out, /peers AMD, AVGO/);
  // A hold-into-earnings question gets the binary-event friction.
  assert.match(out, /holding through the print is a binary event/);
});

test("index verdict cites macro + breadth (relevance-gated color)", async () => {
  const out = await md(
    ctx({ ticker: "SPX" }, {
      scope: "index",
      macro: { yield_10_year: 4.23, curve_10y_1y_spread: -0.31, cpi: 3.1, as_of: "2026-07-11" },
      breadth: { tone: "risk_on", summary: "Market breadth: 62% advancing — risk on.", as_of: "2026-07-13" },
    }),
    "what's the SPX verdict"
  );
  assert.match(out, /macro 10y 4\.23%, 10y-1y -0\.31 inverted, CPI 3\.1/);
  assert.match(out, /breadth risk on/);
});

test("honesty: requested-but-thin arsenal legs are surfaced in an UNAVAILABLE line, never fabricated", async () => {
  const out = await md(
    ctx({ ticker: "NVDA" }, {
      scope: "single_name",
      unavailable_sources: [
        { source: "earnings", reason: "no upcoming date" },
        { source: "fundamentals/short-interest", reason: "no data for ticker" },
      ],
    }),
    "is NVDA a good hold"
  );
  assert.match(out, /UNAVAILABLE  earnings \(no upcoming date\), fundamentals\/short-interest \(no data for ticker\)\./);
  // Nothing fabricated: no earnings/SI figures appear.
  assert.doesNotMatch(out, /days-to-cover/);
  assert.doesNotMatch(out, /\bearnings \d+d out/);
});

test("no arsenal data at all → no CONTEXT/UNAVAILABLE noise (never invents a section)", async () => {
  const out = await md(
    ctx({ ticker: "NVDA", nighthawk_recent: { edition_for: "2026-07-12", direction: "long", conviction: "A", outcome: "pending", score: 80 } }),
    "what's the NVDA read"
  );
  assert.doesNotMatch(out, /CONTEXT/);
  assert.doesNotMatch(out, /UNAVAILABLE/);
  // The base verdict still renders.
  assert.match(out, /desk verdict/);
  assert.match(out, /NIGHT HAWK LONG \(A\)/);
});

test("low (non-elevated) days-to-cover is stated as CONTEXT, not flagged as squeeze fuel", async () => {
  const out = await md(
    ctx({ ticker: "AAPL" }, {
      scope: "single_name",
      fundamentals: { days_to_cover: 1.3, short_volume_ratio: 0.2, price_target: null, as_of: "2026-07-10" },
    }),
    "AAPL verdict"
  );
  assert.match(out, /CONTEXT  days-to-cover 1\.3\./);
  assert.doesNotMatch(out, /squeeze fuel/);
});

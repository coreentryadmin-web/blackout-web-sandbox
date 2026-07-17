import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatHelixAnalyticsScopeLabel,
  isSingleTickerScope,
  showMarketWideAnalyticsPanels,
} from "@/features/helix/lib/helix-analytics-scope";

describe("helix-analytics-scope", () => {
  it("detects single-ticker scope", () => {
    assert.equal(isSingleTickerScope(""), false);
    assert.equal(isSingleTickerScope("  "), false);
    assert.equal(isSingleTickerScope("nvda"), true);
  });

  it("hides market-wide panels when scoped to one ticker", () => {
    assert.equal(showMarketWideAnalyticsPanels(""), true);
    assert.equal(showMarketWideAnalyticsPanels("SPY"), false);
  });

  it("formats scope label from active filters", () => {
    assert.equal(
      formatHelixAnalyticsScopeLabel({
        tickerFilter: "nvda",
        dteFilter: "0dte",
        typeFilter: "CALL",
        whalesOnly: false,
        indicesOnly: false,
        watchlistOnly: false,
      }),
      "NVDA · 0DTE · CALL"
    );
    assert.equal(
      formatHelixAnalyticsScopeLabel({
        tickerFilter: "",
        dteFilter: "all",
        typeFilter: "ALL",
        whalesOnly: true,
        indicesOnly: false,
        watchlistOnly: false,
      }),
      "Whales"
    );
    assert.equal(
      formatHelixAnalyticsScopeLabel({
        tickerFilter: "",
        dteFilter: "all",
        typeFilter: "ALL",
        whalesOnly: false,
        indicesOnly: false,
        watchlistOnly: false,
      }),
      "All flow"
    );
  });
});

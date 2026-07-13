import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  sanitizeProviderPath,
  isAllowedUwPath,
  isAllowedPolygonPath,
} from "@/lib/bie/provider-read-guard";

describe("provider-read-guard — SSRF / traversal / allowlist", () => {
  test("sanitizeProviderPath rejects absolute URLs, traversal, control chars", () => {
    assert.equal(sanitizeProviderPath("https://evil.example.com/x"), null);
    assert.equal(sanitizeProviderPath("//evil.example.com/x"), null);
    assert.equal(sanitizeProviderPath("/api/stock/../../etc/passwd"), null);
    assert.equal(sanitizeProviderPath("/api/x\nInjected"), null);
    assert.equal(sanitizeProviderPath("not-a-path"), null);
    assert.equal(sanitizeProviderPath(""), null);
    assert.equal(sanitizeProviderPath("/api/darkpool/NVDA"), "/api/darkpool/NVDA");
  });

  test("isAllowedUwPath allows read-data collections, denies the rest", () => {
    for (const p of [
      "/api/darkpool/NVDA",
      "/api/stock/NVDA/greek-exposure",
      "/api/option-trades/flow-alerts",
      "/api/market/tide",
      "/api/gex/SPY",
      "/api/congress/trades",
    ]) {
      assert.equal(isAllowedUwPath(p), true, `${p} should be allowed`);
    }
    for (const p of [
      "/api/admin/anything", // not a UW data collection
      "/api/auth/login",
      "https://evil/api/stock",
      "/api/stock/../secret",
      "/random/path",
    ]) {
      assert.equal(isAllowedUwPath(p), false, `${p} should be denied`);
    }
  });

  test("isAllowedPolygonPath allows versioned data namespaces, denies the rest", () => {
    for (const p of [
      "/v2/aggs/ticker/AAPL/range/1/day/2026-07-01/2026-07-10",
      "/v3/reference/tickers",
      "/v1/marketstatus/now",
      "/snapshot/locale/us/markets/stocks/tickers",
    ]) {
      assert.equal(isAllowedPolygonPath(p), true, `${p} should be allowed`);
    }
    for (const p of ["/api/market/quote", "https://evil/v2/aggs", "/etc/passwd", "/admin/v2"]) {
      assert.equal(isAllowedPolygonPath(p), false, `${p} should be denied`);
    }
  });
});

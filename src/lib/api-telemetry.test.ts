import { test } from "node:test";
import assert from "node:assert/strict";
import { endpointTemplate, recordApiCall, getApiTelemetrySnapshot } from "./api-telemetry";

// Locks the audit §3.1 fix: the endpointStats Map was UNBOUNDED because Polygon paths embed the
// ticker / OCC / date in the key, so every distinct symbol leaked a permanent entry. The fix
// templates the key (per-symbol → one bounded key) with an LRU cap backstop.

test("endpointTemplate: collapses OCC / ticker / index / date and strips the query", () => {
  // OCC option symbols (prefixed)
  assert.equal(
    endpointTemplate("/v3/snapshot/options/O:SPXW250101C05850000"),
    "/v3/snapshot/options/:occ"
  );
  // bare OCC (no O: prefix)
  assert.equal(endpointTemplate("/options/SPXW250101C05850000/quote"), "/options/:occ/quote");
  // ticker + ISO dates in an aggregates path
  assert.equal(
    endpointTemplate("/v2/aggs/ticker/AAPL/range/1/day/2024-01-01/2024-12-31"),
    "/v2/aggs/ticker/:sym/range/1/day/:date/:date"
  );
  // index symbol
  assert.equal(endpointTemplate("/v1/indicators/ema/I:SPX"), "/v1/indicators/ema/:idx");
  // the query string (the unified-snapshot ticker.any_of CSV is the worst leak source) is dropped
  assert.equal(
    endpointTemplate("/v3/snapshot?ticker.any_of=O:SPXW250101C05850000,O:SPXW250101P05850000&limit=250"),
    "/v3/snapshot"
  );
  // a non-symbol path is unchanged
  assert.equal(endpointTemplate("/v3/reference/tickers"), "/v3/reference/tickers");
});

test("endpointStats stays bounded — 600 distinct-ticker paths collapse to ONE templated key", () => {
  // Pre-fix, this loop would leave 600 permanent endpointStats rows (the leak).
  for (let i = 0; i < 600; i++) {
    recordApiCall({
      provider: "polygon",
      endpoint: `/v2/aggs/ticker/SYM${i}/range/1/day/2024-01-01/2024-12-31`,
      method: "GET",
      status: 200,
      ok: true,
      latency_ms: 10,
    });
  }
  const polyEndpoints = getApiTelemetrySnapshot(10 * 60_000).by_provider.polygon.endpoints;
  const templated = polyEndpoints.find(
    (e) => e.endpoint === "/v2/aggs/ticker/:sym/range/1/day/:date/:date"
  );
  assert.ok(templated, "expected the one templated aggs key");
  assert.equal(templated!.call_count, 600, "all 600 calls aggregate into the one templated key");
  assert.ok(
    polyEndpoints.length < 10,
    `polygon endpoint cardinality should stay small, got ${polyEndpoints.length}`
  );
});

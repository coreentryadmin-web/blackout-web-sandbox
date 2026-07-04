import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildRateQuotaHeadroom, deriveClusterCallsByProvider1m, PROVIDER_RATE_QUOTAS } from "./api-rate-quotas";

// Regression: the headroom panel used to be fed exclusively from this replica's own in-memory
// counter (getCallsByProvider1m()), which only ever sees calls THIS replica made. On a
// multi-replica deploy that reads ~1/REPLICA_COUNT of true usage and can show "ok" headroom
// right up to an actual cluster-wide rate-limit event. deriveClusterCallsByProvider1m() closes
// that gap by converting the cluster-wide 5m rollup into a per-minute-equivalent count.

describe("api-rate-quotas: deriveClusterCallsByProvider1m", () => {
  test("converts cluster 5m rollup into a per-minute-equivalent count", () => {
    const result = deriveClusterCallsByProvider1m(
      { unusual_whales: { calls_5m: 600, errors_5m: 0 }, polygon: { calls_5m: 50, errors_5m: 2 } },
      {}
    );
    assert.deepEqual(result, { unusual_whales: 120, polygon: 10 });
  });

  test("falls back to the local per-replica counts when cluster telemetry is unavailable", () => {
    const local = { unusual_whales: 3, polygon: 1 };
    assert.deepEqual(deriveClusterCallsByProvider1m(null, local), local);
    assert.deepEqual(deriveClusterCallsByProvider1m(undefined, local), local);
  });

  test("treats a missing calls_5m on an individual provider as zero", () => {
    const result = deriveClusterCallsByProvider1m(
      { anthropic: { calls_5m: 0, errors_5m: 0 } } as never,
      {}
    );
    assert.deepEqual(result, { anthropic: 0 });
  });
});

describe("api-rate-quotas: buildRateQuotaHeadroom", () => {
  test("computes pct/headroom/status per provider and sorts by pct desc", () => {
    const rows = buildRateQuotaHeadroom({ anthropic: 45, unusual_whales: 12, polygon: 0 });
    assert.equal(rows[0].provider, "anthropic");
    assert.equal(rows[0].pct, Math.round((45 / PROVIDER_RATE_QUOTAS.anthropic!.per_minute) * 100));
    assert.equal(rows[0].status, "critical");
    const polygonRow = rows.find((r) => r.provider === "polygon")!;
    assert.equal(polygonRow.used_1m, 0);
    assert.equal(polygonRow.headroom, PROVIDER_RATE_QUOTAS.polygon!.per_minute);
    assert.equal(polygonRow.status, "ok");
  });

  test("defaults an unlisted provider's usage to 0", () => {
    const rows = buildRateQuotaHeadroom({});
    for (const row of rows) {
      assert.equal(row.used_1m, 0);
      assert.equal(row.status, "ok");
    }
  });
});

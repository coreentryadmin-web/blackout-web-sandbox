import { test } from "node:test";
import assert from "node:assert/strict";
import { sumCleanupDeletes } from "./db-cleanup-sum";

test("sumCleanupDeletes sums numeric prune counts only", () => {
  assert.equal(
    sumCleanupDeletes({
      api_telemetry_events: 1238,
      flow_alerts: 0,
      cron_job_runs: 39,
    }),
    1277,
  );
});

test("sumCleanupDeletes ignores non-numeric metadata mixed into tables", () => {
  // Regression: BIE string fields were folded into Object.values before reduce, producing
  // total_deleted like "1277ok0 graded / 0 recs40 call patterns analyzed".
  const tables = {
    api_telemetry_events: 100,
    flow_alerts: 50,
  } as Record<string, number>;
  assert.equal(sumCleanupDeletes(tables), 150);
});

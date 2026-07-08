import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildUwClusterHealth,
  evaluatePolygonClusterOk,
  evaluateUwClusterOk,
} from "./socket-cluster-health";

test("evaluateUwClusterOk: follower is healthy when cluster heartbeat is fresh", () => {
  const uw = buildUwClusterHealth({
    is_leader: false,
    cluster_last_message_at: Date.now() - 5_000,
  });
  const result = evaluateUwClusterOk(uw, true);
  assert.equal(result.ok, true);
  assert.match(result.detail, /follower/);
});

test("evaluateUwClusterOk: follower fails when cluster heartbeat is stale", () => {
  const uw = buildUwClusterHealth({
    is_leader: false,
    cluster_last_message_at: Date.now() - 300_000,
  });
  const result = evaluateUwClusterOk(uw, true);
  assert.equal(result.ok, false);
});

test("evaluatePolygonClusterOk: off-hours always ok", () => {
  const result = evaluatePolygonClusterOk(
    {
      is_leader: false,
      cluster_spx_updated_at: null,
      cluster_spx_age_ms: null,
      cluster_live: false,
      detail: "no snapshot",
    },
    false
  );
  assert.equal(result.ok, true);
});

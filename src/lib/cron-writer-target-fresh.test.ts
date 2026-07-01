import assert from "node:assert/strict";
import test from "node:test";

import {
  FLOW_INGEST_ALT_SKIP_REASONS,
  isFlowIngestAlternateWriterSkip,
} from "./cron-writer-target-fresh";

test("isFlowIngestAlternateWriterSkip recognizes live alternate-writer skip reasons", () => {
  for (const reason of FLOW_INGEST_ALT_SKIP_REASONS) {
    assert.equal(isFlowIngestAlternateWriterSkip(reason), true);
  }
  assert.equal(isFlowIngestAlternateWriterSkip("locked"), false);
  assert.equal(isFlowIngestAlternateWriterSkip(null), false);
});

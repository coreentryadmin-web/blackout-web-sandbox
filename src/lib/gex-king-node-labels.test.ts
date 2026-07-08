import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GEX_KING_DUAL_LABEL,
  gexKingDualLabel,
} from "./gex-king-node-labels.ts";

test("gexKingDualLabel: no scope returns full dual label", () => {
  assert.equal(gexKingDualLabel(), GEX_KING_DUAL_LABEL);
});

test("gexKingDualLabel: scope suffix for near-term vs 0DTE views", () => {
  assert.equal(gexKingDualLabel("near-term"), `${GEX_KING_DUAL_LABEL} (near-term)`);
  assert.equal(gexKingDualLabel("0DTE"), `${GEX_KING_DUAL_LABEL} (0DTE)`);
});

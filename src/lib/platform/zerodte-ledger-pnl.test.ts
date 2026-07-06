import test from "node:test";
import assert from "node:assert/strict";
import { roundFloats } from "../round-floats";

function livePnlPct(entry: number | null, mark: number | null): number | null {
  if (entry == null || entry <= 0 || mark == null) return null;
  return Math.round(((mark - entry) / entry) * 10000) / 100;
}

test("ledger live_pnl_pct must be recomputed from rounded entry/mark (TSLA-class drift)", () => {
  const rounded = roundFloats({
    ledger: [{ entry_premium: 6.024, last_mark: 7.376, live_pnl_pct: 22.51 }],
  }) as { ledger: Array<{ entry_premium: number; last_mark: number; live_pnl_pct: number }> };
  const row = rounded.ledger[0]!;
  assert.equal(row.entry_premium, 6.02);
  assert.equal(row.last_mark, 7.38);
  const reconciled = livePnlPct(row.entry_premium, row.last_mark);
  assert.equal(reconciled, 22.59);
  assert.notEqual(row.live_pnl_pct, reconciled);
});

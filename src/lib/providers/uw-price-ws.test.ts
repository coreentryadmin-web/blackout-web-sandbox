import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePriceWsPayload } from "./unusual-whales";

test("normalizePriceWsPayload maps UW price ticks", () => {
  const rows = normalizePriceWsPayload({ ticker: "SPX", close: 6000.12, vol: 12345 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.ticker, "SPX");
  assert.equal(rows[0]?.price, 6000.12);
});

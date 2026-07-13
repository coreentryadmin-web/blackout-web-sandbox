import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseContractFills,
  parseContractIntraday,
  parseContractMeta,
  volumeProfileBidAskPct,
} from "./contract-drilldown-parse";

test("parseContractFills maps UW live shape", () => {
  const rows = parseContractFills([
    {
      size: 13,
      price: "22.00",
      premium: "28600.00",
      executed_at: "2026-07-10T20:53:02.839559Z",
      tags: ["mid_side", "floor"],
    },
  ]);
  assert.equal(rows[0].size, 13);
  assert.equal(rows[0].fill, 22);
  assert.equal(rows[0].premium, 28600);
});

test("parseContractIntraday sums volume sides", () => {
  const rows = parseContractIntraday([
    {
      start_time: "2026-07-10T19:53:00Z",
      volume_mid_side: 195,
      volume_ask_side: 0,
      volume_bid_side: 0,
      avg_price: "23.00",
      premium_mid_side: 448500,
    },
  ]);
  assert.equal(rows[0].volume, 195);
  assert.equal(rows[0].avg_price, 23);
  assert.equal(rows[0].premium, 448500);
});

test("volumeProfileBidAskPct from price levels", () => {
  const pct = volumeProfileBidAskPct([
    { ask_vol: 10, bid_vol: 40 },
    { ask_vol: 0, bid_vol: 60 },
  ]);
  assert.equal(pct, 90.9);
});

test("parseContractMeta reads OI from first fill", () => {
  const meta = parseContractMeta([{ open_interest: 23510, volume: 1337, implied_volatility: 0.24, delta: -0.06 }]);
  assert.equal(meta.open_interest, 23510);
  assert.equal(meta.day_volume, 1337);
});

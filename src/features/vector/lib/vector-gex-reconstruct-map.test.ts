import { test } from "node:test";
import assert from "node:assert/strict";
import {
  barsToSpotSamples,
  chainToReconstructContracts,
  reconstructStrikeBand,
  type AggBarLike,
} from "./vector-gex-reconstruct-map";
import type { ChainContract } from "@/lib/providers/polygon-options-gex";

const chain: ChainContract[] = [
  { details: { strike_price: 7600, contract_type: "call", expiration_date: "2026-07-13" }, open_interest: 8000, implied_volatility: 0.15 },
  { details: { strike_price: 7500, contract_type: "put", expiration_date: "2026-07-13" }, open_interest: 6000, implied_volatility: 0.16 },
  // dropped: zero OI
  { details: { strike_price: 7550, contract_type: "call", expiration_date: "2026-07-13" }, open_interest: 0, implied_volatility: 0.15 },
  // dropped: missing IV
  { details: { strike_price: 7450, contract_type: "put", expiration_date: "2026-07-13" }, open_interest: 9000 },
  // dropped: malformed expiry
  { details: { strike_price: 7480, contract_type: "call", expiration_date: "" }, open_interest: 500, implied_volatility: 0.2 },
  // dropped: unknown type
  { details: { strike_price: 7490, contract_type: "warrant", expiration_date: "2026-07-13" }, open_interest: 500, implied_volatility: 0.2 },
];

test("chainToReconstructContracts: keeps only rows with strike+expiry+type+OI+IV", () => {
  const out = chainToReconstructContracts(chain);
  assert.equal(out.length, 2, "only the two complete rows survive");
  assert.deepEqual(
    out.map((c) => c.strike).sort((a, b) => a - b),
    [7500, 7600]
  );
  const call = out.find((c) => c.type === "call")!;
  assert.equal(call.openInterest, 8000);
  assert.equal(call.iv, 0.15);
});

test("chainToReconstructContracts: empty/garbage in → empty out, never throws", () => {
  assert.deepEqual(chainToReconstructContracts([]), []);
  assert.deepEqual(chainToReconstructContracts([{} as ChainContract]), []);
});

test("barsToSpotSamples: ms→sec, buckets to cadence, last bar in bucket wins", () => {
  // Two 1-min bars inside the same 5-min bucket (09:30 and 09:34 ET-ish); the
  // later close represents the bucket. `t` is ms.
  const base = 1_752_000_000_000; // arbitrary ms
  const bars: AggBarLike[] = [
    { t: base, c: 7500 },
    { t: base + 60_000, c: 7502 },
    { t: base + 4 * 60_000, c: 7505 }, // still within the first 300s bucket
    { t: base + 6 * 60_000, c: 7510 }, // next bucket
  ];
  const out = barsToSpotSamples(bars, 300);
  assert.equal(out.length, 2, "two 5-min buckets");
  assert.equal(out[0]!.spot, 7505, "last close in the first bucket wins");
  assert.equal(out[1]!.spot, 7510);
  assert.ok(out[0]!.time < out[1]!.time && out[0]!.time % 300 === 0, "bucket times snap to the grid, ascending");
});

test("barsToSpotSamples: skips malformed rows, caps output length", () => {
  assert.deepEqual(barsToSpotSamples([{ t: NaN, c: 7500 }, { t: 1, c: 0 }], 300), []);
  // 400 distinct 1-min buckets, cap 128 → strided down but never over cap, ends at last.
  const many: AggBarLike[] = Array.from({ length: 400 }, (_, i) => ({ t: i * 60_000, c: 7500 + i }));
  const capped = barsToSpotSamples(many, 60, 128);
  assert.ok(capped.length > 0 && capped.length <= 128, "respects the cap");
  assert.equal(capped[capped.length - 1]!.spot, 7500 + 399, "keeps the true session close");
});

test("reconstructStrikeBand: pads the traveled range, null on no spot", () => {
  const band = reconstructStrikeBand([{ time: 1, spot: 7500 }, { time: 2, spot: 7550 }], 0.02);
  assert.ok(band && band.lo < 7500 && band.hi > 7550, "band straddles the traveled range with pad");
  assert.equal(reconstructStrikeBand([], 0.02), null);
  assert.equal(reconstructStrikeBand([{ time: 1, spot: 0 }], 0.02), null);
});

import { test } from "node:test";
import assert from "node:assert/strict";

// Locks the Massive UNIFIED-SNAPSHOT mapper + chunking + per-OCC cache reader for Night's
// Watch. The mapper must read the VERIFIED doc field paths, honor the MARK priority
// (last_quote.midpoint ?? mid(bid,ask) ?? last_trade.price), SKIP error/unfound rows, and
// NEVER fabricate a price. Chunking must split >250 OCCs into ≤250 batches. The cache
// reader must round-trip an in-mem snapshot and treat a missing OCC as null.
//
// Dynamic import inside each test (the module pulls in @/lib/* transitively); ensure no
// API key is set so fetchOptionsUnifiedSnapshot's not-configured path never hits network.
delete process.env.POLYGON_API_KEY;
delete process.env.MASSIVE_API_KEY;

// ----------------------------- mapper (doc-shaped fixture) -----------------------------

test("mapper: a full options result maps every field via the exact doc paths", async () => {
  const { mapUnifiedSnapshotResult } = await import("./options-snapshot");
  const r = {
    ticker: "O:SPXW250620C05850000",
    type: "options",
    name: "SPXW 5850 CALL",
    market_status: "open",
    break_even_price: 5860,
    implied_volatility: 0.21,
    open_interest: 1234,
    greeks: { delta: 0.55, gamma: 0.01, theta: -0.4, vega: 1.2 },
    // midpoint (10.3) is DELIBERATELY != mid(bid,ask) (10.2) to prove C2: the mapper ignores the
    // provider midpoint and uses computed mid — matching the chain ladder for the same bid/ask.
    last_quote: { bid: 10.0, ask: 10.4, bid_size: 5, ask_size: 7, midpoint: 10.3, last_updated: 1 },
    last_trade: { price: 10.1, size: 2, exchange: 1, conditions: [], timeframe: "REAL-TIME" },
    details: {
      strike_price: 5850,
      contract_type: "call",
      exercise_style: "european",
      expiration_date: "2025-06-20",
      underlying_ticker: "I:SPX",
    },
    underlying_asset: { price: 5872.5, ticker: "I:SPX", last_updated: 1 },
    session: { close: 9.85, open: 9.9, high: 10.5, low: 9.7, change: -0.05, change_percent: -0.5, volume: 4200 },
  };
  const snap = mapUnifiedSnapshotResult(r);
  assert.ok(snap);
  assert.equal(snap!.ticker, "O:SPXW250620C05850000");
  // MARK = mid(bid,ask) = (10.0+10.4)/2 = 10.2 — NOT the provider midpoint (10.3); matches the chain.
  assert.equal(snap!.mark, 10.2);
  assert.equal(snap!.bid, 10.0);
  assert.equal(snap!.ask, 10.4);
  assert.equal(snap!.last, 10.1);
  assert.equal(snap!.dayClose, 9.85);
  assert.equal(snap!.delta, 0.55);
  assert.equal(snap!.gamma, 0.01);
  assert.equal(snap!.theta, -0.4);
  assert.equal(snap!.vega, 1.2);
  assert.equal(snap!.iv, 0.21);
  assert.equal(snap!.openInterest, 1234);
  assert.equal(snap!.underlyingPrice, 5872.5);
  assert.equal(snap!.strike, 5850);
  assert.equal(snap!.optionType, "call");
  assert.equal(snap!.expiry, "2025-06-20");
});

test("mapper: an error/unfound row is SKIPPED (null) — never fabricated", async () => {
  const { mapUnifiedSnapshotResult } = await import("./options-snapshot");
  const r = {
    ticker: "O:SPXW250620C09999000",
    error: "NOT_FOUND",
    message: "Ticker not found.",
  };
  assert.equal(mapUnifiedSnapshotResult(r), null);
});

test("mapper: midpoint missing → falls back to mid(bid,ask)", async () => {
  const { mapUnifiedSnapshotResult } = await import("./options-snapshot");
  const r = {
    ticker: "O:AAPL250620C00200000",
    type: "options",
    last_quote: { bid: 3.0, ask: 3.4 }, // no midpoint
    details: { strike_price: 200, contract_type: "call", expiration_date: "2025-06-20" },
  };
  const snap = mapUnifiedSnapshotResult(r);
  assert.ok(snap);
  // mid of 3.0 / 3.4 = 3.2
  assert.equal(snap!.mark, 3.2);
});

test("mapper: no midpoint, no usable quote → last_trade.price", async () => {
  const { mapUnifiedSnapshotResult } = await import("./options-snapshot");
  const r = {
    ticker: "O:AAPL250620P00190000",
    type: "options",
    last_quote: { bid: 0, ask: 0 }, // ask 0 → not a real quote
    last_trade: { price: 1.75 },
    details: { strike_price: 190, contract_type: "put", expiration_date: "2025-06-20" },
  };
  const snap = mapUnifiedSnapshotResult(r);
  assert.ok(snap);
  assert.equal(snap!.mark, 1.75);
  assert.equal(snap!.optionType, "put");
});

test("mapper: no usable price anywhere → mark null (never fabricated), other fields kept", async () => {
  const { mapUnifiedSnapshotResult } = await import("./options-snapshot");
  const r = {
    ticker: "O:AAPL250620C00500000",
    type: "options",
    greeks: { delta: 0.05 },
    open_interest: 10,
    details: { strike_price: 500, contract_type: "call", expiration_date: "2025-06-20" },
  };
  const snap = mapUnifiedSnapshotResult(r);
  assert.ok(snap);
  assert.equal(snap!.mark, null);
  assert.equal(snap!.delta, 0.05);
  assert.equal(snap!.openInterest, 10);
});

// ----------------------------- chunking (>250) -----------------------------

test("chunkOccs splits >250 into ≤250 batches with no loss or overlap", async () => {
  const { chunkOccs, UNIFIED_SNAPSHOT_MAX_PER_CALL } = await import("./options-snapshot");
  assert.equal(UNIFIED_SNAPSHOT_MAX_PER_CALL, 250);

  const occs = Array.from({ length: 603 }, (_, i) => `O:T${i}`);
  const chunks = chunkOccs(occs, UNIFIED_SNAPSHOT_MAX_PER_CALL);
  assert.equal(chunks.length, 3); // 250 + 250 + 103
  assert.equal(chunks[0].length, 250);
  assert.equal(chunks[1].length, 250);
  assert.equal(chunks[2].length, 103);
  // every chunk respects the cap
  for (const c of chunks) assert.ok(c.length <= 250);
  // flatten == original (no loss, no dupes, order preserved)
  assert.deepEqual(chunks.flat(), occs);
});

test("chunkOccs: exact multiple of 250 yields full chunks only", async () => {
  const { chunkOccs } = await import("./options-snapshot");
  const occs = Array.from({ length: 500 }, (_, i) => `O:X${i}`);
  const chunks = chunkOccs(occs, 250);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].length, 250);
  assert.equal(chunks[1].length, 250);
});

test("fetchOptionsUnifiedSnapshot: empty/whitespace input → empty map (no upstream)", async () => {
  const { fetchOptionsUnifiedSnapshot } = await import("./options-snapshot");
  const empty = await fetchOptionsUnifiedSnapshot([]);
  assert.equal(empty.size, 0);
});

test("fetchOptionsUnifiedSnapshot: not configured (no key) → empty map, never throws", async () => {
  const { fetchOptionsUnifiedSnapshot } = await import("./options-snapshot");
  // No POLYGON_API_KEY set → polygonRawJson short-circuits to null → empty map.
  const out = await fetchOptionsUnifiedSnapshot(["O:SPXW250620C05850000", "O:SPXW250620C05850000"]);
  assert.equal(out.size, 0);
});

// ----------------------------- per-OCC cache reader -----------------------------

test("getOptionSnapshot: round-trips a warmed in-mem snapshot by OCC", async () => {
  const { setOptionSnapshots, getOptionSnapshot, _resetOptionSnapshotCacheForTest } =
    await import("./options-snapshot");
  _resetOptionSnapshotCacheForTest();

  const occ = "O:SPXW250620C05850000";
  const snap = {
    ticker: occ,
    mark: 10.2,
    bid: 10.0,
    ask: 10.4,
    last: 10.1,
    delta: 0.55,
    gamma: 0.01,
    theta: -0.4,
    vega: 1.2,
    iv: 0.21,
    openInterest: 1234,
    underlyingPrice: 5872.5,
    strike: 5850,
    optionType: "call" as const,
    expiry: "2025-06-20",
  };
  await setOptionSnapshots([snap]);

  const hit = await getOptionSnapshot(occ);
  assert.ok(hit);
  assert.equal(hit!.ticker, occ);
  assert.equal(hit!.mark, 10.2);
  assert.equal(hit!.delta, 0.55);
});

test("getOptionSnapshot: a missing OCC → null (caller falls back to the chain)", async () => {
  const { getOptionSnapshot, _resetOptionSnapshotCacheForTest } = await import("./options-snapshot");
  _resetOptionSnapshotCacheForTest();
  assert.equal(await getOptionSnapshot("O:NOPE000000C00000000"), null);
  assert.equal(await getOptionSnapshot(""), null);
});

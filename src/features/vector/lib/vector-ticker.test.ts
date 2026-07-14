import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeVectorTicker,
  isVectorTickerAllowed,
  vectorPolygonMinuteSymbol,
  isVectorIndexTicker,
  vectorHasWsOracle,
} from "./vector-ticker";

test("normalizeVectorTicker defaults and validates", () => {
  assert.equal(normalizeVectorTicker(null), "SPX");
  assert.equal(normalizeVectorTicker(" nvda "), "NVDA");
  assert.equal(normalizeVectorTicker("!!!"), "SPX");
});

test("vectorPolygonMinuteSymbol maps indices", () => {
  assert.equal(vectorPolygonMinuteSymbol("SPX"), "I:SPX");
  assert.equal(vectorPolygonMinuteSymbol("NVDA"), "NVDA");
});

test("oracle and index helpers", () => {
  assert.equal(isVectorIndexTicker("SPX"), true);
  assert.equal(isVectorIndexTicker("AAPL"), false);
  assert.equal(vectorHasWsOracle("SPX"), true);
  assert.equal(vectorHasWsOracle("NVDA"), false);
});

test("isVectorTickerAllowed: accepts any well-formed symbol (not just the preset universe)", () => {
  // Preset + arbitrary optionable symbols are all loadable now.
  for (const t of ["SPX", "AAPL", "MSTR", "SOFI", "BRK.B", "I:SPX", "spy"]) {
    assert.equal(isVectorTickerAllowed(t), true, `${t} should be allowed`);
  }
});

test("isVectorTickerAllowed: rejects junk/oversized/empty before it reaches providers", () => {
  for (const t of ["", "   ", "TOOLONGSYM", "A B", "<script>", "AA;DROP", null, undefined]) {
    assert.equal(isVectorTickerAllowed(t), false, `${JSON.stringify(t)} should be rejected`);
  }
});

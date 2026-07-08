import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeVectorTicker,
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

import assert from "node:assert/strict";
import test from "node:test";
import { parseRelatedCompanies } from "./polygon-related";

// /v1/related-companies/AAPL → results: [{ ticker }] (per scratchpad/polygon-arsenal.log)

test("parseRelatedCompanies: uppercases, de-dupes, excludes self, preserves order", () => {
  const r = parseRelatedCompanies("AAPL", [
    { ticker: "msft" },
    { ticker: "GOOG" },
    { ticker: "MSFT" }, // dup
    { ticker: "AAPL" }, // self
    { ticker: "NVDA" },
  ]);
  assert.deepEqual(r, { ticker: "AAPL", related: ["MSFT", "GOOG", "NVDA"] });
});

test("parseRelatedCompanies: keeps dotted tickers, drops junk/empty/non-string", () => {
  const r = parseRelatedCompanies("brk.a", [
    { ticker: "BRK.B" },
    { ticker: "" },
    { ticker: "TOOLONGSYM" }, // 8 chars → rejected
    { ticker: 123 as unknown as string },
    { ticker: "  jpm  " }, // trimmed
    {},
  ]);
  assert.deepEqual(r, { ticker: "BRK.A", related: ["BRK.B", "JPM"] });
});

test("parseRelatedCompanies: empty / null results → empty peer list (honest 'no peers')", () => {
  assert.deepEqual(parseRelatedCompanies("NVDA", []), { ticker: "NVDA", related: [] });
  assert.deepEqual(parseRelatedCompanies("NVDA", null), { ticker: "NVDA", related: [] });
  assert.deepEqual(parseRelatedCompanies("NVDA", undefined), { ticker: "NVDA", related: [] });
});

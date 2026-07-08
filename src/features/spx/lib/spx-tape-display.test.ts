import assert from "node:assert/strict";
import { test } from "node:test";
import { computeTapeSkew } from "./spx-tape-display";

test("computeTapeSkew: call dominance", () => {
  const r = computeTapeSkew([
    { kind: "flow", side: "call", premium: 200_000, label: "C 5500", time: "1", detail: "" },
    { kind: "flow", side: "call", premium: 150_000, label: "C 5510", time: "2", detail: "" },
    { kind: "flow", side: "put", premium: 50_000, label: "P 5490", time: "3", detail: "" },
  ]);
  assert.equal(r.skew, "call");
});

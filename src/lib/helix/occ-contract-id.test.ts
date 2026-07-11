import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOccContractId, contractLabel } from "./occ-contract-id";

test("buildOccContractId: equity call", () => {
  assert.equal(buildOccContractId("NVDA", "2026-06-22", "CALL", 110), "NVDA260622C00110000");
});

test("buildOccContractId: SPX maps to SPXW root", () => {
  assert.equal(buildOccContractId("SPX", "2026-07-11", "PUT", 5850), "SPXW260711P05850000");
});

test("contractLabel formats strike + side", () => {
  assert.match(contractLabel("NKE", 85, "PUT", "2026-08-15"), /NKE 85P/);
});

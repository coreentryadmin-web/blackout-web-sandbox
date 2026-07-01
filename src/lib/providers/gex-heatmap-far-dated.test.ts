import { test } from "node:test";
import assert from "node:assert/strict";
import {
  farDatedExpiriesToFetch,
  gexContractDedupeKey,
  type ChainContract,
} from "./polygon-options-gex";

test("farDatedExpiriesToFetch always schedules dedicated fetches (no partial-expiry skip)", () => {
  const targets = ["2026-08-21", "2026-09-18", "2026-10-16"];
  assert.deepEqual(farDatedExpiriesToFetch(targets), targets);
});

test("gexContractDedupeKey is stable per expiry/strike/side", () => {
  const c: ChainContract = {
    details: {
      strike_price: 720,
      expiration_date: "2026-09-18",
      contract_type: "call",
    },
    open_interest: 100,
  };
  assert.equal(gexContractDedupeKey(c, "2026-06-01"), "2026-09-18|720|call");
});

test("gexContractDedupeKey rejects expired or invalid contracts", () => {
  assert.equal(
    gexContractDedupeKey(
      { details: { strike_price: 720, expiration_date: "2026-01-01", contract_type: "call" } },
      "2026-06-01"
    ),
    null
  );
  assert.equal(gexContractDedupeKey({ details: {} }, "2026-06-01"), null);
});

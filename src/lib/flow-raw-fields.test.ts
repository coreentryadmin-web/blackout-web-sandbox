import test from "node:test";
import assert from "node:assert/strict";
import { extractChainFieldsFromRaw } from "./flow-raw-fields";

test("extractChainFieldsFromRaw: numeric strings from UW WS payloads", () => {
  const fields = extractChainFieldsFromRaw(
    {
      price: "4.25",
      ask_side_pct: "72",
      underlying_last: "590.24",
      open_interest: "12000",
      iv: "0.42",
      alert_rule: "RepeatedHitsSweep",
    },
    { strike: 600, option_type: "CALL" }
  );
  assert.equal(fields.fill_price, 4.25);
  assert.equal(fields.ask_pct, 72);
  assert.equal(fields.underlying_price, 590.24);
  assert.equal(fields.open_interest, 12000);
  assert.equal(fields.implied_volatility, 0.42);
  assert.equal(fields.alert_rule, "RepeatedHitsSweep");
  assert.ok(fields.otm_pct != null && fields.otm_pct > 0);
});

test("extractChainFieldsFromRaw: skips OTM for UNKNOWN side", () => {
  const fields = extractChainFieldsFromRaw(
    { underlying_price: 100, price: 1 },
    { strike: 105, option_type: "UNKNOWN" }
  );
  assert.equal(fields.otm_pct, undefined);
});

import test from "node:test";
import assert from "node:assert/strict";
import { formatSpxContractLabel, parseSpxContractLabel } from "./spx-play-contract-label";

test("parseSpxContractLabel: compact 7550C", () => {
  assert.deepEqual(parseSpxContractLabel("7550C"), { strike: 7550, side: "call" });
});

test("parseSpxContractLabel: OCC SPXW label uses strike after C/P (not expiry date)", () => {
  assert.deepEqual(parseSpxContractLabel("SPXW 260710 C6071"), { strike: 6071, side: "call" });
  assert.deepEqual(parseSpxContractLabel("SPXW 260710C6071"), { strike: 6071, side: "call" });
  assert.deepEqual(parseSpxContractLabel("SPXW 260710 P7450"), { strike: 7450, side: "put" });
});

test("formatSpxContractLabel: human Call/Put copy", () => {
  assert.equal(formatSpxContractLabel("7550C"), "7550 Call");
  assert.equal(formatSpxContractLabel("SPXW 260710 C6071"), "6071 Call");
  assert.equal(formatSpxContractLabel("7450P"), "7450 Put");
  assert.equal(formatSpxContractLabel(null, { strike: 7400, direction: "long" }), "7400 Call");
  assert.equal(formatSpxContractLabel(null, { strike: 7400, direction: "short" }), "7400 Put");
});

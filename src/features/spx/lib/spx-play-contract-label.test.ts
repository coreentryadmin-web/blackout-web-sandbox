import test from "node:test";
import assert from "node:assert/strict";
import {
  formatSpxContractChipLabel,
  formatSpxContractLabel,
  formatPremiumAt,
  parseSpxContractLabel,
} from "./spx-play-contract-label";

test("parseSpxContractLabel: compact 7550C", () => {
  assert.deepEqual(parseSpxContractLabel("7550C"), { strike: 7550, side: "call" });
});

test("parseSpxContractLabel: OCC SPXW label uses strike after C/P (not expiry date)", () => {
  assert.deepEqual(parseSpxContractLabel("SPXW 260710 C6071"), { strike: 6071, side: "call" });
  assert.deepEqual(parseSpxContractLabel("SPXW 260710C6071"), { strike: 6071, side: "call" });
  assert.deepEqual(parseSpxContractLabel("SPXW 260710 P7450"), { strike: 7450, side: "put" });
});

test("formatSpxContractChipLabel: compact strike + premium", () => {
  assert.equal(formatSpxContractChipLabel("7550C", undefined, "4-6"), "7550C @ 5.0");
  assert.equal(formatSpxContractChipLabel("SPXW 260710 C6071", undefined, "~$5.2"), "6071C @ 5.2");
});

test("formatPremiumAt: parses ranges and singles", () => {
  assert.equal(formatPremiumAt("4-6"), "5.0");
  assert.equal(formatPremiumAt("~$5.2"), "5.2");
});

test("formatSpxContractLabel: human Call/Put copy", () => {
  assert.equal(formatSpxContractLabel("7550C"), "7550 Call");
  assert.equal(formatSpxContractLabel("SPXW 260710 C6071"), "6071 Call");
  assert.equal(formatSpxContractLabel("7450P"), "7450 Put");
  assert.equal(formatSpxContractLabel(null, { strike: 7400, direction: "long" }), "7400 Call");
  assert.equal(formatSpxContractLabel(null, { strike: 7400, direction: "short" }), "7400 Put");
});

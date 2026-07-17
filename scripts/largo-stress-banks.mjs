/**
 * Merge all Largo stress banks into one deduped suite (~400+ questions).
 *
 * Banks:
 *   1 — adversarial / retail word salad (scripts/largo-stress-bank.mjs)
 *   2 — institutional pro-desk (scripts/largo-stress-bank-2.mjs)
 *   3 — deep terminal coverage (scripts/largo-stress-bank-3.mjs)
 */
import { STRESS_BANK as STRESS_BANK_1 } from "./largo-stress-bank.mjs";
import { STRESS_BANK_2 as STRESS_BANK_2_RAW } from "./largo-stress-bank-2.mjs";
import { STRESS_BANK_3 as STRESS_BANK_3_RAW } from "./largo-stress-bank-3.mjs";
import { STRESS_BANK_4_RAW } from "./largo-stress-bank-4.mjs";

/** Catalog banks — intent hints are advisory; bank 1 remains strict regression. */
const tagOptional = (bank) => bank.map((e) => ({ ...e, intentOptional: true }));

export const STRESS_BANK_2 = tagOptional(STRESS_BANK_2_RAW);
export const STRESS_BANK_3 = tagOptional(STRESS_BANK_3_RAW);
export const STRESS_BANK_4 = tagOptional(STRESS_BANK_4_RAW);

export { STRESS_BANK_1 };

const BANKS = {
  1: STRESS_BANK_1,
  2: STRESS_BANK_2,
  3: STRESS_BANK_3,
  4: STRESS_BANK_4,
};

/** @param {"1"|"2"|"3"|"all"|"1,2"|string} spec */
export function loadStressBank(spec = "all") {
  const normalized = String(spec).trim().toLowerCase();
  if (normalized === "all") {
    return mergeBanks([STRESS_BANK_1, STRESS_BANK_2, STRESS_BANK_3, STRESS_BANK_4]);
  }
  const parts = normalized.split(/[,+\s]+/).filter(Boolean);
  const selected = parts.map((p) => {
    const bank = BANKS[p];
    if (!bank) throw new Error(`Unknown LARGO_STRESS_BANK segment "${p}" — use 1, 2, 3, or all`);
    return bank;
  });
  return mergeBanks(selected);
}

function mergeBanks(arrays) {
  const seen = new Set();
  const out = [];
  for (const bank of arrays) {
    for (const entry of bank) {
      const key = entry.q.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(entry);
    }
  }
  return out;
}

export const STRESS_BANK_ALL = mergeBanks([STRESS_BANK_1, STRESS_BANK_2, STRESS_BANK_3, STRESS_BANK_4]);

export function bankStats() {
  return {
    bank1: STRESS_BANK_1.length,
    bank2: STRESS_BANK_2.length,
    bank3: STRESS_BANK_3.length,
    bank4: STRESS_BANK_4.length,
    merged: STRESS_BANK_ALL.length,
  };
}

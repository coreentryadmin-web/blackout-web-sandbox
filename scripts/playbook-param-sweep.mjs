#!/usr/bin/env node
/**
 * Playbook parameter stability bands — documents defaults and env overrides.
 * Does not optimize; reports configured values vs proposed OOS sensitivity bands.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function envNum(key, fallback) {
  const v = process.env[key];
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const BANDS = [
  { name: "wall_proximity_pts", env_key: "SPX_PLAY_STRUCTURE_PROX_PTS", default_value: 10, band_low: 8, band_high: 12 },
  { name: "mtf_buffer_pts", env_key: "SPX_PLAY_MTF_BUFFER_PTS", default_value: 1, band_low: 0.5, band_high: 2 },
  { name: "wall_stop_offset_pts", env_key: null, default_value: 3, band_low: 2, band_high: 4 },
  { name: "flow_materiality_min", env_key: "PLAYBOOK_FLOW_MATERIALITY_MIN", default_value: 100_000, band_low: 75_000, band_high: 150_000 },
  { name: "vwap_duration_min", env_key: null, default_value: 15, band_low: 12, band_high: 18 },
  { name: "gap_pct", env_key: null, default_value: 0.3, band_low: 0.25, band_high: 0.35 },
];

function inBand(value, band) {
  return value >= band.band_low && value <= band.band_high;
}

function main() {
  console.log("PLAYBOOK_PARAM_SWEEP (stability bands — no in-sample optimization)");
  console.log(`oos_start=${process.env.PLAYBOOK_OOS_START_DATE ?? "2026-07-10"}`);
  console.log(`train_cutoff=${process.env.PLAYBOOK_TRAIN_CUTOFF_DATE ?? "2026-07-07"}`);
  console.log("policy: edge must survive band perturbation; do not tune each constant on n=19");

  let allInBand = true;
  for (const band of BANDS) {
    const current = band.env_key ? envNum(band.env_key, band.default_value) : band.default_value;
    const ok = inBand(current, band);
    if (!ok) allInBand = false;
    console.log(
      JSON.stringify({
        name: band.name,
        current,
        band_low: band.band_low,
        band_high: band.band_high,
        within_band: ok,
        env_key: band.env_key,
      })
    );
  }

  try {
    const matcher = readFileSync(join(root, "src/features/spx/lib/playbook-shadow-matcher.ts"), "utf8");
    const has15mVwap = matcher.includes("minutes_below_vwap") && matcher.includes(">= 15");
    console.log(JSON.stringify({ check: "PB-01_vwap_15m_matcher", present: has15mVwap }));
  } catch {
    /* ignore */
  }

  console.log(allInBand ? "PASS: all configured params within stability bands" : "WARN: some params outside bands (review before promotion)");
  console.log(
    "note: bands are first local perturbation check — not cross-regime validation; see PLAYBOOK_NORMALIZED_PARAM_ROADMAP in playbook-evidence-config.ts"
  );
}

main();

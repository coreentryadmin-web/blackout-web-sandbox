// CORTEX SOURCE: Thermal sector/breadth heat — the room the ticker trades in.
// Design doc §1 "Thermal": a long whose sector row is deep red is fighting its
// peers; market internals say whether ANY long has tape support. Cheap, orthogonal,
// honest. "Lies when: idiosyncratic names (biotech FDA, single-stock news)
// legitimately decouple" → catalyst-tagged names are EXEMPT from the sector
// opposition (the decoupling is the thesis) — the exemption is visible, not silent.
//
// Single names read their sector ETF row; index/ETF tickers read market breadth
// tone (the same split ecosystem-context's arsenal applies — depth matches merit).

import type { CortexInputs, EvidenceItem } from "../types";
import { hasCatalystItem } from "./catalyst-news";
import { absentForMissingSlice, fmtNum } from "./shared";

/** Sector-ETF day move must be at least ±0.5% before it counts as directional room:
 *  sector ETFs oscillate a few tenths on an ordinary day; below half a percent the
 *  "room" is flat, not with or against anyone. */
export const SECTOR_ALIGN_MIN_PCT = 0.5;

/** Raw weight 0.5 — the small-signal tier (half the structural unit): the design
 *  values Thermal as cheap and ORTHOGONAL, a room reading, never a thesis. */
export const SECTOR_HEAT_WEIGHT = 0.5;

/** Per-source support cap — one alignment read is all this source ever says. */
export const SECTOR_HEAT_SUPPORT_CAP = 0.5;

/** Half-life 30 min: sector rotation moves on the half-hour scale, not the
 *  minute scale — twice the wall/flow half-lives, still expiring intraday. */
export const SECTOR_HEAT_HALF_LIFE_SEC = 30 * 60;

/** Breadth tones that constitute a directional room for index tickers. */
const BULLISH_TONES = new Set(["positive", "strongly_positive"]);
const BEARISH_TONES = new Set(["negative", "strongly_negative"]);

export function deriveSectorHeatEvidence(input: CortexInputs): EvidenceItem[] {
  const { sector, direction } = input;
  if (!sector) return [absentForMissingSlice("sector-heat", input, "no sector/breadth read")];

  const base = {
    source: "sector-heat" as const,
    halfLifeSec: SECTOR_HEAT_HALF_LIFE_SEC,
    asOf: sector.asOf,
  };

  // --- Index/ETF branch: market breadth tone is "the room" -------------------
  if (sector.breadthTone != null) {
    const tone = sector.breadthTone;
    if (tone === "unknown" || tone === "mixed") {
      return [absentForMissingSlice("sector-heat", input, `market breadth is ${tone} — no directional room to align with`)];
    }
    const roomIsBullish = BULLISH_TONES.has(tone);
    const roomIsBearish = BEARISH_TONES.has(tone);
    const aligned = (direction === "long" && roomIsBullish) || (direction === "short" && roomIsBearish);
    return [
      {
        ...base,
        stance: aligned ? "supports" : "opposes",
        weight: SECTOR_HEAT_WEIGHT,
        detail: `market breadth is ${tone.replace("_", " ")} — the tape ${aligned ? "supports" : "opposes"} a ${direction}.`,
      },
    ];
  }

  // --- Single-name branch: the sector ETF row --------------------------------
  if (sector.sectorChangePct == null || sector.sectorName == null) {
    return [absentForMissingSlice("sector-heat", input, "no sector row for the ticker")];
  }
  const chg = sector.sectorChangePct;
  if (Math.abs(chg) < SECTOR_ALIGN_MIN_PCT) {
    return [
      absentForMissingSlice(
        "sector-heat",
        input,
        `sector ${sector.sectorName} is flat (${fmtNum(chg)}%) — below the 0.5% alignment floor`
      ),
    ];
  }
  const sectorBullish = chg > 0;
  const aligned = (direction === "long" && sectorBullish) || (direction === "short" && !sectorBullish);

  if (!aligned && hasCatalystItem(input)) {
    // Catalyst exemption (design §1): a catalyst-tagged name legitimately decouples
    // from its sector — the opposition is SUPPRESSED, visibly, not silently dropped.
    return [
      absentForMissingSlice(
        "sector-heat",
        input,
        `sector ${sector.sectorName} ${fmtNum(chg)}% opposes the ${direction}, but a same-day catalyst ` +
          `exempts the name (the decoupling is the thesis)`
      ),
    ];
  }

  return [
    {
      ...base,
      stance: aligned ? "supports" : "opposes",
      weight: SECTOR_HEAT_WEIGHT,
      detail:
        `sector ${sector.sectorName} is ${fmtNum(chg)}% on the day` +
        (sector.tickerChangePct != null ? ` (${input.ticker} ${fmtNum(sector.tickerChangePct)}%)` : "") +
        ` — the room ${aligned ? "supports" : "opposes"} a ${direction}.`,
    },
  ];
}

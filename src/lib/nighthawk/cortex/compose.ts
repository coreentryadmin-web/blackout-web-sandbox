// NIGHT HAWK CORTEX — the evidence composer (design doc §0/§2).
//
// composeCortexEvidence(input) is PURE over a CortexInputs snapshot: no IO, no
// Date.now() — the clock arrives as input.now (threaded by fetch.ts / the caller),
// so any verdict is exactly reproducible from its persisted snapshot (the §3.1
// calibration loop depends on this). Structure:
//
//   1. every source module derives EvidenceItems from its slice (pure);
//   2. each item decays exponentially by its half-life from asOf vs now — stale
//      evidence self-silences, and beyond ABSENT_AFTER_HALF_LIVES it is demoted to
//      absent outright (§0 "evidence decay" / §3.4 "alpha that expires");
//   3. supports are capped PER SOURCE (§0 veto asymmetry: one loud bullish signal
//      can never buy an entry), vetoes are unbounded hard blocks, opposes carry
//      their named-constant weights (each already bounded at emission);
//   4. score = Σ(decayed, capped supports) − Σ(decayed opposes); vetoes ride
//      alongside — a vetoed play keeps its score for the calibration ledger, but
//      the gate stack blocks on vetoes.length > 0 regardless of score (§2 wiring).

import type {
  CortexConviction,
  CortexInputs,
  CortexSourceFn,
  CortexSourceId,
  CortexVerdict,
  EvidenceItem,
} from "./types";
import { CORTEX_SOURCES } from "./types";
import { deriveCatalystNewsEvidence, CATALYST_SUPPORT_CAP } from "./sources/catalyst-news";
import { deriveDarkPoolConfluenceEvidence, DARKPOOL_SUPPORT_CAP } from "./sources/darkpool-confluence";
import { deriveFlowQualityEvidence, FLOW_SUPPORT_CAP } from "./sources/flow-quality";
import { deriveGexWallsEvidence, GEX_WALLS_SUPPORT_CAP } from "./sources/gex-walls";
import { deriveSectorHeatEvidence, SECTOR_HEAT_SUPPORT_CAP } from "./sources/sector-heat";
import { deriveVexCharmEvidence, VEX_CHARM_SUPPORT_CAP } from "./sources/vex-charm";
import { deriveWallTrendEvidence, WALL_TREND_SUPPORT_CAP } from "./sources/wall-trend";

/** Evidence older than 3 half-lives is treated as ABSENT, not merely faint: at 3
 *  half-lives the decayed contribution is ≤12.5% of its raw weight — below that the
 *  honest statement is "this source cannot answer right now", and pretending a
 *  microscopic weight is an answer would hide recorder/reader outages from the
 *  verdict's absent list (§0 "stale evidence self-silences"). */
export const ABSENT_AFTER_HALF_LIVES = 3;

/** Score floor for conviction A: 2.0 ≈ the structural gex-walls unit (1.0) PLUS a
 *  fresh flagship wall-trend read (1.25) net of any opposition — an A requires the
 *  dealer landscape AND its lifecycle to both argue for the play, or equivalent
 *  breadth across the smaller sources. (Theoretical fresh max ≈ 5.3; realistic
 *  well-supported verdicts land 2–3.5.) Display never exceeds A — see conviction. */
export const CONVICTION_A_MIN_SCORE = 2;

/** Score floor for conviction B: 0.75 = one full mid-tier signal (an aligned flow
 *  cluster / catalyst leg) net of opposition — a real edge beyond noise, but not a
 *  structural argument. Below it the verdict is a C ("nothing here earns size"). */
export const CONVICTION_B_MIN_SCORE = 0.75;

/** Per-source SUPPORT caps (design §0 "supporting evidence is capped per source
 *  (max +N)"). Values are each source module's own exported cap constant — the cap
 *  lives next to the weights it bounds; this table only assembles them. Opposes are
 *  not additionally capped here: each oppose weight is already a bounded named
 *  constant at emission, and the design's asymmetry deliberately lets negative
 *  evidence accumulate (one loud bearish fact can kill an entry — §0). */
export const SOURCE_SUPPORT_CAPS: Record<CortexSourceId, number> = {
  "gex-walls": GEX_WALLS_SUPPORT_CAP,
  "wall-trend": WALL_TREND_SUPPORT_CAP,
  "flow-quality": FLOW_SUPPORT_CAP,
  "sector-heat": SECTOR_HEAT_SUPPORT_CAP,
  "catalyst-news": CATALYST_SUPPORT_CAP,
  "vex-charm": VEX_CHARM_SUPPORT_CAP,
  "darkpool-confluence": DARKPOOL_SUPPORT_CAP,
};

/** The source registry, in CORTEX_SOURCES order (deterministic evidence/narrative
 *  ordering — never a weighting statement). */
const SOURCE_REGISTRY: Record<CortexSourceId, CortexSourceFn> = {
  "gex-walls": deriveGexWallsEvidence,
  "wall-trend": deriveWallTrendEvidence,
  "flow-quality": deriveFlowQualityEvidence,
  "sector-heat": deriveSectorHeatEvidence,
  "catalyst-news": deriveCatalystNewsEvidence,
  "vex-charm": deriveVexCharmEvidence,
  "darkpool-confluence": deriveDarkPoolConfluenceEvidence,
};

/** Exponential half-life decay factor. Exported for the decay unit tests. */
export function cortexDecayFactor(ageSec: number, halfLifeSec: number): number {
  if (!(halfLifeSec > 0)) return 1; // undecayable evidence (defensive; sources always set > 0)
  return 2 ** (-Math.max(0, ageSec) / halfLifeSec);
}

function round(v: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

/** Signed score rendering for the narrative header ("+1.85" / "-0.6" / "0"). */
function fmtSigned(v: number): string {
  if (v > 0) return `+${v}`;
  return `${v}`;
}

export function composeCortexEvidence(input: CortexInputs): CortexVerdict {
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs)) {
    // A snapshot without a valid clock cannot be composed deterministically —
    // programmer error at the call site, never a silent "now = Date.now()" rescue.
    throw new TypeError(`composeCortexEvidence: invalid input.now "${input.now}"`);
  }

  const vetoes: EvidenceItem[] = [];
  const supports: EvidenceItem[] = [];
  const opposes: EvidenceItem[] = [];
  const absent: string[] = [];

  for (const source of CORTEX_SOURCES) {
    const items = SOURCE_REGISTRY[source](input);
    if (items.length === 0) {
      // Defensive: a source must always disclose — an empty return is an absence.
      absent.push(`${source}: no evidence emitted`);
      continue;
    }
    for (const item of items) {
      if (item.stance === "absent") {
        absent.push(`${source}: ${item.detail}`);
        continue;
      }
      const asOfMs = Date.parse(item.asOf);
      if (!Number.isFinite(asOfMs)) {
        // Unstamped evidence cannot decay honestly → it cannot participate (§0:
        // the composite is recomputed from live asOf stamps, never from trust).
        absent.push(`${source}: evidence had no valid asOf stamp`);
        continue;
      }
      const ageSec = Math.max(0, (nowMs - asOfMs) / 1000);
      if (ageSec > item.halfLifeSec * ABSENT_AFTER_HALF_LIVES) {
        absent.push(`${source}: evidence stale (older than ${ABSENT_AFTER_HALF_LIVES} half-lives) — self-silenced`);
        continue;
      }
      const effective = round(item.weight * cortexDecayFactor(ageSec, item.halfLifeSec), 3);
      const decayed: EvidenceItem = { ...item, weight: effective };
      if (item.stance === "veto") vetoes.push(decayed);
      else if (item.stance === "supports") supports.push(decayed);
      else opposes.push(decayed);
    }
  }

  // Per-source support caps (§0): if one source's decayed supports sum past its
  // cap, scale them proportionally so the table still shows every item, honestly
  // re-weighted, rather than silently dropping the overflow.
  const supportSumBySource = new Map<CortexSourceId, number>();
  for (const s of supports) {
    supportSumBySource.set(s.source, (supportSumBySource.get(s.source) ?? 0) + s.weight);
  }
  for (const [source, sum] of supportSumBySource) {
    const cap = SOURCE_SUPPORT_CAPS[source];
    if (sum > cap && sum > 0) {
      const scale = cap / sum;
      for (const s of supports) {
        if (s.source === source) s.weight = round(s.weight * scale, 3);
      }
    }
  }

  const supportTotal = supports.reduce((acc, s) => acc + s.weight, 0);
  const opposeTotal = opposes.reduce((acc, o) => acc + o.weight, 0);
  const score = round(supportTotal - opposeTotal, 2);

  // Conviction banding. A vetoed play wears a C no matter its score — a band is a
  // sizing statement and a blocked play must never read as size-worthy. Display is
  // capped at A while the A+ inversion stands (NIGHTHAWK-0DTE-DECISION.md C-1).
  let conviction: CortexConviction;
  if (vetoes.length > 0) conviction = "C";
  else if (score >= CONVICTION_A_MIN_SCORE) conviction = "A";
  else if (score >= CONVICTION_B_MIN_SCORE) conviction = "B";
  else conviction = "C";

  // Catalyst-confirmed flow upgrades conviction one band (design §1 BIE) — the only
  // support catalyst-news emits IS that upgrade signal. Never past A (C-1), never on
  // a vetoed play (a block is a block).
  const catalystConfirmed = supports.some((s) => s.source === "catalyst-news" && s.weight > 0);
  if (catalystConfirmed && vetoes.length === 0) {
    conviction = conviction === "C" ? "B" : "A";
  }

  // ---------------------------------------------------------------------------
  // Narrative — deterministic member-facing "why" lines. Every numeric token comes
  // from the evidence details (whose numbers trace to inputs — guarded by
  // narrative.guard.test.ts) or from the computed score/weights themselves.
  // ---------------------------------------------------------------------------
  const narrative: string[] = [];
  narrative.push(
    `CORTEX ${input.ticker} ${input.direction}: ` +
      (vetoes.length > 0
        ? `BLOCKED by ${vetoes.length} veto${vetoes.length === 1 ? "" : "es"} (net score ${fmtSigned(score)})`
        : `net score ${fmtSigned(score)}`) +
      `, conviction ${conviction}.`
  );
  for (const v of vetoes) narrative.push(`VETO [${v.source}] ${v.detail}`);
  for (const s of supports) narrative.push(`+${s.weight} [${s.source}] ${s.detail}`);
  for (const o of opposes) narrative.push(`-${o.weight} [${o.source}] ${o.detail}`);
  for (const a of absent) narrative.push(`ABSENT [${a.split(":")[0]}] ${a.slice(a.indexOf(":") + 1).trim()}`);

  return {
    ticker: input.ticker,
    direction: input.direction,
    asOf: new Date(nowMs).toISOString(),
    vetoes,
    score,
    supports,
    opposes,
    absent,
    conviction,
    narrative,
  };
}

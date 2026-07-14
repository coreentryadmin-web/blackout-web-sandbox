// NIGHT HAWK CORTEX — OVERNIGHT lens: the evidence composer (PR-N5).
//
// composeOvernightEvidence(input) is PURE over an OvernightInputs snapshot: no IO, no
// Date.now() — the clock arrives as input.now, so any verdict is exactly reproducible
// from its persisted snapshot (the §3.5 C-2 calibration substrate depends on this).
// Structure mirrors the intraday cortex (src/lib/nighthawk/cortex/compose.ts):
//
//   1. every source module derives OvernightEvidenceItems from its slice (pure);
//   2. supports are capped PER SOURCE (veto asymmetry: one loud bullish fact can never
//      buy a play), opposes carry their named-constant weights (each bounded at
//      emission), vetoes are UNBOUNDED hard blocks;
//   3. score = Σ(per-source-capped supports) − Σ(opposes); vetoes ride alongside — a
//      vetoed play keeps its score for the calibration ledger, but the verdict is VETO
//      regardless of score;
//   4. verdict:
//        - VETO   → any veto present. Candidate does NOT publish; the edition builder
//                   persists it as nighthawk_rejected (stage: "cortex_overnight_veto")
//                   for counterfactual grading (same philosophy as the #332 gates).
//        - WEAK   → no veto, but net score ≤ WEAK_MAX_SCORE. Publishes, FLAGGED and at
//                   lower conviction — "zero strong plays beats one weak one" (§4.1),
//                   but a WEAK still beats silence and stays gradeable.
//        - PASS   → no veto and net score > WEAK_MAX_SCORE. Publish at full conviction.
//   5. TOTAL OUTAGE (every source absent) → the lens ABSTAINS: verdict PASS,
//      abstained=true, flagged "no-overnight-evidence". A blind lens must not block the
//      whole book — the candidate rides on the publish gates alone (honesty rule).
//
// No exponential decay (unlike the intraday lens): this runs once, at a single publish
// instant, over same-evening data. Sources self-gate on data freshness instead.

import type {
  OvernightInputs,
  OvernightEvidenceItem,
  OvernightSourceFn,
  OvernightSourceId,
  OvernightVerdict,
  OvernightVerdictTag,
} from "./types";
import { OVERNIGHT_SOURCES } from "./types";
import { deriveCatalystVetoEvidence, CATALYST_VETO_SUPPORT_CAP } from "./sources/catalyst-veto";
import { deriveWallMigrationEvidence, WALL_MIGRATION_SUPPORT_CAP } from "./sources/wall-migration";
import { deriveDarkPoolTrendEvidence, DARKPOOL_TREND_SUPPORT_CAP } from "./sources/darkpool-trend";
import { deriveIvTermEvidence, IV_TERM_SUPPORT_CAP } from "./sources/iv-term";
import { deriveSectorBreadthEvidence, SECTOR_BREADTH_SUPPORT_CAP } from "./sources/sector-breadth";
import { deriveFlowPersistenceEvidence, FLOW_PERSISTENCE_SUPPORT_CAP } from "./sources/flow-persistence";

/** Net score AT OR BELOW which a non-vetoed play is WEAK (publishes flagged / lower
 *  conviction). 0 = a play whose overnight sources net NON-POSITIVE has no structural
 *  tailwind for the hold — the precision-first stance of §4.1 ("zero strong plays
 *  beats one weak one"). A lone oppose (e.g. a smart-money fade) with no supports lands
 *  here; a clean name with a small aligned support clears it to PASS. */
export const WEAK_MAX_SCORE = 0;

/** Per-source SUPPORT caps — each source module's own exported cap. Opposes are not
 *  additionally capped (each oppose weight is already a bounded named constant, and the
 *  asymmetry deliberately lets negative evidence accumulate toward WEAK). */
export const OVERNIGHT_SUPPORT_CAPS: Record<OvernightSourceId, number> = {
  "catalyst-veto": CATALYST_VETO_SUPPORT_CAP,
  "wall-migration": WALL_MIGRATION_SUPPORT_CAP,
  "darkpool-trend": DARKPOOL_TREND_SUPPORT_CAP,
  "iv-term": IV_TERM_SUPPORT_CAP,
  "sector-breadth": SECTOR_BREADTH_SUPPORT_CAP,
  "flow-persistence": FLOW_PERSISTENCE_SUPPORT_CAP,
};

/** The source registry, in OVERNIGHT_SOURCES order (deterministic ordering only). */
const SOURCE_REGISTRY: Record<OvernightSourceId, OvernightSourceFn> = {
  "catalyst-veto": deriveCatalystVetoEvidence,
  "wall-migration": deriveWallMigrationEvidence,
  "darkpool-trend": deriveDarkPoolTrendEvidence,
  "iv-term": deriveIvTermEvidence,
  "sector-breadth": deriveSectorBreadthEvidence,
  "flow-persistence": deriveFlowPersistenceEvidence,
};

function round(v: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

function fmtSigned(v: number): string {
  return v > 0 ? `+${v}` : `${v}`;
}

export function composeOvernightEvidence(input: OvernightInputs): OvernightVerdict {
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs)) {
    // A snapshot without a valid clock cannot be composed deterministically —
    // programmer error at the call site, never a silent "now = Date.now()" rescue.
    throw new TypeError(`composeOvernightEvidence: invalid input.now "${input.now}"`);
  }

  const vetoes: OvernightEvidenceItem[] = [];
  const supports: OvernightEvidenceItem[] = [];
  const opposes: OvernightEvidenceItem[] = [];
  const absent: string[] = [];

  for (const source of OVERNIGHT_SOURCES) {
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
      if (item.stance === "veto") vetoes.push(item);
      else if (item.stance === "supports") supports.push(item);
      else opposes.push(item);
    }
  }

  // Per-source support caps: if one source's supports sum past its cap, scale them
  // proportionally so the evidence table still shows every item, honestly re-weighted,
  // rather than silently dropping the overflow.
  const supportSumBySource = new Map<OvernightSourceId, number>();
  for (const s of supports) {
    supportSumBySource.set(s.source, (supportSumBySource.get(s.source) ?? 0) + s.weight);
  }
  for (const [source, sum] of supportSumBySource) {
    const cap = OVERNIGHT_SUPPORT_CAPS[source];
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

  // Total-outage abstain: every source came back absent — the lens is blind, and a
  // blind lens must never block the whole book. The candidate rides on the publish
  // gates alone, flagged so the debrief/UI can see the lens abstained.
  const abstained = vetoes.length === 0 && supports.length === 0 && opposes.length === 0;

  const flags: string[] = [];
  let verdict: OvernightVerdictTag;
  if (vetoes.length > 0) {
    verdict = "VETO";
    flags.push("catalyst-veto"); // the dominant veto class; individual reasons in narrative/vetoes[]
  } else if (abstained) {
    verdict = "PASS";
    flags.push("no-overnight-evidence");
  } else if (score <= WEAK_MAX_SCORE) {
    verdict = "WEAK";
    flags.push("weak-overnight-evidence");
  } else {
    verdict = "PASS";
  }

  // ---------------------------------------------------------------------------
  // Narrative — deterministic member/debrief-facing "why" lines. Every numeric token
  // comes from the evidence details (whose numbers trace to inputs) or the score/weights.
  // ---------------------------------------------------------------------------
  const narrative: string[] = [];
  narrative.push(
    `CORTEX-OVERNIGHT ${input.ticker} ${input.direction} (horizon ${input.horizonDate}): ` +
      (verdict === "VETO"
        ? `VETO — ${vetoes.length} block${vetoes.length === 1 ? "" : "s"} (net score ${fmtSigned(score)})`
        : verdict === "WEAK"
          ? `WEAK — net score ${fmtSigned(score)} ≤ ${WEAK_MAX_SCORE}, publishes flagged`
          : abstained
            ? "PASS (abstained — no overnight evidence; rides the publish gates alone)"
            : `PASS — net score ${fmtSigned(score)}`) +
      "."
  );
  for (const v of vetoes) narrative.push(`VETO [${v.source}] ${v.detail}`);
  for (const s of supports) narrative.push(`+${s.weight} [${s.source}] ${s.detail}`);
  for (const o of opposes) narrative.push(`-${o.weight} [${o.source}] ${o.detail}`);
  for (const a of absent) narrative.push(`ABSENT [${a.split(":")[0]}] ${a.slice(a.indexOf(":") + 1).trim()}`);

  return {
    ticker: input.ticker,
    direction: input.direction,
    asOf: new Date(nowMs).toISOString(),
    horizonDate: input.horizonDate,
    verdict,
    abstained,
    score,
    vetoes,
    supports,
    opposes,
    absent,
    flags,
    narrative,
  };
}

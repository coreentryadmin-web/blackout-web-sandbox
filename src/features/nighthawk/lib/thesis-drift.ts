// NIGHT HAWK — binding 9:15 thesis-drift detection (PR-N6 of
// docs/audit/NIGHTHAWK-OVERNIGHT-DECISION.md).
//
// WHY THIS EXISTS. The morning-confirm cron grades a play's PRICE geometry (gap vs
// direction, stop/target, wall drift) and marks CONFIRMED/DEGRADED/INVALIDATED. But the
// overnight THESIS — the cortex-overnight evidence that JUSTIFIED publishing — was never
// re-evaluated against the morning's actual state. A play could keep a green price badge
// while the exact structural premise that carried it (the regime line held, dark-pool was
// accumulating) had quietly inverted overnight. N6 adds thesis-drift as a SECOND,
// INDEPENDENT axis: per pinned evidence source, did its premise HOLD, WEAKEN, or FLIP by
// morning? A FLIPPED CORE source (the one that carried the publish) invalidates the thesis
// regardless of price; a WEAKENED MAJORITY degrades it.
//
// ONE-WAY, matching the repo's latch philosophy: thesis-drift can only DEGRADE/INVALIDATE,
// never upgrade. It never touches the existing price verdict — the cron composes the worse
// of the two axes.
//
// SHARED SUBSTRATE (deliberate). The premises are re-checked through the SAME serializable
// invalidator specs N7 pins (publish_context.invalidators), interpreted by
// evaluateInvalidators. That is intentional: "the falsifier the desk pre-declared" and "the
// premise the drift check measures" must be the SAME object, or the two would drift apart.
// A pre-N7 play with no pinned invalidators degrades gracefully to HELD (no evidence to
// flip on) — safe, because the axis is one-way and never worsens without positive evidence.
//
// Pure module: no IO, no Date.now().

import type { OvernightSourceId } from "./cortex-overnight";
import type { PlayConfirmStatus } from "./morning-confirm-verdict";
import {
  evaluateInvalidators,
  coerceInvalidators,
  type Invalidator,
  type InvalidatorEvaluation,
  type MarketSnapshot,
} from "./invalidators";

/** The published stance of a source in the pinned cortex verdict. (`veto` never appears on
 *  a PUBLISHED play — a vetoed play does not publish — but is included for completeness.) */
export type PublishedStance = "supports" | "opposes" | "veto" | "absent";

/** How a source's premise moved from publish to morning. */
export type DriftKind = "held" | "weakened" | "flipped";

/** The morning re-read outcome of one pinned evidence source. `morning` is `unknown` when
 *  the surface could not be re-read this morning (honest — never counted as drift). */
export type SourceDrift = {
  source: OvernightSourceId;
  published: PublishedStance;
  morning: PublishedStance | "unknown";
  drift: DriftKind;
  /** Signed numeric distance where computable (e.g. morning spot − pinned flip level for
   *  wall-migration); null when the source has no natural scalar. */
  delta: number | null;
  /** Present only when the source was NOT re-readable this morning. */
  note?: string;
};

/** Aggregate thesis verdict across all pinned sources. Maps to the price-status axis in the
 *  cron: WEAKENED→DEGRADED, INVALIDATED→INVALIDATED (see overnightAxisStatus). */
export type ThesisVerdict = "HELD" | "WEAKENED" | "INVALIDATED";

export type ThesisDriftResult = {
  perSource: SourceDrift[];
  thesisVerdict: ThesisVerdict;
  /** The source that carried the publish (largest summed support weight); null when the
   *  pinned verdict had no supports (e.g. an abstained lens). A FLIP here → INVALIDATED. */
  coreSource: OvernightSourceId | null;
  reason: string;
};

/** The slice of publish_context this checker reads. Everything optional/loose because it is
 *  a JSONB blob that may predate N5/N7 (old cached rows must not throw). */
export type PublishedThesisContext = {
  cortex_overnight?: {
    direction?: string;
    supports?: Array<{ source?: string; weight?: number }>;
    opposes?: Array<{ source?: string; weight?: number }>;
    absent?: string[];
  } | null;
  invalidators?: unknown;
} | null | undefined;

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/** Extract per-source published stance + summed support weight from the pinned verdict. */
function publishedStances(ctx: PublishedThesisContext): {
  stanceBySource: Map<OvernightSourceId, PublishedStance>;
  supportWeightBySource: Map<OvernightSourceId, number>;
} {
  const stanceBySource = new Map<OvernightSourceId, PublishedStance>();
  const supportWeightBySource = new Map<OvernightSourceId, number>();
  const cortex = ctx?.cortex_overnight ?? null;
  if (!cortex) return { stanceBySource, supportWeightBySource };

  for (const s of cortex.supports ?? []) {
    if (!s?.source) continue;
    const src = s.source as OvernightSourceId;
    stanceBySource.set(src, "supports");
    const w = typeof s.weight === "number" && Number.isFinite(s.weight) ? s.weight : 0;
    supportWeightBySource.set(src, (supportWeightBySource.get(src) ?? 0) + w);
  }
  for (const o of cortex.opposes ?? []) {
    if (!o?.source) continue;
    const src = o.source as OvernightSourceId;
    // A source can only be one published stance; supports win (it carried the play).
    if (!stanceBySource.has(src)) stanceBySource.set(src, "opposes");
  }
  return { stanceBySource, supportWeightBySource };
}

/** The pinned flip level for a source's flip_break invalidator, for the `delta` scalar. */
function flipLevelForSource(invs: Invalidator[], source: OvernightSourceId): number | null {
  const flip = invs.find(
    (i) => i.source === source && (i.check.kind === "lt" || i.check.kind === "gt") && i.check.metric === "spot"
  );
  if (flip && (flip.check.kind === "lt" || flip.check.kind === "gt")) return flip.check.level;
  return null;
}

/**
 * Compare each pinned overnight evidence source's premise against the morning re-read of
 * that same surface. Pure. The comparison runs through the pinned invalidator specs (N7):
 *  - a fired KILL invalidator for a source ⇒ that source FLIPPED (premise broken);
 *  - a fired DEGRADE invalidator ⇒ WEAKENED;
 *  - all of the source's invalidators evaluable and none fired ⇒ HELD;
 *  - the source has no evaluable invalidator this morning ⇒ HELD, `morning:"unknown"`,
 *    noted "not re-read" (honest: we assert no drift we could not measure).
 *
 * Aggregate: a FLIPPED core source ⇒ INVALIDATED; else if a majority of the RE-READABLE
 * sources weakened-or-flipped ⇒ WEAKENED; else HELD.
 */
export function detectThesisDrift(
  publishedContext: PublishedThesisContext,
  morningState: MarketSnapshot
): ThesisDriftResult {
  const { stanceBySource, supportWeightBySource } = publishedStances(publishedContext);
  const invalidators = coerceInvalidators(publishedContext?.invalidators);
  const evals = evaluateInvalidators(invalidators, morningState);

  // Group the morning evaluations by the source whose premise they falsify.
  const evalsBySource = new Map<OvernightSourceId, InvalidatorEvaluation[]>();
  for (const e of evals) {
    const src = e.invalidator.source;
    const arr = evalsBySource.get(src) ?? [];
    arr.push(e);
    evalsBySource.set(src, arr);
  }

  // Every source we have EITHER a published stance for OR a pinned invalidator for.
  const sources = new Set<OvernightSourceId>([
    ...stanceBySource.keys(),
    ...evalsBySource.keys(),
  ]);

  const perSource: SourceDrift[] = [];
  for (const source of sources) {
    const published = stanceBySource.get(source) ?? "absent";
    const srcEvals = evalsBySource.get(source) ?? [];
    const firedKill = srcEvals.some((e) => e.fired && e.invalidator.severity === "kill");
    const firedDegrade = srcEvals.some((e) => e.fired && e.invalidator.severity === "degrade");
    const anyEvaluable = srcEvals.some((e) => e.evaluable);

    let drift: DriftKind;
    let morning: PublishedStance | "unknown";
    let note: string | undefined;
    if (firedKill) {
      drift = "flipped";
      morning = "opposes";
    } else if (firedDegrade) {
      drift = "weakened";
      morning = published; // still nominally the same side, but the premise softened
    } else if (anyEvaluable) {
      drift = "held";
      morning = published;
    } else {
      drift = "held";
      morning = "unknown";
      note = "not re-read this morning";
    }

    // `delta`: for wall-migration, the signed distance of morning spot past the pinned flip
    // — the calibration scalar for how far the regime line was breached (or held).
    let delta: number | null = null;
    const flip = flipLevelForSource(invalidators, source);
    if (flip != null && morningState.spot != null && Number.isFinite(morningState.spot)) {
      delta = round4(morningState.spot - flip);
    }

    perSource.push(note ? { source, published, morning, drift, delta, note } : { source, published, morning, drift, delta });
  }

  // Core source = largest summed support weight (the one that carried the publish).
  let coreSource: OvernightSourceId | null = null;
  let coreWeight = -Infinity;
  for (const [src, w] of supportWeightBySource) {
    if (w > coreWeight) {
      coreWeight = w;
      coreSource = src;
    }
  }

  const coreDrift = coreSource ? perSource.find((d) => d.source === coreSource)?.drift : undefined;
  const reReadable = perSource.filter((d) => d.morning !== "unknown");
  const worsened = reReadable.filter((d) => d.drift === "weakened" || d.drift === "flipped");

  let thesisVerdict: ThesisVerdict;
  if (coreDrift === "flipped") {
    thesisVerdict = "INVALIDATED";
  } else if (reReadable.length > 0 && worsened.length * 2 >= reReadable.length && worsened.length > 0) {
    // A majority (≥ half) of the RE-READABLE sources drifted against the play.
    thesisVerdict = "WEAKENED";
  } else {
    thesisVerdict = "HELD";
  }

  const reason = buildReason(thesisVerdict, coreSource, coreDrift, worsened, reReadable);
  return { perSource, thesisVerdict, coreSource, reason };
}

function buildReason(
  verdict: ThesisVerdict,
  coreSource: OvernightSourceId | null,
  coreDrift: DriftKind | undefined,
  worsened: SourceDrift[],
  reReadable: SourceDrift[]
): string {
  if (verdict === "INVALIDATED") {
    return `Overnight thesis INVALIDATED — core source ${coreSource} flipped against the play by morning.`;
  }
  if (verdict === "WEAKENED") {
    const names = worsened.map((d) => `${d.source}:${d.drift}`).join(", ");
    return `Overnight thesis WEAKENED — ${worsened.length}/${reReadable.length} re-read sources drifted (${names}).`;
  }
  if (reReadable.length === 0) {
    return "Overnight thesis HELD (no source re-readable this morning — no drift asserted).";
  }
  return `Overnight thesis HELD — all ${reReadable.length} re-read source(s) intact.`;
}

// ---------------------------------------------------------------------------
// Axis composition — the overnight axes' contribution to the morning grade
// ---------------------------------------------------------------------------

/**
 * Collapse the two overnight axes (N6 thesis-drift + N7 fired invalidators) into the status
 * they IMPLY, or null when neither worsens the grade. ONE-WAY by construction — this only
 * ever returns DEGRADED/INVALIDATED (or null), so the cron's `worsenPlayStatus` can compose
 * it with the price verdict without ever upgrading.
 *
 *   - thesis INVALIDATED, or ANY fired KILL invalidator  → INVALIDATED
 *   - thesis WEAKENED, or ANY fired DEGRADE invalidator  → DEGRADED
 *   - otherwise                                          → null (no downgrade)
 */
export function overnightAxisStatus(
  thesisVerdict: ThesisVerdict,
  firedEvals: InvalidatorEvaluation[]
): { status: PlayConfirmStatus | null; reasons: string[] } {
  const reasons: string[] = [];
  const firedKill = firedEvals.filter((e) => e.fired && e.invalidator.severity === "kill");
  const firedDegrade = firedEvals.filter((e) => e.fired && e.invalidator.severity === "degrade");

  let status: PlayConfirmStatus | null = null;
  if (thesisVerdict === "INVALIDATED" || firedKill.length > 0) {
    status = "INVALIDATED";
  } else if (thesisVerdict === "WEAKENED" || firedDegrade.length > 0) {
    status = "DEGRADED";
  }

  for (const e of firedKill) reasons.push(`invalidator ${e.invalidator.id} fired (kill): ${e.invalidator.describe}`);
  for (const e of firedDegrade) reasons.push(`invalidator ${e.invalidator.id} fired (degrade): ${e.invalidator.describe}`);
  return { status, reasons };
}

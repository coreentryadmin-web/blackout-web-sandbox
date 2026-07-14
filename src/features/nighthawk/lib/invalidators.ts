// NIGHT HAWK — pre-declared invalidators + adversarial kill-test (PR-N7 of
// docs/audit/NIGHTHAWK-OVERNIGHT-DECISION.md — the "falsify the thesis before you
// publish it" increment).
//
// WHY THIS EXISTS. The 9:15 morning re-check (nighthawk-morning-confirm) grades an
// overnight play against the morning tape. Before N7 that grade was POST-HOC: the cron
// re-derived "is this still good?" from whatever it happened to look at, so a play could
// be quietly failed (or passed) on a rule invented after the fact. N7 makes the grade
// OBJECTIVE by forcing every play to carry its OWN falsifiers, PINNED at publish and
// immutable afterwards (publish_context.invalidators, COALESCE first-write-wins) — so the
// morning check can only run the conditions the desk pre-committed to, never a
// convenient new one. This is the same "pin the evidence, grade against the pin" discipline
// the publish-context (PR-N4) and cortex-overnight (PR-N5) lenses already use.
//
// THREE PIECES, all PURE (no IO, no Date.now()):
//   - deriveInvalidators   — at PUBLISH, emit 2–4 machine-checkable falsifiers per play,
//                            derived from the SAME overnight evidence surfaces that
//                            justified the play (flip / opposing wall / dark-pool trend).
//   - evaluateInvalidators — at MORNING, run the pinned predicate SPECS (serializable
//                            data, never closures) against the morning state.
//   - killTestPlay         — at PUBLISH, veto a play already sitting ON its own kill line
//                            (best-plays-only: a play 0.15% from a kill level is not a
//                            strong play, it is a coin flip pretending to be a setup).
//
// SERIALIZABLE PREDICATE SPECS. A pinned invalidator's `check` is DATA, interpreted by the
// small pure interpreter here — never a JS closure. That is a hard requirement: the check
// is stored in JSONB and re-run the next morning by a DIFFERENT process, so it must
// round-trip through JSON.stringify losslessly and mean exactly the same thing.
//
// This module reads (type-only) the cortex-overnight surfaces to DERIVE invalidators, but
// never mutates them — cortex-overnight is owned elsewhere.

import type { PlaybookPlay } from "./types";
import type {
  OvernightInputs,
  OvernightVerdict,
  OvernightSourceId,
} from "./cortex-overnight";

/** Dark-pool accumulation bias, matching the cortex OvernightDarkPoolSlice union. */
export type DarkPoolBias = "bullish" | "bearish" | "mixed" | "neutral" | "unknown";

/** The market metrics a predicate can name. Resolved to a live number by the interpreter
 *  from a {@link MarketSnapshot}; a null resolution makes the predicate UNKNOWN (never
 *  fires) — the one-way-latch philosophy: we degrade/invalidate only on positive evidence,
 *  never on a metric we could not read. */
export type InvalidatorMetric = "spot" | "call_wall" | "put_wall" | "gamma_flip";

/**
 * A serializable predicate spec. DATA ONLY — the interpreter (evalPredicate) supplies the
 * behaviour. Kinds:
 *  - lt / gt: metric vs a FIXED level pinned at publish (e.g. spot < flip 7480). Needs only
 *    that one metric at morning, so it is the robust, always-checkable class.
 *  - metric_lt_metric / metric_gt_metric: one live metric vs another (e.g. call_wall <
 *    spot — the "wall migrated to the wrong side of price" class). Needs BOTH metrics at
 *    morning; UNKNOWN (skipped) when either is unavailable.
 *  - darkpool_reversed: the pinned tailwind bias flipped to one of `to` (e.g. published
 *    bullish accumulation reversed to bearish distribution).
 */
export type InvalidatorPredicate =
  | { kind: "lt"; metric: InvalidatorMetric; level: number }
  | { kind: "gt"; metric: InvalidatorMetric; level: number }
  | { kind: "metric_lt_metric"; left: InvalidatorMetric; right: InvalidatorMetric }
  | { kind: "metric_gt_metric"; left: InvalidatorMetric; right: InvalidatorMetric }
  | { kind: "darkpool_reversed"; to: DarkPoolBias[] };

/** kill = a fired invalidator forces INVALIDATED; degrade = forces at least DEGRADED.
 *  Both are ONE-WAY (they can only worsen a grade), matching the repo's latch philosophy. */
export type InvalidatorSeverity = "kill" | "degrade";

/** One pre-declared, machine-checkable falsifier. `source` names which pinned overnight
 *  evidence source it falsifies, so N6 thesis-drift can group fired invalidators by the
 *  premise they break. */
export type Invalidator = {
  id: string;
  source: OvernightSourceId;
  /** Human-readable, member-safe sentence with the live level baked in. */
  describe: string;
  check: InvalidatorPredicate;
  severity: InvalidatorSeverity;
};

/**
 * A market snapshot the interpreter resolves metrics from. Used BOTH at publish (built from
 * the cortex surfaces) and at morning (built by the morning-confirm cron). Every field is
 * nullable and null is honest: a null metric makes any predicate naming it UNKNOWN, never
 * a silent zero/true. `darkPoolBias` is usually null at morning (the cron does not re-fetch
 * per-ticker dark-pool) — that is correct: an un-re-read surface must not fire.
 */
export type MarketSnapshot = {
  spot: number | null;
  gammaFlip: number | null;
  callWall: number | null;
  putWall: number | null;
  regime: string | null;
  darkPoolBias: DarkPoolBias | null;
};

/** MarketSnapshot + identity, for the morning-confirm side. */
export type MorningState = MarketSnapshot & {
  ticker: string;
  /** ISO timestamp of the morning read (so the persisted evaluation records WHEN). */
  asOf: string;
};

/** One evaluated invalidator. `evaluable=false` means a required metric was null (UNKNOWN);
 *  such an invalidator NEVER fires — honesty over a fabricated pass/fail. */
export type InvalidatorEvaluation = {
  invalidator: Invalidator;
  fired: boolean;
  evaluable: boolean;
  /** The observed value(s) that decided it, for the audit trail. */
  observed: number | string | null;
  detail: string;
};

/** Proximity band for the adversarial kill-test: a play whose spot sits within this
 *  fraction of a kill level (on the wrong side of the line) is "already near-fired" and
 *  does not publish. 0.15% — tight enough that only a play genuinely balanced on its own
 *  kill line is caught, not a normal setup with a point or two of room. */
export const NEAR_KILL_PCT = 0.0015;

function finite(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function normalizeBias(b: unknown): DarkPoolBias | null {
  return b === "bullish" || b === "bearish" || b === "mixed" || b === "neutral" || b === "unknown"
    ? b
    : null;
}

function resolveMetric(metric: InvalidatorMetric, s: MarketSnapshot): number | null {
  switch (metric) {
    case "spot":
      return finite(s.spot);
    case "call_wall":
      return finite(s.callWall);
    case "put_wall":
      return finite(s.putWall);
    case "gamma_flip":
      return finite(s.gammaFlip);
  }
}

/** Round to 4dp for stored/observed numbers — consistent with the rest of the funnel. */
function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

// ---------------------------------------------------------------------------
// deriveInvalidators — at PUBLISH
// ---------------------------------------------------------------------------

/**
 * Emit 2–4 pre-declared falsifiers for one play, derived from the SAME overnight evidence
 * surfaces the cortex lens scored (so they falsify the ACTUAL thesis, not a generic one):
 *
 *  - flip_break (kill): the play's direction relies on the gamma-flip regime line. A LONG
 *    opening below flip (SHORT above) has lost the regime that justified it — the single
 *    most robust morning-checkable falsifier (needs only morning spot vs the pinned flip).
 *  - opposing_wall_migrated (kill): the opposing GEX wall (the one the play must trade
 *    THROUGH — call wall for a LONG, put wall for a SHORT) migrating to the WRONG side of
 *    spot means the structure the thesis leaned on has inverted (doc example: "call wall
 *    7550 migrates below spot → kill"). Needs the morning wall, so it is UNKNOWN (skipped)
 *    when the morning read lacks that ticker's wall — honest, not a false pass.
 *  - darkpool_reversal (degrade): only emitted when dark-pool accumulation was a TAILWIND
 *    for the play (bullish under a LONG / bearish under a SHORT). If it reverses to the
 *    opposite bias the accumulation premise is gone — a degrade, not a kill (dark-pool is
 *    slower-moving context, not a hard structural line).
 *
 * Pure: same (play, verdict, surfaces) ⇒ same invalidators. Returns [] honestly when the
 * surfaces carry no usable levels (nothing to falsify) — such a play was riding an
 * abstained/thin lens anyway, and killTestPlay then has nothing to veto on.
 */
export function deriveInvalidators(
  play: PlaybookPlay,
  cortexOvernight: OvernightVerdict | null | undefined,
  surfaces: OvernightInputs
): Invalidator[] {
  const direction = String(play?.direction ?? "LONG").toUpperCase();
  const isLong = !direction.includes("SHORT");
  const out: Invalidator[] = [];

  const wall = surfaces?.wall ?? null;
  const flip = finite(wall?.gammaFlip);
  const opposing = wall?.opposingWall ?? null;
  const opposingStrike = finite(opposing?.strike);

  // The set of sources that actually CARRIED the play (appeared as supports in the verdict).
  // We only emit a darkpool falsifier when dark-pool was one of them — a falsifier of a
  // premise the play never leaned on would be noise.
  const supportSources = new Set<OvernightSourceId>(
    (cortexOvernight?.supports ?? []).map((s) => s.source)
  );

  // ── flip_break (kill) — spot vs the pinned gamma-flip level ────────────────────────
  if (flip != null) {
    out.push({
      id: "flip_break",
      source: "wall-migration",
      describe: isLong
        ? `${play.ticker} opens below the overnight gamma-flip ${flip} — long regime broken`
        : `${play.ticker} opens above the overnight gamma-flip ${flip} — short regime broken`,
      check: isLong
        ? { kind: "lt", metric: "spot", level: flip }
        : { kind: "gt", metric: "spot", level: flip },
      severity: "kill",
    });
  }

  // ── opposing_wall_migrated (kill) — the opposing wall crosses to the wrong side of spot ─
  // LONG's opposing wall is the CALL wall (overhead, the target it climbs toward): the
  // falsifier is that call wall migrating BELOW spot (metric call_wall < spot). SHORT's
  // opposing wall is the PUT wall (below, its target): the falsifier is that put wall
  // migrating ABOVE spot. Both need the MORNING wall, so they self-skip when it is absent.
  if (opposingStrike != null && opposing) {
    if (isLong && opposing.kind === "call") {
      out.push({
        id: "opposing_wall_migrated",
        source: "wall-migration",
        describe: `call wall ${opposingStrike} migrates below spot — overhead structure inverted`,
        check: { kind: "metric_lt_metric", left: "call_wall", right: "spot" },
        severity: "kill",
      });
    } else if (!isLong && opposing.kind === "put") {
      out.push({
        id: "opposing_wall_migrated",
        source: "wall-migration",
        describe: `put wall ${opposingStrike} migrates above spot — support structure inverted`,
        check: { kind: "metric_gt_metric", left: "put_wall", right: "spot" },
        severity: "kill",
      });
    }
  }

  // ── darkpool_reversal (degrade) — the pinned accumulation tailwind flips ────────────
  const dpBias = normalizeBias(surfaces?.darkPool?.bias);
  const dpWasTailwind = isLong ? dpBias === "bullish" : dpBias === "bearish";
  if (dpWasTailwind && supportSources.has("darkpool-trend")) {
    out.push({
      id: "darkpool_reversal",
      source: "darkpool-trend",
      describe: isLong
        ? `overnight dark-pool accumulation reverses to distribution (bearish)`
        : `overnight dark-pool distribution reverses to accumulation (bullish)`,
      check: { kind: "darkpool_reversed", to: isLong ? ["bearish"] : ["bullish"] },
      severity: "degrade",
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// evaluateInvalidators — at MORNING
// ---------------------------------------------------------------------------

/** The pure interpreter for ONE serializable predicate against a snapshot. Returns
 *  evaluable=false (UNKNOWN, never fires) when a named metric/bias is unavailable. */
function evalPredicate(
  pred: InvalidatorPredicate,
  s: MarketSnapshot
): { evaluable: boolean; fired: boolean; observed: number | string | null } {
  switch (pred.kind) {
    case "lt": {
      const v = resolveMetric(pred.metric, s);
      if (v == null) return { evaluable: false, fired: false, observed: null };
      return { evaluable: true, fired: v < pred.level, observed: round4(v) };
    }
    case "gt": {
      const v = resolveMetric(pred.metric, s);
      if (v == null) return { evaluable: false, fired: false, observed: null };
      return { evaluable: true, fired: v > pred.level, observed: round4(v) };
    }
    case "metric_lt_metric": {
      const a = resolveMetric(pred.left, s);
      const b = resolveMetric(pred.right, s);
      if (a == null || b == null) return { evaluable: false, fired: false, observed: null };
      return { evaluable: true, fired: a < b, observed: `${round4(a)} vs ${round4(b)}` };
    }
    case "metric_gt_metric": {
      const a = resolveMetric(pred.left, s);
      const b = resolveMetric(pred.right, s);
      if (a == null || b == null) return { evaluable: false, fired: false, observed: null };
      return { evaluable: true, fired: a > b, observed: `${round4(a)} vs ${round4(b)}` };
    }
    case "darkpool_reversed": {
      const bias = normalizeBias(s.darkPoolBias);
      // UNKNOWN dark-pool (the common morning case — not re-fetched) never fires.
      if (bias == null || bias === "unknown") return { evaluable: false, fired: false, observed: bias ?? null };
      return { evaluable: true, fired: pred.to.includes(bias), observed: bias };
    }
  }
}

/**
 * Run a play's PINNED invalidators against the morning state. Pure. Order-preserving.
 * `pinnedInvalidators` is whatever was stored in publish_context.invalidators — defensively
 * validated (a malformed/absent pin yields []), because it round-tripped through JSONB and
 * a caller's cast is not a guarantee.
 */
export function evaluateInvalidators(
  pinnedInvalidators: unknown,
  morningState: MarketSnapshot
): InvalidatorEvaluation[] {
  const list = coerceInvalidators(pinnedInvalidators);
  return list.map((invalidator) => {
    const { evaluable, fired, observed } = evalPredicate(invalidator.check, morningState);
    const detail = !evaluable
      ? `${invalidator.id}: not re-readable this morning (unknown) — did not fire`
      : fired
        ? `${invalidator.id} FIRED (${invalidator.severity}): ${invalidator.describe} [observed ${observed}]`
        : `${invalidator.id} held: ${invalidator.describe} [observed ${observed}]`;
    return { invalidator, fired, evaluable, observed, detail };
  });
}

/** The subset that actually fired. */
export function firedInvalidators(evals: InvalidatorEvaluation[]): InvalidatorEvaluation[] {
  return evals.filter((e) => e.fired);
}

/** Runtime guard: coerce an untrusted JSONB value into Invalidator[]. Drops anything whose
 *  `check` is not one of the known serializable kinds — a stored closure/garbage predicate
 *  can never be interpreted, so it must not masquerade as a live falsifier. */
export function coerceInvalidators(value: unknown): Invalidator[] {
  if (!Array.isArray(value)) return [];
  const out: Invalidator[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const check = r.check as Record<string, unknown> | undefined;
    if (!check || typeof check !== "object" || !isKnownPredicate(check)) continue;
    if (r.severity !== "kill" && r.severity !== "degrade") continue;
    out.push({
      id: String(r.id ?? ""),
      source: r.source as OvernightSourceId,
      describe: String(r.describe ?? ""),
      check: check as unknown as InvalidatorPredicate,
      severity: r.severity,
    });
  }
  return out;
}

function isKnownPredicate(check: Record<string, unknown>): boolean {
  switch (check.kind) {
    case "lt":
    case "gt":
      return typeof check.metric === "string" && typeof check.level === "number";
    case "metric_lt_metric":
    case "metric_gt_metric":
      return typeof check.left === "string" && typeof check.right === "string";
    case "darkpool_reversed":
      return Array.isArray(check.to);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// killTestPlay — adversarial pre-publish kill-test
// ---------------------------------------------------------------------------

/**
 * Would this play publish sitting ON its own kill line? Evaluated at PUBLISH against the
 * publish-time snapshot. A KILL-severity invalidator counts as a veto when it is EITHER:
 *   - already fired at publish (the level is on the wrong side of spot right now), OR
 *   - near-fired: for a fixed-level kill (lt/gt), spot is within NEAR_KILL_PCT of the level
 *     on the wrong side (a play whose whole thesis is one 0.15% tick from breaking).
 * Degrade invalidators never veto (they are not disqualifying, just a lower grade). Metric-
 * vs-metric kills veto only when already fired at publish (there is no single "level" to
 * measure proximity to — the two live metrics already ARE the comparison).
 *
 * Pure; returns the veto reasons so the caller can fold them into the publish gate's reason
 * list (best-plays-only: zero honest plays beats one balanced on its own kill line).
 */
export function killTestPlay(args: {
  play: PlaybookPlay;
  invalidators: Invalidator[];
  state: MarketSnapshot;
  nearPct?: number;
}): { vetoed: boolean; reasons: string[] } {
  const nearPct = args.nearPct ?? NEAR_KILL_PCT;
  const reasons: string[] = [];

  for (const inv of args.invalidators) {
    if (inv.severity !== "kill") continue;
    const { check } = inv;

    if (check.kind === "lt" || check.kind === "gt") {
      const v = resolveMetric(check.metric, args.state);
      if (v == null || check.level === 0) continue;
      const fired = check.kind === "lt" ? v < check.level : v > check.level;
      // Proximity: how far spot is from the line, on the wrong side. For lt the wrong side
      // is ABOVE the level (about to fall through); for gt it is BELOW.
      const rel = (v - check.level) / Math.abs(check.level);
      const near = check.kind === "lt" ? rel >= 0 && rel <= nearPct : rel <= 0 && rel >= -nearPct;
      if (fired || near) {
        reasons.push(
          fired
            ? `${inv.describe} — already through the kill line at publish (${round4(v)} vs ${check.level})`
            : `${inv.describe} — publish spot ${round4(v)} is within ${(nearPct * 100).toFixed(2)}% of the kill line ${check.level}`
        );
      }
    } else if (check.kind === "metric_lt_metric" || check.kind === "metric_gt_metric") {
      const a = resolveMetric(check.left, args.state);
      const b = resolveMetric(check.right, args.state);
      if (a == null || b == null) continue;
      const fired = check.kind === "metric_lt_metric" ? a < b : a > b;
      if (fired) {
        reasons.push(`${inv.describe} — already true at publish (${round4(a)} vs ${round4(b)})`);
      }
    }
    // darkpool_reversed is a degrade in practice; a kill-severity categorical would be
    // handled here if one is ever added — left out deliberately (nothing to measure).
  }

  return { vetoed: reasons.length > 0, reasons };
}

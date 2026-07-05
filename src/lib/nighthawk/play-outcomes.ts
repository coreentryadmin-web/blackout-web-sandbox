import type { PlaybookPlay } from "./types";
import type { ScoredCandidate } from "./scorer";
import {
  fetchPendingNighthawkOutcomes,
  insertAlertAuditLog,
  insertNighthawkRejectedAuditLog,
  pruneNighthawkPlayOutcomesForEdition,
  upsertNighthawkPlayOutcomes,
  updateNighthawkPlayOutcome,
  type NighthawkPlayOutcomeRow,
} from "@/lib/db";

// Per-edition distributed lock for outcome sync.
// Prevents concurrent force-rebuilds from racing on the same upsert and
// overwriting each other's rows. One Promise chain per editionFor key.
const _syncLocks = new Map<string, Promise<void>>();
import { fetchStockDailyBars } from "@/lib/providers/polygon";
import { polygonConfigured } from "@/lib/providers/config";

// Level parsing lives in the dependency-free ./play-levels leaf so the publish-time
// geometry gate (client-bundled via play-constraints) shares the exact parser without
// dragging this module's Polygon/db imports into a client bundle.
export { parsePlayLevels, type ParsedPlayLevels } from "./play-levels";
import { parsePlayLevels } from "./play-levels";

// ── Stage 4 audit trail (alert_audit_log) ─────────────────────────────────────────
// Shape matches the alert_audit_log columns in src/lib/db.ts — mirrors
// zerodte/board.ts's buildZeroDteAuditRow. Pure function of a play + edition date +
// sector, no I/O, so it's unit-testable with fixture plays like the rest of this
// module's parsing/grading logic already is.

export type NighthawkAuditRow = {
  alert_type: "nighthawk" | "nighthawk_rejected";
  source_table: "nighthawk_play_outcomes" | "claude_edition_synthesis";
  source_key: { edition_for: string; ticker: string };
  ticker: string;
  direction: "LONG" | "SHORT";
  confidence_score: number | null;
  confidence_label: string | null;
  trigger_reason: string;
  decision_trace: Array<{ check: string; passed: boolean; value: unknown; threshold: unknown }>;
  input_snapshot: Record<string, unknown>;
  final_output: Record<string, unknown> | null;
};

/** Build the audit-trail row for a play's FIRST publish in an edition. Every play
 *  reaching this function already survived `validatePlayGeometry()` at synthesis
 *  time (claude-edition.ts) — this scope only records the parseable-levels check,
 *  since the individual gate verdicts (geometry/premium-cap/strike-validation) are
 *  computed upstream and not yet threaded down to this call site. A richer trace
 *  (and the rejected-play half of Stage 4) is explicit follow-up work, tracked in
 *  docs/bie/AUDIT-TRAIL-SCHEMA.md — not invented here. */
export function buildNighthawkAuditRow(
  play: PlaybookPlay,
  editionFor: string,
  sector: string | null
): NighthawkAuditRow {
  const ticker = String(play.ticker ?? "").toUpperCase();
  const levels = parsePlayLevels(play);
  const direction: "LONG" | "SHORT" = String(play.direction ?? "LONG").toUpperCase().includes("SHORT")
    ? "SHORT"
    : "LONG";
  const hasGeometry = levels.target != null && levels.stop != null;
  return {
    alert_type: "nighthawk",
    source_table: "nighthawk_play_outcomes",
    source_key: { edition_for: editionFor, ticker },
    ticker,
    direction,
    confidence_score: play.score ?? null,
    confidence_label: String(play.conviction ?? "B").toUpperCase(),
    trigger_reason: "published in the Night Hawk edition (survived synthesis + trade-geometry validation)",
    decision_trace: [
      {
        check: "target_and_stop_parsed",
        passed: hasGeometry,
        value: { target: levels.target, stop: levels.stop },
        threshold: null,
      },
    ],
    input_snapshot: {
      entry_range_low: levels.entry_range_low,
      entry_range_high: levels.entry_range_high,
      target: levels.target,
      stop: levels.stop,
      score: play.score ?? null,
      sector,
    },
    final_output: {
      thesis: play.thesis,
      key_signal: play.key_signal,
      entry_range: play.entry_range,
      target: play.target,
      stop: play.stop,
      options_play: play.options_play,
      entry_premium: play.entry_premium ?? null,
    },
  };
}

/** Build the audit-trail row for a play REJECTED at the trade-geometry gate
 *  (`validatePlayGeometry()` in claude-edition.ts) — the Stage 4 rejected-play half
 *  (docs/bie/AUDIT-TRAIL-SCHEMA.md step 4b). `source_table` is `claude_edition_synthesis`,
 *  not `nighthawk_play_outcomes` — a rejected play is never written to that table, so
 *  this audit row is its ONLY record. `decision_trace` cites the real drop reasons from
 *  `validatePlayGeometry()`'s verdict, one entry per reason — never fabricated. No sector
 *  attribution (unlike the published-row builder) — sector capping runs on the
 *  already-geometry-passed list downstream, so a rejected play was never sector-scored.
 *  `final_output` is null: a rejected play was never shown to a member, so there is no
 *  real "final output" to record.
 *
 *  `scored` (task #142, optional — omit or pass `null` when unavailable) is the confluence-
 *  factor breakdown `scoreCandidate()` computed for this ticker THIS run (flow/tech/pos/news/
 *  smart-money/fundamental/short-interest/catalyst sub-scores) — folded into `input_snapshot`
 *  by `inputSnapshotForRejection` below so "why was ticker X rejected" also answers "and what
 *  did the desk's confluence read on it look like." See that function's doc for why this is
 *  passed in by the caller (claude-edition.ts's in-memory dossierMap) rather than looked up
 *  here from `nighthawk_scoring_history` (task #129). */
export function buildNighthawkRejectedAuditRow(
  rejected: { ticker: string; drops: string[]; play: PlaybookPlay; scored?: ScoredCandidate | null },
  editionFor: string
): NighthawkAuditRow {
  // task #141: delegates to the generalized stage-rejection builder below (defined later in
  // this file, but function declarations are hoisted and this only RUNS after the module has
  // fully evaluated, same as any other cross-reference in this file). Output is byte-for-byte
  // identical to the pre-#141 implementation for every field EXCEPT input_snapshot's new
  // `confluence` key (task #142, additive) — verified by the existing tests in
  // play-outcomes.test.ts, which are unchanged by this refactor.
  return buildNighthawkStageRejectedAuditRow(
    {
      ticker: rejected.ticker,
      play: rejected.play,
      detail: { stage: "geometry", drops: rejected.drops },
      scored: rejected.scored ?? null,
    },
    editionFor
  );
}

// ── Stage 4 audit trail, LATER-stage rejections (task #141) ──────────────────────────────
// `validatePlayGeometry()` above is only the FIRST of several real rejection points in the
// synthesis funnel (claude-edition.ts's generateEditionPlays). Three more run strictly AFTER
// a candidate has already survived geometry and is being considered for publication —
// premium-cap, illiquid-strike (chain-contradicted OI), numeric-grounding ("ungrounded"),
// plus sector-concentration in the same funnel (edition-builder.ts's capSectorConcentration
// call, invoked from claude-edition.ts). Before this task NONE of the four wrote anything
// durable — each was a `console.warn` only, so "why was ticker X rejected tonight" had a real
// answer for geometry drops but was invisible by the next morning for every other reason,
// even though the pipeline had already computed exactly why. See docs/audit/FINDINGS.md
// (task #141) for the full root-cause writeup.
//
// DESIGN CHOICE: one discriminated-union `NighthawkRejectionDetail` + one generic builder
// (`buildNighthawkStageRejectedAuditRow`) instead of 4 near-duplicate build/record function
// pairs. `buildNighthawkRejectedAuditRow`/`recordNighthawkRejectedAuditTrail` above are kept
// as thin geometry-specific wrappers around the generic builder — same exported names/
// signatures as before this task (existing call site in edition-builder.ts and the existing
// tests above are untouched) — so this is a pure internal DRY-up for the geometry case, not a
// behavior change. All 4 stages share the same `alert_type: 'nighthawk_rejected'` /
// `source_table: 'claude_edition_synthesis'` and the same DB write path
// (`insertNighthawkRejectedAuditLog`), which already dedups on
// `(alert_type, ticker, source_key->>'edition_for')` — a force-rebuild that re-derives the
// same rejection for the same ticker/edition never writes a duplicate row, regardless of
// which of the 4 stages it came from.
export type NighthawkRejectionDetail =
  | { stage: "geometry"; drops: string[] }
  | {
      stage: "premium_cap";
      entry_premium: number | null;
      cap_per_share: number;
      entry_cost_per_contract: number | null;
      cap_per_contract: number;
    }
  | {
      stage: "illiquid_strike";
      strike: number | null;
      side: "call" | "put" | null;
      expiry: string | null;
      open_interest: number | null;
      min_open_interest: number;
    }
  | { stage: "ungrounded"; issues: Array<{ check: string; detail: string }> }
  | { stage: "sector_concentration"; sector: string; already_filled: number; max_per_sector: number };

const REJECTION_TRIGGER_REASON: Record<NighthawkRejectionDetail["stage"], string> = {
  geometry: "rejected at synthesis — failed the trade-geometry gate (untradeable risk plan)",
  premium_cap: "rejected at synthesis — entry premium exceeded the platform's affordability cap",
  illiquid_strike:
    "rejected at synthesis — chain-contradicted strike (present on-chain but open interest below the liquidity floor)",
  ungrounded:
    "rejected at synthesis — claimed level(s)/contract did not ground against real chain or dossier data",
  sector_concentration: "rejected at synthesis — sector-concentration cap reached for this edition",
};

function decisionTraceForRejection(
  detail: NighthawkRejectionDetail
): Array<{ check: string; passed: boolean; value: unknown; threshold: unknown }> {
  switch (detail.stage) {
    case "geometry":
      return detail.drops.map((reason, i) => ({
        check: `geometry_drop_${i + 1}`,
        passed: false,
        value: reason,
        threshold: null,
      }));
    case "premium_cap":
      return [
        {
          check: "premium_within_cap",
          passed: false,
          value: detail.entry_premium,
          threshold: detail.cap_per_share,
        },
      ];
    case "illiquid_strike":
      return [
        {
          check: "strike_open_interest",
          passed: false,
          value: detail.open_interest,
          threshold: detail.min_open_interest,
        },
      ];
    case "ungrounded":
      return detail.issues.map((issue, i) => ({
        check: `ungrounded_${issue.check}_${i + 1}`,
        passed: false,
        value: issue.detail,
        threshold: null,
      }));
    case "sector_concentration":
      return [
        {
          check: "sector_concentration_cap",
          passed: false,
          value: detail.already_filled,
          threshold: detail.max_per_sector,
        },
      ];
  }
}

/** task #142: compact confluence-factor summary folded into every rejection stage's
 *  `input_snapshot` (see `inputSnapshotForRejection` below) — the exact sub-scores
 *  `scoreCandidate()` (scorer.ts) computed for this ticker, never re-derived or
 *  recomputed here. `null` when the caller has no matching `ScoredCandidate` for this
 *  ticker/run (mechanical-fallback path, or a ticker named outside the scored candidate
 *  set) — honest per this module's "never fabricate" convention, same as every other
 *  optional field in this file (e.g. `stop_data_unavailable`, `raw` in the synthesis
 *  result). Deliberately NOT a full dump of `ScoredCandidate` — `catalyst_flags`/
 *  `fundamental_flags` arrays are kept (small, human-readable) but nothing from the
 *  underlying dossier itself (news articles, congress trades, dark-pool prints) is
 *  duplicated here; that full context is what `nighthawk_scoring_history`/
 *  `get_nighthawk_dossier` remain the source of truth for (task #129) — this is a
 *  same-row SUMMARY so a rejection's audit row is self-explaining without a second
 *  lookup, not a second copy of the archive. */
function confluenceSnapshot(scored: ScoredCandidate | null | undefined): Record<string, unknown> | null {
  if (!scored) return null;
  return {
    total_score: scored.score,
    direction: scored.direction,
    conviction: scored.conviction,
    flow_score: scored.flow_score,
    tech_score: scored.tech_score,
    pos_score: scored.pos_score,
    news_score: scored.news_score,
    smart_money_score: scored.smart_money_score,
    fundamental_score: scored.fundamental_score ?? null,
    catalyst_score: scored.catalyst_score ?? null,
    catalyst_flags: scored.catalyst_flags ?? [],
    short_interest_score: scored.short_interest_score ?? null,
    earnings_risk: scored.earnings_risk ?? false,
    regime_multiplier: scored.regime_multiplier ?? null,
    fundamental_block: scored.fundamental_block ?? false,
    fundamental_flags: scored.fundamental_flags ?? [],
    trading_halt: scored.trading_halt ?? false,
  };
}

function inputSnapshotForRejection(
  detail: NighthawkRejectionDetail,
  play: PlaybookPlay,
  levels: ReturnType<typeof parsePlayLevels>,
  scored?: ScoredCandidate | null
): Record<string, unknown> {
  const base = {
    entry_range_low: levels.entry_range_low,
    entry_range_high: levels.entry_range_high,
    target: levels.target,
    stop: levels.stop,
    score: play.score ?? null,
    // task #142: folded in for EVERY stage (not just geometry) — the same in-memory
    // dossier is available at all 5 rejection push sites in claude-edition.ts's
    // generateEditionPlays(). See confluenceSnapshot's doc for the honesty convention
    // and why this reads the in-memory ScoredCandidate rather than joining
    // nighthawk_scoring_history: that table isn't archived until AFTER a rejection is
    // already recorded (archiveAndClearNighthawkStaging runs post-publish, in
    // edition-builder.ts, strictly later than generateEditionPlays' rejection
    // collection) — a DB read at build time would find nothing for tonight's edition.
    confluence: confluenceSnapshot(scored),
  };
  switch (detail.stage) {
    case "geometry":
      return { ...base, raw_entry_range: play.entry_range, raw_target: play.target, raw_stop: play.stop };
    case "premium_cap":
      return {
        ...base,
        entry_premium: detail.entry_premium,
        cap_per_share: detail.cap_per_share,
        entry_cost_per_contract: detail.entry_cost_per_contract,
        cap_per_contract: detail.cap_per_contract,
        options_play: play.options_play,
      };
    case "illiquid_strike":
      return {
        ...base,
        strike: detail.strike,
        side: detail.side,
        expiry: detail.expiry,
        open_interest: detail.open_interest,
        min_open_interest: detail.min_open_interest,
        options_play: play.options_play,
      };
    case "ungrounded":
      return { ...base, ungrounded_issues: detail.issues, options_play: play.options_play };
    case "sector_concentration":
      return {
        ...base,
        sector: detail.sector,
        already_filled: detail.already_filled,
        max_per_sector: detail.max_per_sector,
      };
  }
}

/** Build the audit-trail row for a play rejected at ANY of the 4 later-funnel stages
 *  (premium-cap, illiquid-strike, ungrounded, sector-concentration) — the generalized
 *  sibling of {@link buildNighthawkRejectedAuditRow} (geometry-only). `source_table` /
 *  `alert_type` match the geometry builder: a rejected play at any of these stages is
 *  never written to `nighthawk_play_outcomes`, so this audit row is its ONLY record.
 *  `final_output` is null for the same reason the geometry builder's is — a rejected
 *  play was never shown to a member.
 *
 *  `scored` (task #142, optional): see {@link buildNighthawkRejectedAuditRow}'s doc — the
 *  same confluence-breakdown pass-through, applied uniformly to all 4 later stages here. */
export function buildNighthawkStageRejectedAuditRow(
  rejected: { ticker: string; play: PlaybookPlay; detail: NighthawkRejectionDetail; scored?: ScoredCandidate | null },
  editionFor: string
): NighthawkAuditRow {
  const { play, detail, scored } = rejected;
  const ticker = String(play.ticker ?? "").toUpperCase();
  const levels = parsePlayLevels(play);
  const direction: "LONG" | "SHORT" = String(play.direction ?? "LONG").toUpperCase().includes("SHORT")
    ? "SHORT"
    : "LONG";
  return {
    alert_type: "nighthawk_rejected",
    source_table: "claude_edition_synthesis",
    source_key: { edition_for: editionFor, ticker },
    ticker,
    direction,
    confidence_score: play.score ?? null,
    confidence_label: String(play.conviction ?? "B").toUpperCase(),
    trigger_reason: REJECTION_TRIGGER_REASON[detail.stage],
    decision_trace: decisionTraceForRejection(detail),
    input_snapshot: inputSnapshotForRejection(detail, play, levels, scored),
    final_output: null,
  };
}

/** Fire-and-forget: one audit row per play rejected at any of the 4 later-funnel stages
 *  (premium-cap, illiquid-strike, ungrounded, sector-concentration). Same dedup/failure
 *  semantics as {@link recordNighthawkRejectedAuditTrail}: `insertNighthawkRejectedAuditLog`'s
 *  `ON CONFLICT ... DO NOTHING` absorbs a re-derived rejection on a force-rebuild, and a
 *  write failure is logged, never thrown. */
export function recordNighthawkStageRejectedAuditTrail(
  rejected: Array<{ ticker: string; play: PlaybookPlay; detail: NighthawkRejectionDetail; scored?: ScoredCandidate | null }>,
  editionFor: string
): void {
  for (const r of rejected) {
    const row = buildNighthawkStageRejectedAuditRow(r, editionFor);
    void insertNighthawkRejectedAuditLog({
      source_key: row.source_key,
      ticker: row.ticker,
      direction: row.direction,
      confidence_score: row.confidence_score,
      confidence_label: row.confidence_label,
      trigger_reason: row.trigger_reason,
      decision_trace: row.decision_trace,
      input_snapshot: row.input_snapshot,
    }).catch((err) => {
      console.warn(
        `[nighthawk-audit] failed to write rejected alert_audit_log (${r.detail.stage}) for ${row.ticker}:`,
        err
      );
    });
  }
}

/** Fire-and-forget: one audit row per geometry-rejected play. Safe to call on every
 *  synthesis run (fresh or force-rebuilt) — `insertNighthawkRejectedAuditLog`'s
 *  `ON CONFLICT ... DO NOTHING` (via the partial unique index) absorbs a re-derived
 *  rejection for the same edition/ticker without writing a duplicate row. Failures are
 *  logged, never thrown — the audit trail must not be able to break edition publishing.
 *  Thin wrapper over {@link recordNighthawkStageRejectedAuditTrail} (task #141) — same
 *  external signature/behavior as before that task (plus task #142's optional `scored`
 *  pass-through), kept for the existing edition-builder.ts call site and the existing
 *  tests above. */
export function recordNighthawkRejectedAuditTrail(
  rejected: Array<{ ticker: string; drops: string[]; play: PlaybookPlay; scored?: ScoredCandidate | null }>,
  editionFor: string
): void {
  recordNighthawkStageRejectedAuditTrail(
    rejected.map((r) => ({
      ticker: r.ticker,
      play: r.play,
      detail: { stage: "geometry" as const, drops: r.drops },
      scored: r.scored ?? null,
    })),
    editionFor
  );
}

/** Fire-and-forget: one audit row per FRESHLY published ticker (never on a
 *  force-rebuild refresh of an already-published play). Failures are logged,
 *  never thrown — the audit trail must not be able to break edition publishing. */
function recordNighthawkAuditTrail(
  freshTickers: Set<string>,
  plays: PlaybookPlay[],
  editionFor: string,
  sectors: Record<string, string | null | undefined>
): void {
  for (const play of plays) {
    const ticker = String(play.ticker ?? "").toUpperCase();
    if (!freshTickers.has(ticker)) continue;
    const row = buildNighthawkAuditRow(play, editionFor, sectors[ticker] ?? null);
    void insertAlertAuditLog(row).catch((err) => {
      console.warn(`[nighthawk-audit] failed to write alert_audit_log for ${ticker}:`, err);
    });
  }
}

export async function syncNighthawkPlayOutcomes(
  editionFor: string,
  plays: PlaybookPlay[],
  sectors: Record<string, string | null | undefined> = {}
): Promise<void> {
  const rows = plays.map((play) => {
    const ticker = String(play.ticker ?? "").toUpperCase();
    const levels = parsePlayLevels(play);
    const direction = String(play.direction ?? "LONG").toUpperCase().includes("SHORT") ? "SHORT" : "LONG";
    return {
      edition_for: editionFor,
      ticker,
      direction: direction as "LONG" | "SHORT",
      conviction: String(play.conviction ?? "B").toUpperCase(),
      entry_range_low: levels.entry_range_low,
      entry_range_high: levels.entry_range_high,
      target: levels.target,
      stop: levels.stop,
      score: Number(play.score ?? 0),
      sector: sectors[ticker] ?? null,
    };
  });

  // Serialize concurrent syncs for the same edition to prevent the second
  // force-rebuild from racing the first and overwriting atomically-merged fields.
  const prior = _syncLocks.get(editionFor) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => { release = resolve; });
  const chain = prior.then(() => next);
  _syncLocks.set(editionFor, chain);

  try {
    await prior;
    // upsertNighthawkPlayOutcomes must use INSERT … ON CONFLICT DO UPDATE SET
    // so that each row is merged atomically in the DB rather than blindly overwritten.
    const freshlyPublished = await upsertNighthawkPlayOutcomes(rows);
    if (freshlyPublished.size > 0) {
      recordNighthawkAuditTrail(freshlyPublished, plays, editionFor, sectors);
    }
    await pruneNighthawkPlayOutcomesForEdition(editionFor, rows.map((row) => row.ticker));
  } finally {
    release();
    // Clean up the lock entry once all chains for this edition have resolved.
    if (_syncLocks.get(editionFor) === chain) {
      _syncLocks.delete(editionFor);
    }
  }
}

export function outcomeSessionDate(row: Pick<NighthawkPlayOutcomeRow, "edition_for">): string {
  return row.edition_for;
}

export function resolveOutcome(row: NighthawkPlayOutcomeRow): {
  hit_target: boolean;
  hit_stop: boolean;
  outcome: "target" | "stop" | "open" | "ambiguous" | "pending" | "unfilled";
  // True when a stop level is defined but intraday high/low data is unavailable,
  // making it impossible to determine whether the stop was hit. These plays must
  // be excluded from win/loss tallies and reported separately so operators know
  // the effective sample size rather than silently inflating the win rate.
  stop_data_unavailable: boolean;
} {
  const close = row.next_day_close;
  const high = row.session_high;
  const low = row.session_low;
  const open = row.next_day_open;
  const target = row.target;
  const stop = row.stop;

  if (close == null) {
    return { hit_target: false, hit_stop: false, outcome: "pending", stop_data_unavailable: false };
  }

  const isLong = row.direction === "LONG";
  const hasIntraday = high != null && low != null;

  // FILLABILITY (grading-honesty, audit MEDIUM): the entry range is part of the
  // published play — a LONG that gaps ABOVE its band at the open and runs to target
  // was never fillable at the published entry, yet it graded "target" and its
  // return was computed FROM that unfillable entry (phantom win inflating the
  // public win rate; the mirror books phantom losses). If the session never
  // traded back into reach of the band — long: session low stayed above the top
  // of the band; short: session high stayed below the bottom — grade 'unfilled'
  // and exclude from win/loss tallies (same treatment as stop_data_unavailable).
  if (hasIntraday && row.entry_range_low != null && row.entry_range_high != null) {
    const fillable = isLong ? low! <= row.entry_range_high : high! >= row.entry_range_low;
    if (!fillable) {
      return { hit_target: false, hit_stop: false, outcome: "unfilled", stop_data_unavailable: false };
    }
  }
  // When a stop is defined but only close data is available we cannot determine
  // whether the stop was hit intraday. Flag the play so callers can exclude it
  // from win-rate calculations rather than counting it as a non-stop outcome.
  const stop_data_unavailable = stop != null && !hasIntraday;
  let hit_target = false;
  let hit_stop = false;

  if (target != null) {
    hit_target = hasIntraday
      ? isLong
        ? high! >= target
        : low! <= target
      : isLong
        ? close >= target
        : close <= target;
  }
  if (stop != null && hasIntraday) {
    hit_stop = isLong ? low! <= stop : high! >= stop;
  }

  let outcome: "target" | "stop" | "open" | "ambiguous" | "pending" | "unfilled" = "open";
  if (hit_target && hit_stop) {
    if (open != null && target != null && (isLong ? open >= target : open <= target)) {
      outcome = "target";
    } else if (open != null && stop != null && (isLong ? open <= stop : open >= stop)) {
      outcome = "stop";
    } else {
      outcome = "ambiguous";
    }
  } else if (hit_stop) {
    outcome = "stop";
  } else if (hit_target) {
    outcome = "target";
  }

  return { hit_target, hit_stop, outcome, stop_data_unavailable };
}

export async function resolvePendingNighthawkOutcomes(opts?: {
  lookbackDays?: number;
}): Promise<{ resolved: number; skipped: number; errors: string[] }> {
  if (!polygonConfigured()) {
    return { resolved: 0, skipped: 0, errors: ["Polygon not configured"] };
  }

  const lookbackDays = opts?.lookbackDays ?? 7;
  const pending = await fetchPendingNighthawkOutcomes(lookbackDays);
  let resolved = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of pending) {
    try {
      const sessionDate = outcomeSessionDate(row);
      const bars = await fetchStockDailyBars(row.ticker, sessionDate, sessionDate, "1");
      const bar = bars[0];
      if (!bar) {
        skipped += 1;
        continue;
      }

      const next_day_open = bar.o;
      const next_day_close = bar.c;
      const session_high = bar.h;
      const session_low = bar.l;

      const verdict = resolveOutcome({
        ...row,
        next_day_open,
        next_day_close,
        session_high,
        session_low,
      });

      await updateNighthawkPlayOutcome(row.id, {
        next_day_open,
        next_day_close,
        session_high,
        session_low,
        hit_target: verdict.hit_target,
        hit_stop: verdict.hit_stop,
        outcome: verdict.outcome,
      });
      resolved += 1;
    } catch (err) {
      errors.push(`${row.ticker}@${row.edition_for}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { resolved, skipped, errors };
}

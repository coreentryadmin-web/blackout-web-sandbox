import { dbQuery, dbConfigured, fetchClosedPlayOutcomes, fetchOpenSpxPlay, type FlowRow } from "@/lib/db";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { isFlowFrameFreshAnywhere } from "@/lib/flow-liveness";
import { getSpxPlayState } from "@/features/spx/lib/spx-service";
import { getFlowTapeSummary } from "@/lib/platform/flow-service";
import { enrichFlowsWithGex, type GexProximityLabel } from "@/lib/flow-gex-enrichment";
import { getGexPositioning, type GexPositioning } from "@/lib/providers/gex-positioning";
import { fetchVectorFullState, type VectorFullState } from "@/lib/bie/vector-full-state";
import type { SpxPlayPayload } from "@/features/spx/lib/spx-play-payload";
import type { FlowTapeSummary } from "@/lib/platform/types";

// BIE ecosystem-context query layer, v1 — "what does the rest of BlackOut
// currently know about this ticker." Every instrument already writes its own
// state into shared Postgres (zerodte_setup_log, nighthawk_play_outcomes,
// alert_audit_log); the gap was never the data, it was that nothing let one
// instrument ask what another one already found. This is that query layer.
//
// Deliberately additive, never a hard dependency: a caller that doesn't get a
// useful answer here should proceed exactly as it did before this existed —
// same fail-open-to-empty pattern as every other BIE probe. This is NOT a
// message bus and does not make any instrument depend on another one being up;
// it only reads rows that already exist.

export type EcosystemZeroDteTake = {
  session_date: string;
  direction: string;
  score: number;
  conviction: string | null;
  status: string | null;
  first_flagged_at: string;
};

export type EcosystemNightHawkTake = {
  edition_for: string;
  direction: string;
  conviction: string;
  outcome: string;
  score: number | null;
};

export type EcosystemAuditEntry = {
  alert_type: string;
  fired_at: string;
  confidence_label: string | null;
  trigger_reason: string | null;
  outcome: string | null;
};

/**
 * Recent HELIX flow on this ticker, reported neutrally as call/put premium
 * totals rather than a single "bullish/bearish" label. flow_alerts has no
 * direction column, and this codebase has an explicit prior rule (see the
 * "TRUTH MANDATE" comment in parseUwFlowAlert, unusual-whales.ts) against
 * ever defaulting an unparseable option side to a fabricated bias — an
 * UNKNOWN-side print stays in unknown_premium, never folded into either side.
 */
export type EcosystemFlowSummary = {
  window_hours: number;
  print_count: number;
  call_premium: number;
  put_premium: number;
  unknown_premium: number;
};

/**
 * HELIX's own FULL flow-tape snapshot for this one ticker — the same shape
 * Largo's `get_flow_tape` tool already returns (run-tool.ts's `get_flow_tape`
 * case calls this exact `getFlowTapeSummary()`), scoped to this ticker via
 * that function's existing `ticker` filter (`src/lib/db.ts::fetchRecentFlows`),
 * not a second hand-rolled aggregate query like `recent_flow` above. Each
 * `recent` row is additionally run through `enrichFlowsWithGex()`
 * (`src/lib/flow-gex-enrichment.ts` — the same enrichment the live
 * member-facing `/flows` route applies) so a print sitting at/near the
 * gamma flip or a call/put wall carries `gex_proximity` here too, not just on
 * the member dashboard.
 *
 * Distinct from `recent_flow` on purpose, not a replacement: `recent_flow` is
 * a deliberately tiny call/put/unknown premium-total aggregate (see its own
 * doc above) that existing consumers (the ecosystem-shadow SPX factor,
 * `EcosystemShadowInput`-style narrow `Pick`s, hand-written assertions in
 * `ecosystem-context.test.ts`) already depend on staying that exact shape —
 * this field is additive, following the same precedent `spx_full_state` set
 * alongside `spx_play` (see that field's doc below for the full "why ADD, not
 * widen/replace" rationale, which applies here identically).
 *
 * Honesty convention: `null` when `getFlowTapeSummary()` finds zero prints for
 * this ticker in-window, mirroring `recent_flow`'s own null-when-quiet
 * ternary — not an all-zero object. `flow_feed_fresh` is still the one signal
 * a caller checks to tell "genuinely quiet" apart from "the pipeline is down
 * and we can't see," exactly as documented on `flow_feed_fresh` below; this
 * field does not get a second, redundant freshness flag of its own.
 */
export type EcosystemFlowFullState = {
  count: number;
  total_premium: number;
  top_tickers: FlowTapeSummary["top_tickers"];
  recent: Array<FlowRow & { gex_proximity?: GexProximityLabel }>;
};

/**
 * Pattern-detected flow anomalies on this ticker (CONCENTRATION,
 * COORDINATED_SWEEP, PREMIUM_SPIKE, PUT_SURGE) from flow_anomalies — written
 * every 30min by the market-regime-detector cron, which already dedups by
 * (anomaly_type, ticker) within a 15-minute window at write time. Distinct
 * signal from recent_flow: that's a raw premium aggregate, this is "the
 * regime detector specifically flagged a pattern here." Already read by
 * Night Hawk's own platform-intel snapshot and the member-facing
 * /api/market/anomalies feed — this is a THIRD consumer, not a new writer.
 */
export type EcosystemAnomaly = {
  anomaly_type: string;
  detected_at: string;
  detail: string;
  severity: string;
  direction: string | null;
};

/**
 * SPX Slayer's own live/recent play-engine state — the one instrument
 * ecosystem-context previously never read (spx_open_play/spx_play_outcomes),
 * even though every other cross-instrument write path (0DTE, Night Hawk,
 * flow/anomalies) was already wired in. Deliberately a single most-recent
 * open + single most-recent closed play, not a history list — same shape
 * precedent as `nighthawk_recent` above, not `recent_audit_entries`'s array.
 */
export type EcosystemSpxOpenPlay = {
  direction: "long" | "short";
  grade: string;
  entry_price: number;
  stop: number | null;
  target: number | null;
  headline: string;
  status: "open" | "closed";
  opened_at: string;
};

export type EcosystemSpxClosedPlay = {
  direction: string;
  grade: string;
  entry_price: number;
  exit_price: number | null;
  pnl_pts: number | null;
  outcome: "open" | "win" | "loss" | "breakeven" | "superseded";
  headline: string;
  closed_at: string | null;
};

export type EcosystemSpxPlay = {
  open_play: EcosystemSpxOpenPlay | null;
  last_closed: EcosystemSpxClosedPlay | null;
};

// Re-exported so a consumer of EcosystemContext can name the spx_full_state
// type without a second import from spx-play-payload.ts.
export type { SpxPlayPayload };

// Re-exported so a consumer of EcosystemContext can name the gex_positioning
// type without a second import from gex-positioning.ts.
export type { GexPositioning };

// Re-exported so a consumer of EcosystemContext can name the vector_full_state
// type without a second import from vector-full-state.ts.
export type { VectorFullState };

export type EcosystemContext = {
  ticker: string;
  zerodte_today: EcosystemZeroDteTake | null;
  nighthawk_recent: EcosystemNightHawkTake | null;
  recent_audit_entries: EcosystemAuditEntry[];
  recent_flow: EcosystemFlowSummary | null;
  recent_anomalies: EcosystemAnomaly[];
  /**
   * HELIX's own FULL flow-tape snapshot for this ticker — the exact same
   * object Largo's `get_flow_tape` tool already returns for this ticker
   * (count, total_premium, top_tickers, and the full `recent` print list),
   * built by calling `src/lib/platform/flow-service.ts::getFlowTapeSummary()`
   * VERBATIM (ticker-scoped via its own existing `ticker` filter — no new
   * query path) and then running the result through the SAME
   * `enrichFlowsWithGex()` (`src/lib/flow-gex-enrichment.ts`) the live
   * member-facing `/flows` route already applies, so each print in `recent`
   * carries `gex_proximity` (at/near the gamma flip, call wall, or put wall)
   * exactly like the member dashboard's own tape does. See
   * `EcosystemFlowFullState`'s doc above for why this is a NEW field
   * alongside `recent_flow` rather than a widened/replaced one — same
   * additive precedent `spx_full_state` set below relative to `spx_play`.
   * `null` when there is no flow for this ticker in-window (mirrors
   * `recent_flow`'s own null-when-quiet convention); `flow_feed_fresh` is
   * still the one signal that disambiguates that from "can't see right now."
   */
  flow_full_state: EcosystemFlowFullState | null;
  /**
   * SPX Slayer's own play-engine state — populated ONLY when `ticker` is
   * "SPX" or "SPXW" (spx_open_play/spx_play_outcomes carry no ticker column
   * at all; this is a single-instrument engine, so every other ticker gets
   * `null` here without a query ever running, mirroring how zerodte_today/
   * nighthawk_recent are scoped to the requested ticker, just via a
   * conditional fetch instead of a WHERE clause since the source tables have
   * nothing to filter on). `null` for a non-SPX ticker is indistinguishable
   * from "SPX but no play exists yet" at the type level on purpose — a caller
   * that cares about the difference already knows its own input ticker.
   */
  spx_play: EcosystemSpxPlay | null;
  /**
   * SPX Slayer's own FULL play-engine snapshot — the exact same object
   * Largo's `get_spx_play` tool already returns (phase, every confluence
   * factor with its weight/detail, full gate pass/fail state including
   * `gates.blocks`/`gates.warnings`/`entry_mode`, the 10-item confirmation
   * checklist result, MTF/RSI/EMA technicals, adaptive-gate telemetry, watch
   * state, the AI arbiter's own verdict object, the option ticket — every
   * field the member dashboard itself renders). Built by calling
   * `src/lib/platform/spx-service.ts::getSpxPlayState()` VERBATIM — the same
   * `loadMergedSpxDesk()` -> `buildPlayTechnicals()` ->
   * `readSpxPlaySnapshot()` (`evaluateSpxPlay(desk, technicals,
   * {mutate:false})`) chain Largo's tool already runs — so there is exactly
   * ONE way this payload is assembled anywhere in the codebase, not a second,
   * independently-drifting derivation.
   *
   * Added alongside `spx_play` (not instead of it) on purpose: `spx_play`'s
   * slim open/last-closed shape is a tested, deliberately-small precedent
   * shared with `nighthawk_recent`, and existing callers of it should see no
   * shape change. This field exists because the user's explicit standing
   * instruction is that SPX Slayer share its ENTIRE data/values/numericals
   * with both BIE and Largo, not just a summary — before this field, BIE's
   * `get_ecosystem_context` tool only ever got the slim mirror while Largo's
   * OWN `get_spx_play` tool already got everything, an asymmetry between two
   * consumers of the same underlying engine state.
   *
   * Same SPX/SPXW-only ticker gate as `spx_play` (see isSpxSlayerTicker) and
   * the same fail-open-to-emptyContext discipline as every other field here —
   * a failure evaluating the live play engine blanks the WHOLE
   * ecosystem-context response, exactly like a failure in
   * fetchSpxPlaySummary already does today; it does not partially degrade to
   * "every other field populated, this one null."
   *
   * Deliberately NOT read by precedent-search's embedding path
   * (`src/lib/bie/precedent-search.ts`): that ingestion embeds
   * `alert_audit_log` rows only (via `describeAuditRow`) and never touches
   * `fetchEcosystemContext()` or any of its fields, slim or full — see the
   * module comment there and its regression test guarding against this
   * field's ~5-10KB JSON ever being folded into a per-alert embedded chunk on
   * every nightly ingest cycle.
   */
  spx_full_state: SpxPlayPayload | null;
  /**
   * Is the live HELIX flow pipeline actually delivering frames right now,
   * cluster-wide (isFlowFrameFreshAnywhere, src/lib/flow-liveness.ts — a
   * Redis heartbeat, not a per-replica in-memory guess)? Exists to disambiguate
   * `recent_flow: null`: that field means EITHER "genuinely no notable flow on
   * this ticker" OR "the ingestion pipeline is down and we simply have no
   * data" — two very different answers to give a member. When this is false,
   * a null/empty recent_flow or recent_anomalies should be reported as
   * "unknown," never as "quiet."
   */
  flow_feed_fresh: boolean;
  /**
   * BlackOut Thermal's own canonical dealer gamma/vanna/delta/charm positioning
   * for this ticker — the exact same object `getGexPositioning(ticker)`
   * (`src/lib/providers/gex-positioning.ts`) already returns for every other
   * reader of it (the Heat Maps UI, the SPX rail's GEX/VEX lens, Night Hawk's
   * `fetchPositioningSummary` primary branch, and Largo's own `get_positioning`
   * tool indirectly, via that same function). Before this field,
   * `get_ecosystem_context` had ZERO gamma/GEX signal at all — "what does the
   * desk know about NVDA" answered SPX play state, HELIX flow, and anomalies,
   * but never mentioned dealer positioning even though Thermal already
   * computes it for that exact ticker on every heatmap poll.
   *
   * Called DIRECTLY (`getGexPositioning(upper)`, no wrapper function) rather
   * than through a `fetchGexPositioningState()` indirection like
   * `fetchFlowFullState()` has: `getGexPositioning` already returns
   * `GexPositioning | null` with the exact honesty convention this field
   * wants (null on a cold/no-data matrix, never fabricated) and needs no
   * extra enrichment/reshaping step the way `flow_full_state` needed
   * `enrichFlowsWithGex()` layered on top of `getFlowTapeSummary()` — a
   * wrapper here would just be `return getGexPositioning(ticker);` with
   * nothing else in it, so it's called inline in the `Promise.all` instead
   * (same reasoning as not wrapping a one-line pass-through).
   *
   * Cost/safety: unlike `spx_full_state`'s SPX/SPXW-only gate, this runs
   * UNCONDITIONALLY for every ticker (GEX positioning is not a
   * single-instrument product the way the SPX play engine is). Safe to do so
   * per `getGexPositioning`'s own module contract: its PRIMARY data comes from
   * a strict CACHE-READER over the shared `gex-heatmap:{ticker}` matrix (never
   * a second upstream fetch), and the one additional step it always performs
   * — cross-validating call wall/put wall/flip against UW's REST strike ladder
   * — is itself 60s-cached and wrapped in `.catch(() => null)`, so it never
   * throws and never blocks on a live upstream call. `null` when the shared
   * matrix is cold (no provider configured, no spot, or zero strikes) for this
   * ticker — mirroring every other field's fail-open-to-null/absent
   * convention here, never a fabricated all-zero reading.
   *
   * Distinct from Largo's standalone `get_positioning` and `get_gex` tools,
   * not a replacement for either: `get_positioning` (`fetchPositioningSummary`,
   * `src/lib/nighthawk/positioning.ts`) hands back a DERIVED, reshaped summary
   * (a `wall_summary` string, a `gamma_regime` string rebuilt from posture,
   * `gex_king_strike`/vanna collapsed to single numbers) — a strict subset,
   * missing DEX/CHARM entirely and `nearest_wall`/`distance_to_flip_pct`.
   * `get_gex` is heavier in a different direction — it returns the raw
   * per-strike chain/matrix rows (or, for SPX/SPXW intraday, the live merged
   * desk snapshot), not this canonical light contract at all. `gex_positioning`
   * sits between the two: the full canonical `GexPositioning` object (posture +
   * one-liner reads for gamma/vanna/delta/charm, walls, flip, max pain,
   * nearest-wall/distance-to-flip, `gex_king_strike`, optional
   * `gex_cross_validation`) without the per-strike granularity `get_gex`
   * carries. Use this instead of a separate `get_positioning` call when the
   * turn already needs this ticker's other ecosystem context too; reach for
   * `get_gex` only when the per-strike/per-expiry chain itself is needed.
   */
  gex_positioning: GexPositioning | null;
  /**
   * Vector's OWN complete live desk state for this ticker — the exact same object
   * Largo's get_vector_full_state tool returns and the Vector desk terminal reads,
   * built by calling `src/lib/bie/vector-full-state.ts::fetchVectorFullState(ticker,
   * "all")` VERBATIM. The Vector analogue of spx_full_state: where spx_full_state /
   * gex_positioning gave BIE the SPX play engine and dealer positioning, this hands
   * BIE Vector's ENTIRE surface for the ticker — spot, regime, gamma walls +
   * integrity, gamma flip, magnet, wall-proximity, options-implied expected move,
   * max pain, confluence zones, the derived concrete play (buildVectorPlay), the full
   * per-strike GEX ladder, a compact heatmap-presence summary, options-flow prints,
   * the wall-history RAIL (the "beads" over the session) and its dynamics events
   * (building/fading/new/gone — the "fadeness"), the VANNA (VEX) lens (walls + flip),
   * and dark-pool levels.
   *
   * Runs UNCONDITIONALLY for every ticker (like gex_positioning, unlike the SPX/SPXW-
   * only spx_full_state) — Vector serves any optionable symbol. `null` when
   * fetchVectorFullState has no live spot for the ticker (its own honest no-surface
   * convention), never fabricated. Same one-derivation guarantee as the other
   * full-state fields: whatever get_vector_full_state returns is exactly what this
   * returns. Not embedded into precedent-search, same as spx_full_state (large
   * per-ticker numeric object, not prose).
   */
  vector_full_state: VectorFullState | null;
};

/**
 * Machine-readable mirror of the field docs above — the single thing
 * knowledge.ts's generated `platform:bie-capabilities` doc reads to describe
 * fetchEcosystemContext()'s shape, so a future field addition here (like
 * flow_feed_fresh was) shows up in BIE's own self-description automatically
 * instead of requiring a second, easily-forgotten prose edit in
 * docs/bie/ARCHITECTURE.md.
 *
 * Keyed by `Record<..., string>` rather than a plain array on purpose: adding a
 * field to EcosystemContext without adding it here is a `tsc` compile error
 * (missing key), and a typo'd key is also a compile error (excess property) —
 * the exact class of drift this whole mechanism exists to prevent is caught at
 * build time, not just hoped to be remembered.
 */
const ECOSYSTEM_CONTEXT_FIELD_DESCRIPTIONS: Record<Exclude<keyof EcosystemContext, "ticker">, string> = {
  zerodte_today: "Today's 0DTE Command take for this ticker (direction, score, conviction, status), if any.",
  nighthawk_recent: "Most recent PUBLISHED Night Hawk take — a rejected play never appears here, only as a nighthawk_rejected row in recent_audit_entries.",
  recent_audit_entries: "Last 10 alert_audit_log rows for this ticker — the unified audit trail across all three write-paths (0DTE, Night Hawk published, Night Hawk rejected).",
  recent_flow: "Same-day HELIX call/put/unknown-side premium totals (6h window), reported neutrally — never collapsed into a fabricated bullish/bearish label.",
  flow_full_state: "HELIX's FULL flow-tape snapshot for this ticker — the exact same object Largo's get_flow_tape tool returns (count, total_premium, top_tickers, and the full recent print list), each print additionally carrying gex_proximity from the same enrichFlowsWithGex() the live /flows route applies. Added alongside recent_flow (not instead of it) — recent_flow's slim call/put/unknown premium totals stay unchanged for existing consumers. Null when there is no flow for this ticker in-window; check flow_feed_fresh to tell that apart from the pipeline being down.",
  recent_anomalies: "Pattern-detected flow anomalies (concentration, coordinated sweep, premium spike, put surge) from the last 24h.",
  spx_play: "SPX Slayer's own play-engine state — the current open play (if any) and the most recently closed play. Only populated for ticker SPX/SPXW (spx_open_play/spx_play_outcomes have no ticker column, single-instrument engine); null for every other ticker.",
  spx_full_state: "SPX Slayer's FULL play-engine snapshot — the exact same object Largo's get_spx_play tool returns (phase, every confluence factor, full gate pass/fail state, the 10-item confirmation checklist, MTF/RSI/EMA technicals, adaptive-gate telemetry, watch state, the AI arbiter's verdict, the option ticket). Only populated for ticker SPX/SPXW; null for every other ticker. Sourced from the SAME getSpxPlayState() Largo's tool calls — one derivation, not two.",
  flow_feed_fresh: "Whether the live HELIX flow pipeline is actually delivering frames right now, cluster-wide — disambiguates a null/empty recent_flow or recent_anomalies as 'unknown' rather than 'genuinely quiet'.",
  gex_positioning: "BlackOut Thermal's canonical dealer gamma/vanna/delta/charm positioning for this ticker — the exact same object getGexPositioning() returns for the Heat Maps UI, the SPX rail, and Night Hawk's positioning read (spot, flip, call/put wall, max pain, gex_king_strike, net GEX/VEX/DEX/CHARM with posture + regime-read one-liners, nearest_wall, distance_to_flip_pct, optional UW cross-validation). Runs for EVERY ticker, not gated to SPX/SPXW like spx_full_state — GEX positioning isn't a single-instrument product. Distinct from get_positioning (a reshaped, DEX/CHARM-less summary) and get_gex (the raw per-strike chain) — this is the full canonical light contract, in between the two. Null when the shared GEX matrix is cold for this ticker.",
  vector_full_state: "Vector's OWN complete live desk state for this ticker — the exact same object Largo's get_vector_full_state tool returns (via fetchVectorFullState(ticker, \"all\")): spot, regime, gamma walls + integrity, gamma flip, magnet, wall-proximity, options-implied expected move, max pain, confluence zones, the derived concrete play (buildVectorPlay), the full per-strike GEX ladder, a compact heatmap-presence summary, options-flow prints, the wall-history rail (the 'beads' over the session) + its dynamics events (building/fading/new/gone — the 'fadeness'), the VANNA (VEX) lens (walls + flip), and dark-pool levels. The Vector analogue of spx_full_state; runs for EVERY ticker (Vector serves any optionable symbol), not gated to SPX/SPXW. Null when there's no live spot for the ticker. One derivation — identical to get_vector_full_state.",
};

export const ECOSYSTEM_CONTEXT_FIELDS: { field: string; description: string }[] = Object.entries(
  ECOSYSTEM_CONTEXT_FIELD_DESCRIPTIONS
).map(([field, description]) => ({ field, description }));

function emptyContext(ticker: string): EcosystemContext {
  return {
    ticker: ticker.toUpperCase(),
    zerodte_today: null,
    nighthawk_recent: null,
    recent_audit_entries: [],
    recent_flow: null,
    flow_full_state: null,
    recent_anomalies: [],
    spx_play: null,
    spx_full_state: null,
    flow_feed_fresh: false,
    gex_positioning: null,
    vector_full_state: null,
  };
}

const FLOW_SUMMARY_WINDOW_HOURS = 6;
const ANOMALY_WINDOW_HOURS = 24;

/** SPX Slayer trades exactly one instrument; spx_open_play/spx_play_outcomes
 *  carry no ticker column to filter on, so scoping is a plain ticker-string
 *  check rather than a SQL WHERE clause (see EcosystemContext.spx_play doc). */
function isSpxSlayerTicker(upperTicker: string): boolean {
  return upperTicker === "SPX" || upperTicker === "SPXW";
}

/** Reuses the exact same fetchers already used by src/lib/platform/spx-service.ts
 *  (getSpxOpenPlay / getSpxTradeHistory) — no new SQL, no new write path. Only
 *  called when the ticker is SPX/SPXW; see isSpxSlayerTicker. */
async function fetchSpxPlaySummary(): Promise<EcosystemSpxPlay> {
  const [openPlay, closedRows] = await Promise.all([
    fetchOpenSpxPlay(todayEtYmd()),
    fetchClosedPlayOutcomes(1),
  ]);
  const lastClosed = closedRows[0] ?? null;
  return {
    open_play: openPlay
      ? {
          direction: openPlay.direction,
          grade: openPlay.grade,
          entry_price: openPlay.entry_price,
          stop: openPlay.stop,
          target: openPlay.target,
          headline: openPlay.headline,
          status: openPlay.status,
          opened_at: openPlay.opened_at,
        }
      : null,
    last_closed: lastClosed
      ? {
          direction: lastClosed.direction,
          grade: lastClosed.grade,
          entry_price: lastClosed.entry_price,
          exit_price: lastClosed.exit_price,
          pnl_pts: lastClosed.pnl_pts,
          outcome: lastClosed.outcome,
          headline: lastClosed.headline,
          closed_at: lastClosed.closed_at,
        }
      : null,
  };
}

/** Reuses src/lib/platform/spx-service.ts::getSpxPlayState() VERBATIM — the
 *  exact function backing Largo's own get_spx_play tool (loadMergedSpxDesk()
 *  -> buildPlayTechnicals() -> readSpxPlaySnapshot() -> evaluateSpxPlay(desk,
 *  technicals, {mutate:false})). No second derivation of the play-engine
 *  snapshot: whatever get_spx_play returns is exactly what spx_full_state
 *  returns, for the same ticker gate as fetchSpxPlaySummary (see
 *  isSpxSlayerTicker). mutate:false means this never writes play state, never
 *  fires Discord, and never advances the play-engine heartbeat — safe to call
 *  from a read-only context query. */
async function fetchSpxFullState(): Promise<SpxPlayPayload> {
  return getSpxPlayState();
}

// Matches Largo's get_flow_tape tool-def default (tool-defs.ts) — one ticker's
// full recent tape, not the whole platform's.
const FLOW_FULL_STATE_LIMIT = 50;

/**
 * Reuses src/lib/platform/flow-service.ts::getFlowTapeSummary() VERBATIM,
 * ticker-scoped via its own existing `ticker` option (fetchRecentFlows'
 * `WHERE ticker = $1`, src/lib/db.ts) — the exact function backing Largo's
 * own `get_flow_tape` tool (run-tool.ts's `get_flow_tape` case). No second,
 * independently-drifting tape query: this is the same class of "one
 * derivation, not two" reuse fetchSpxFullState above applies to the play
 * engine.
 *
 * Every returned row is then run through enrichFlowsWithGex()
 * (src/lib/flow-gex-enrichment.ts) — the same enrichment the live
 * member-facing `/flows` route (src/app/api/market/flows/route.ts) already
 * applies to attach `gex_proximity`. Cheap and bounded to call on every
 * fetchEcosystemContext() invocation, unlike spx_full_state's SPX/SPXW-only
 * gate: enrichFlowsWithGex fans out to at most 1 unique ticker here (the rows
 * are already ticker-scoped by the getFlowTapeSummary call above), and that
 * one lookup races a 300ms timeout against a 60s in-memory cache
 * (getGexLevelsForTicker) and never rejects — every internal failure there
 * resolves to a plain pass-through row, not a thrown error — so this adds no
 * new failure mode to the outer Promise.all beyond the DB query
 * getFlowTapeSummary already performs.
 *
 * Returns null when there is no flow for this ticker in-window, mirroring
 * recent_flow's own null-when-quiet ternary below (see EcosystemFlowFullState's
 * doc for why this is the honest choice over an all-zero object).
 */
async function fetchFlowFullState(ticker: string): Promise<EcosystemFlowFullState | null> {
  const summary = await getFlowTapeSummary({ ticker, limit: FLOW_FULL_STATE_LIMIT });
  if (summary.count === 0) return null;
  const recent = await enrichFlowsWithGex(summary.recent);
  return {
    count: summary.count,
    total_premium: summary.total_premium,
    top_tickers: summary.top_tickers,
    recent,
  };
}

/**
 * Assembles a single ticker's cross-instrument snapshot from tables that
 * already exist: today's 0DTE Command take (if any), the most recent
 * PUBLISHED Night Hawk take from nighthawk_play_outcomes (a play rejected at
 * the trade-geometry gate is never written to that table — see
 * buildNighthawkRejectedAuditRow's doc comment in play-outcomes.ts — so a
 * rejection shows up only in recent_audit_entries below, as an
 * "nighthawk_rejected" alert_type, never here), the last 10
 * alert_audit_log entries (the unified Stage 4 trail, which already spans all
 * three write-paths), a same-day HELIX flow summary straight from
 * flow_alerts — not just the $1M+ whale tier that reaches alert_audit_log, the
 * full tape for this one ticker — HELIX's own FULL flow-tape snapshot
 * (flow_full_state — via the SAME getFlowTapeSummary() Largo's own
 * get_flow_tape tool already calls, GEX-enriched via the same
 * enrichFlowsWithGex() the live /flows route uses — see fetchFlowFullState's
 * doc), any pattern-detected flow anomalies
 * (flow_anomalies, written by the market-regime-detector cron), SPX Slayer's
 * own open/last-closed play state (spx_play — SPX/SPXW only, via the same
 * fetchOpenSpxPlay/fetchClosedPlayOutcomes db.ts fetchers spx-service.ts
 * already uses, no new query path), SPX Slayer's own FULL play-engine
 * snapshot (spx_full_state — SPX/SPXW only, via the SAME getSpxPlayState()
 * Largo's own get_spx_play tool already calls — see fetchSpxFullState's doc),
 * BlackOut Thermal's own canonical dealer gamma/vanna/delta/charm positioning
 * for this ticker (gex_positioning — via the SAME getGexPositioning() every
 * other reader of it already calls: Heat Maps UI, the SPX rail, Night Hawk's
 * positioning read; unconditional for every ticker, not SPX/SPXW-gated — see
 * gex_positioning's doc for its distinction from Largo's own get_positioning/
 * get_gex tools), and whether
 * the live flow pipeline is actually up right now (flow_feed_fresh), so a
 * caller can tell "genuinely quiet" apart from "we can't see, ingestion is
 * down." Fails open to an all-empty context on any error — a lookup failure
 * here must never block
 * the caller's own logic.
 */
export async function fetchEcosystemContext(ticker: string): Promise<EcosystemContext> {
  if (!dbConfigured() || !ticker.trim()) return emptyContext(ticker);
  const upper = ticker.toUpperCase().trim();

  try {
    const [zerodteRes, nighthawkRes, auditRes, flowRes, flowFullState, anomalyRes, flowFeedFresh, spxPlay, spxFullState, gexPositioning, vectorFullState] = await Promise.all([
      dbQuery<{
        session_date: string;
        direction: string;
        score: number;
        conviction: string | null;
        status: string | null;
        first_flagged_at: string;
      }>(
        `SELECT session_date, direction, score, conviction, status, first_flagged_at
         FROM zerodte_setup_log
         WHERE ticker = $1 AND session_date = $2`,
        [upper, todayEtYmd()]
      ),
      dbQuery<{
        edition_for: string;
        direction: string;
        conviction: string;
        outcome: string;
        score: number | null;
      }>(
        `SELECT edition_for, direction, conviction, outcome, score
         FROM nighthawk_play_outcomes
         WHERE ticker = $1
         ORDER BY edition_for DESC
         LIMIT 1`,
        [upper]
      ),
      dbQuery<{
        alert_type: string;
        fired_at: string;
        confidence_label: string | null;
        trigger_reason: string | null;
        outcome: string | null;
      }>(
        `SELECT alert_type, fired_at, confidence_label, trigger_reason, outcome
         FROM alert_audit_log
         WHERE ticker = $1
         ORDER BY fired_at DESC
         LIMIT 10`,
        [upper]
      ),
      dbQuery<{ print_count: number; call_premium: number; put_premium: number; unknown_premium: number }>(
        `SELECT
           COUNT(*)::int AS print_count,
           COALESCE(SUM(total_premium) FILTER (WHERE option_type = 'CALL'), 0)::numeric AS call_premium,
           COALESCE(SUM(total_premium) FILTER (WHERE option_type = 'PUT'), 0)::numeric AS put_premium,
           COALESCE(SUM(total_premium) FILTER (WHERE option_type NOT IN ('CALL', 'PUT')), 0)::numeric AS unknown_premium
         FROM flow_alerts
         WHERE ticker = $1 AND created_at >= NOW() - ($2 || ' hours')::interval`,
        [upper, FLOW_SUMMARY_WINDOW_HOURS]
      ),
      fetchFlowFullState(upper),
      dbQuery<{ anomaly_type: string; detected_at: string; detail: string; severity: string; direction: string | null }>(
        `SELECT anomaly_type, detected_at, detail, severity, direction
         FROM flow_anomalies
         WHERE ticker = $1 AND detected_at >= NOW() - ($2 || ' hours')::interval
         ORDER BY detected_at DESC
         LIMIT 5`,
        [upper, ANOMALY_WINDOW_HOURS]
      ),
      isFlowFrameFreshAnywhere(),
      isSpxSlayerTicker(upper) ? fetchSpxPlaySummary() : Promise.resolve(null),
      isSpxSlayerTicker(upper) ? fetchSpxFullState() : Promise.resolve(null),
      // Unconditional, unlike the two SPX-only fetches above — GEX positioning
      // isn't a single-instrument product. Called directly (no wrapper): see
      // gex_positioning's doc on EcosystemContext for why getGexPositioning()
      // already returns exactly the shape/honesty-convention this field wants.
      getGexPositioning(upper),
      // Vector's ENTIRE live desk state for this ticker — also unconditional (Vector
      // serves any optionable symbol). fetchVectorFullState is itself fail-open (returns
      // null on no spot / any read failure and never throws), but wrap in .catch anyway
      // so it can never reject the whole ecosystem fan-out. The horizon is "all" — the
      // whole-chain view — matching get_vector_full_state's default.
      fetchVectorFullState(upper, "all").catch(() => null),
    ]);

    const z = zerodteRes.rows[0];
    const n = nighthawkRes.rows[0];
    const f = flowRes.rows[0];

    return {
      ticker: upper,
      zerodte_today: z
        ? {
            session_date: String(z.session_date),
            direction: z.direction,
            score: Number(z.score),
            conviction: z.conviction,
            status: z.status,
            first_flagged_at: String(z.first_flagged_at),
          }
        : null,
      nighthawk_recent: n
        ? {
            edition_for: String(n.edition_for),
            direction: n.direction,
            conviction: n.conviction,
            outcome: n.outcome,
            score: n.score != null ? Number(n.score) : null,
          }
        : null,
      recent_audit_entries: auditRes.rows.map((r) => ({
        alert_type: r.alert_type,
        fired_at: String(r.fired_at),
        confidence_label: r.confidence_label,
        trigger_reason: r.trigger_reason,
        outcome: r.outcome,
      })),
      recent_flow:
        f && f.print_count > 0
          ? {
              window_hours: FLOW_SUMMARY_WINDOW_HOURS,
              print_count: Number(f.print_count),
              call_premium: Number(f.call_premium),
              put_premium: Number(f.put_premium),
              unknown_premium: Number(f.unknown_premium),
            }
          : null,
      flow_full_state: flowFullState,
      recent_anomalies: anomalyRes.rows.map((a) => ({
        anomaly_type: a.anomaly_type,
        detected_at: String(a.detected_at),
        detail: a.detail,
        severity: a.severity,
        direction: a.direction,
      })),
      spx_play: spxPlay,
      spx_full_state: spxFullState,
      flow_feed_fresh: flowFeedFresh,
      gex_positioning: gexPositioning,
      vector_full_state: vectorFullState,
    };
  } catch {
    return emptyContext(ticker);
  }
}

// --- Batched Night Hawk echo for a ticker list (board-annotation use case) --

export type EcosystemNighthawkEchoRow = {
  ticker: string;
  edition_for: string;
  direction: string;
  conviction: string;
  outcome: string;
  score: number | null;
};

/** Pure: raw DISTINCT-ON rows -> ticker -> most-recent-take map. Split out from
 *  the query so the shape logic is unit-testable without a DB connection. */
export function mapNighthawkEchoRows(rows: EcosystemNighthawkEchoRow[]): Map<string, EcosystemNightHawkTake> {
  const out = new Map<string, EcosystemNightHawkTake>();
  for (const r of rows) {
    out.set(r.ticker.toUpperCase(), {
      edition_for: String(r.edition_for),
      direction: r.direction,
      conviction: r.conviction,
      outcome: r.outcome,
      score: r.score != null ? Number(r.score) : null,
    });
  }
  return out;
}

/**
 * One batched query for a whole ticker list — the board-annotation use case
 * (e.g. "does the 0DTE ledger have any names Night Hawk already picked?").
 * Deliberately a single ANY($1) query instead of one fetchEcosystemContext()
 * call per ticker: a board can carry a couple dozen ledger rows and this runs
 * on every poll, so N sequential/parallel per-ticker round trips would scale
 * query count with ledger size for no benefit — one query returns the same
 * answer for every ticker at once. Fails open to an empty map: a caller must
 * render exactly as it did before this existed if the lookup fails.
 */
export async function fetchNighthawkEchoForTickers(tickers: string[]): Promise<Map<string, EcosystemNightHawkTake>> {
  const upperTickers = [...new Set(tickers.map((t) => t.toUpperCase().trim()).filter(Boolean))];
  if (!dbConfigured() || upperTickers.length === 0) return new Map();

  try {
    const res = await dbQuery<EcosystemNighthawkEchoRow>(
      `SELECT DISTINCT ON (ticker) ticker, edition_for, direction, conviction, outcome, score
       FROM nighthawk_play_outcomes
       WHERE ticker = ANY($1::text[])
       ORDER BY ticker, edition_for DESC`,
      [upperTickers]
    );
    return mapNighthawkEchoRows(res.rows);
  } catch {
    return new Map();
  }
}

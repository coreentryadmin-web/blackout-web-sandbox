/**
 * FLOW-GEX LENS — the flow-based dealer-positioning ladder (Skylit parity), offered as a SECOND
 * GEX signing mode ALONGSIDE our canonical OI-based ladder (which stays the default and is untouched).
 *
 * The canonical `oi` lens signs each strike statically by option type — calls add positive gamma,
 * puts negative — and weights by OPEN INTEREST (`sign · γ · OI · 100 · S² · 0.01`). It answers
 * "what's positioned". This `flow` lens answers a different question — "which way did TODAY'S
 * trading push dealers" — and signs each strike by DIRECTIONAL TRADED FLOW instead of option type:
 *
 *   Dealer is SHORT what customers BOUGHT (lifted the ASK) and LONG what customers SOLD (hit the
 *   BID). UW's `spot-exposures/strike` already decomposes per-strike gamma by trade side and signs
 *   the pieces for us: `*_gamma_bid` is POSITIVE (customer sold at bid → dealer bought → dealer LONG
 *   γ) and `*_gamma_ask` is NEGATIVE (customer bought at ask → dealer sold → dealer SHORT γ). So the
 *   net flow-implied dealer gamma at a strike is simply the sum over calls and puts of the bid and
 *   ask pieces. That single modelling choice — flow sign vs OI sign — is the entire reason a
 *   call-open-interest-heavy strike that saw heavy call BUYING reads DEEPLY NEGATIVE here but
 *   positive under `oi`.
 *
 * This was reverse-engineered against a live Skylit $FIG board: the flow model reproduced Skylit's
 * SIGN pattern on 5 of 6 published strikes and nailed the dominant −GEX peak (strike 28) to within
 * ~1% (see docs/audit/FINDINGS.md — FLOW-GEX LENS). The magnitude is a standard dollar-gamma
 * notional in the same family as canonical — UW's exposure fields already carry the ×100 × spot
 * notional, so no extra scaling is applied here.
 *
 * PURE and dependency-free: it takes the raw UW `spot-exposures/strike` rows and returns the SAME
 * `{strike: netGex}` shape `buildGexLadder` consumes, so the dense ladder rendering (kings, markers,
 * ordering, banding) is shared with the canonical path — only the per-strike SIGN + magnitude source
 * differs. The server shell (fetch + spot) lives in `vector-flow-gex-server.ts`.
 */

/** One raw UW `spot-exposures/strike` row (fields are string-encoded numbers from the vendor). */
export type FlowExposureRow = Record<string, unknown>;

export type FlowGexLadder = {
  /** `{strike: netFlowGex}` — the exact shape `buildGexLadder` consumes. */
  strikeTotals: Record<string, number>;
  /** Snapshot spot carried on the exposure rows (`price` field), or null when absent. */
  spot: number | null;
};

/** Coerce a vendor string/number field to a finite number (0 for null/blank/NaN). */
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Build the flow-signed `{strike: netGex}` ladder from UW `spot-exposures/strike` rows.
 *
 * Net per strike = Σ(call_gamma_bid + call_gamma_ask + put_gamma_bid + put_gamma_ask) — UW already
 * signs bid + / ask −, so this sum IS the flow-implied dealer gamma (positive = dealer long γ /
 * call-side resistance behaviour; negative = dealer short γ / put-side support behaviour), matching
 * the same sign convention `buildGexLadder`/`computeGexWalls` use for the OI ladder.
 *
 * The endpoint returns ONE row per strike already summed across all expiries, which matches the
 * all-expiry aggregate the Skylit fit used (near-term-only did not improve the fit). Returns an
 * empty ladder (never throws) for missing/empty input so the route can render a graceful empty state.
 */
export function computeFlowGexLadder(rows: readonly FlowExposureRow[] | null | undefined): FlowGexLadder {
  if (!rows || rows.length === 0) return { strikeTotals: {}, spot: null };

  const strikeTotals: Record<string, number> = {};
  let spot: number | null = null;

  for (const r of rows) {
    const strike = Number(r["strike"]);
    if (!Number.isFinite(strike) || strike <= 0) continue;

    // Flow-signed dealer gamma from the bid/ask trade-side decomposition (see file header).
    const net =
      num(r["call_gamma_bid"]) +
      num(r["call_gamma_ask"]) +
      num(r["put_gamma_bid"]) +
      num(r["put_gamma_ask"]);

    const key = String(strike);
    strikeTotals[key] = (strikeTotals[key] ?? 0) + net;

    // Carry the snapshot spot from the first row that has a usable price so the ladder can band /
    // centre exactly like the OI path (the server shell prefers the live spot when available).
    if (spot == null) {
      const p = Number(r["price"]);
      if (Number.isFinite(p) && p > 0) spot = p;
    }
  }

  return { strikeTotals, spot };
}

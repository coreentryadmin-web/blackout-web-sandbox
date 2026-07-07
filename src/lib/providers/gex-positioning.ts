import "server-only";

import { fetchGexHeatmap, type GexHeatmap } from "@/lib/providers/polygon-options-gex";
import { getGexIntradayAdjusted } from "@/lib/providers/gex-intraday-adjust";
import type { GexIntradayAdjusted } from "@/lib/providers/gex-intraday-adjust-core";
import { validateGexAgainstUW, type GexCrossValidationResult } from "@/lib/providers/gex-cross-validation";
import { resolveNearTermExpiriesForCrossValidation } from "@/lib/providers/gex-cross-validation-core";
import { fmtPremium } from "@/lib/fmt-money";

// ---------------------------------------------------------------------------
// Canonical cross-tool GEX/VEX positioning contract.
//
// This is the ONE source every other tool/service/AI surface consumes for the
// Heat Maps dealer-positioning data. It is a strict CACHE-READER over the shared
// `fetchGexHeatmap(ticker)` matrix (the same `gex-heatmap:{ticker}` cache the
// Heat Maps UI reads) — it NEVER hits a second upstream and NEVER touches the
// UW 2-RPS overlay budget. Missing data is null / omitted, never fabricated.
//
// Consumers import the TYPE freely (client or server); the runtime accessors are
// server-only (this file imports "server-only", so a client runtime import throws).
// ---------------------------------------------------------------------------

/** Dealer gamma posture relative to the zero-gamma flip. Mirrors gex.regime.posture. */
export type GammaPosture = "long" | "short" | null;
/** Dealer vanna posture (net dollar-vanna sign). Mirrors vex.regime.posture. */
export type VannaPosture = "positive" | "negative" | null;
/** Dealer delta posture: 'long' = net long delta (stabilizing), 'short' = net short (destabilizing). Mirrors dex.regime.posture. */
export type DeltaPosture = "long" | "short" | null;
/** Dealer charm posture: 'positive' = pins upward, 'negative' = drags downward. Mirrors charm.regime.posture. */
export type CharmPosture = "positive" | "negative" | null;

/**
 * The canonical light positioning contract for one ticker. Every field is derived
 * ONLY from the shared GEX heatmap matrix — never recomputed over a different chain
 * band. `null` on any field means "not determinable from the current matrix", never
 * a fabricated value.
 */
export type GexPositioning = {
  /** Normalized underlying root (e.g. "SPY", "SPX"). */
  ticker: string;
  /** Live spot for the underlying. Always > 0 when the object is non-null. */
  spot: number;
  /** Day change %, signed. */
  change_pct: number;
  /** ISO timestamp the underlying matrix was computed. */
  asof: string;
  /** Zero-gamma flip strike, or null when undetermined. */
  flip: number | null;
  /** Largest-positive net-gamma strike (resistance / pin), or null. */
  call_wall: number | null;
  /** Largest-negative net-gamma strike (support), or null. */
  put_wall: number | null;
  /** Max-pain strike, or null. */
  max_pain: number | null;
  /** Argmax |net-gamma| strike across the matrix (the "GEX king" node) — distinct from
   *  call_wall/put_wall, which are the largest-POSITIVE and largest-NEGATIVE strikes
   *  separately; the king can be either sign, whichever magnitude is largest. Null when
   *  the matrix has no strikes. */
  gex_king_strike: number | null;
  /** Net dealer dollar-GAMMA across the matrix (signed). */
  net_gex: number;
  /** Dealer gamma posture vs flip: 'long' at/above flip, 'short' below, null undetermined. */
  gamma_posture: GammaPosture;
  /** One-liner gamma regime read (always a string; neutral when data is thin). */
  gamma_regime_read: string;
  /** Net dealer dollar-VANNA across the matrix (signed). */
  net_vex: number;
  /** Dealer vanna posture: 'positive' | 'negative' | null. */
  vanna_posture: VannaPosture;
  /** One-liner vanna regime read (always a string; neutral when data is thin). */
  vanna_regime_read: string;
  /**
   * Net dealer dollar-DELTA across the matrix (signed). Positive = dealers net long delta
   * (stabilizing / mean-reverting); negative = net short delta (trend-amplifying / destabilizing).
   * Null when the matrix predates DEX computation (optional field on GexHeatmap).
   */
  net_dex: number | null;
  /** Dealer delta posture: 'long' (stabilizing) | 'short' (destabilizing) | null. */
  dex_posture: DeltaPosture;
  /** One-liner delta regime read, or null when DEX data is absent. */
  dex_regime_read: string | null;
  /**
   * Net dealer dollar-CHARM across the matrix (signed). Positive = delta-decay hedging pins price
   * upward toward heavy strikes; negative = drags downward. Null when absent from matrix.
   */
  net_charm: number | null;
  /** Dealer charm posture: 'positive' (pins up) | 'negative' (drags down) | null. */
  charm_posture: CharmPosture;
  /** One-liner charm / pinning regime read, or null when CHARM data is absent. */
  charm_regime_read: string | null;
  /** Closer of call/put wall to spot, classified resistance/support, with point distance — or null. */
  nearest_wall: {
    strike: number;
    kind: "resistance" | "support";
    distance_pts: number;
  } | null;
  /** Signed % distance of spot from the flip: (spot - flip)/spot*100, or null when no flip. */
  distance_to_flip_pct: number | null;
  /** Intraday gamma-migration one-liner when a real diff exists, else null. */
  shift_summary: string | null;
  /**
   * 0DTE / FRONT-EXPIRY INTRADAY-ADJUSTED view (OI + volume model) — an ESTIMATE that ADDS today's
   * not-yet-settled front-expiry net dealer positioning (signed buy-vs-sell from the trade tape) on
   * top of the canonical OI base above. ADDITIVE + clearly LABELED — the canonical OI fields
   * (`net_gex` / `flip` / `call_wall` / `put_wall`) are NEVER overwritten by it. `null` when the
   * adjusted view can't be built (cold matrix / no front expiry / no flow) — never fabricated.
   * Populated only by `getGexPositioning`; the pure `gexPositioningFromHeatmap` mapper leaves it
   * undefined (it has no flow input), so existing matrix-vs-positioning checks are unaffected.
   */
  gex_intraday_adjusted?: GexIntradayAdjusted | null;
  /**
   * Cross-validation of the primary GEX key levels (call wall / put wall / gamma flip) against
   * the UW per-strike dealer gamma ladder (`gex_strike_expiry` WS when fresh, else REST
   * `/api/stock/{ticker}/spot-exposures/strike` cached 60s).
   * Populated only by `getGexPositioning` when UW data is available. `null` when UW is
   * unavailable or the primary matrix was cold — never blocks the primary data path.
   */
  gex_cross_validation?: GexCrossValidationResult | null;
  /** Provenance — always the shared Polygon/Massive GEX matrix. */
  source: "polygon";
};

/**
 * Argmax |net-gamma| strike — the GEX "king" node. Same algorithm as the sibling
 * implementations in src/lib/correctness/gex-odte-scope.ts, src/lib/providers/spx-desk.ts,
 * and src/lib/nights-watch/position-detail.ts (pre-existing duplication, not introduced by
 * this fix — flagged in docs/audit/FINDINGS.md as a follow-up consolidation candidate, out
 * of scope for this bug fix). Kept local here rather than importing from correctness/ to
 * avoid a providers/ -> correctness/ dependency running the wrong direction.
 */
function kingFromStrikeTotals(strikeTotals: Record<string, number>): number | null {
  let king: number | null = null;
  let maxAbs = -1;
  for (const [s, gRaw] of Object.entries(strikeTotals)) {
    const strike = Number(s);
    const g = Number(gRaw);
    if (!Number.isFinite(strike) || !Number.isFinite(g)) continue;
    if (Math.abs(g) > maxAbs) {
      maxAbs = Math.abs(g);
      king = strike;
    }
  }
  return king;
}

/** Clean strike / level number (no trailing zeros, max 2 decimals). */
function fmtNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * Resolve the canonical positioning contract for `ticker`.
 *
 * CACHE-READER: calls `fetchGexHeatmap(ticker)` with NO forceRefresh → reads the
 * shared `gex-heatmap:{ticker}` cache (in-memory + Redis). It NEVER calls
 * fetchPolygonPositioningBundle or any second upstream, and NEVER fetches overlays
 * (UW flow / dark-pool), so it can't pressure the 2-RPS UW budget.
 *
 * Returns null when the matrix is cold/empty (no provider, no spot, or no strikes) —
 * cold data emits nothing rather than a fabricated read.
 */
export async function getGexPositioning(
  ticker: string,
  opts: { includeIntradayAdjusted?: boolean } = {}
): Promise<GexPositioning | null> {
  const root = String(ticker ?? "").trim().toUpperCase();
  if (!root) return null;

  const hm = await fetchGexHeatmap(root).catch(() => null);
  const base = gexPositioningFromHeatmap(root, hm);
  if (!base) return null;

  // The base contract stays LIGHT by default (pure cache-reader, no extra upstream) so the many
  // consumers that rely on the documented light guarantee (desk / Largo / Night's Watch / the
  // gex-positioning route) are unchanged. The 0DTE intraday-adjusted lens is OPT-IN — only when a
  // caller explicitly asks does it spend the bounded Trades tape + one front-expiry gamma band.
  // Best-effort + bounded: a failure leaves the field null; the canonical OI fields are never
  // affected. The pure mapper has no flow input, so matrix-vs-positioning checks stay like-for-like.
  // Cross-validate primary key levels against UW REST strike ladder (best-effort, non-blocking).
  // Cached 60s — safe on every call without touching the 2 RPS UW REST budget.
  //
  // base.call_wall/put_wall/flip are computed from Polygon's NEAR-TERM-ONLY expiries —
  // scoping the UW oracle side to match is required, or the two sides compare different
  // questions and can show hundreds of points of spurious "divergence" for SPX around
  // monthly/quarterly OpEx (confirmed live 2026-07-01 — see docs/audit/FINDINGS.md). See
  // resolveNearTermExpiriesForCrossValidation()'s doc comment for why this must read
  // `hm.near_term_expiries`, not a bare `hm.expiries.slice(0, 8)`.
  const nearTermExpiries = resolveNearTermExpiriesForCrossValidation(hm);
  const crossValidation = await validateGexAgainstUW(
    root,
    {
      callWall: base.call_wall,
      putWall: base.put_wall,
      gammaFlip: base.flip,
    },
    { spot: base.spot, nearTermExpiries }
  ).catch(() => null);

  if (crossValidation) {
    const div = crossValidation.divergence;
    if (div != null && div > 5) {
      console.warn(
        `[gex-positioning] cross-validation divergence for ${root}: ` +
          `callWallMatch=${crossValidation.callWallMatch} putWallMatch=${crossValidation.putWallMatch} ` +
          `flipMatch=${crossValidation.flipMatch} divergence=${div}pt vs UW strike ladder`
      );
    }
  }

  if (!opts.includeIntradayAdjusted) return { ...base, gex_cross_validation: crossValidation };
  const intraday = await getGexIntradayAdjusted(root).catch(() => null);
  return { ...base, gex_cross_validation: crossValidation, gex_intraday_adjusted: intraday };
}

/**
 * PURE mapper: derive the canonical positioning contract from an ALREADY-FETCHED matrix snapshot —
 * NO upstream call, NO cache read. This is the exact derivation `getGexPositioning` applies; that
 * function is now just `fetchGexHeatmap → this`. Exposed so a caller that ALREADY holds the matrix
 * (e.g. the data-correctness verifier comparing positioning vs the matrix) can compare the contract
 * against the SAME snapshot it derives from — a TEMPORAL-IMMUNE, like-for-like check that still
 * catches a real derivation bug (a field copied from the wrong place) but never cries wolf over a
 * cache-TTL refresh landing between two fetches. Returns null on a cold/empty/no-spot matrix.
 */
export function gexPositioningFromHeatmap(
  ticker: string,
  hm: GexHeatmap | null
): GexPositioning | null {
  const root = String(ticker ?? "").trim().toUpperCase();
  if (!root) return null;
  // Cold / empty matrix → no honest positioning to report. Never fabricate.
  if (!hm || !(hm.spot > 0) || hm.strikes.length === 0) return null;

  const spot = hm.spot;
  const gex = hm.gex;
  const vex = hm.vex;
  const dex = hm.dex ?? null;
  const charm = hm.charm ?? null;
  const flip = gex.flip;
  const callWall = gex.call_wall;
  const putWall = gex.put_wall;

  // nearest_wall: the wall (call=resistance / put=support) closest to spot.
  let nearest: GexPositioning["nearest_wall"] = null;
  const candidates: Array<{ strike: number; kind: "resistance" | "support" }> = [];
  if (callWall != null && Number.isFinite(callWall)) {
    candidates.push({ strike: callWall, kind: "resistance" });
  }
  if (putWall != null && Number.isFinite(putWall)) {
    candidates.push({ strike: putWall, kind: "support" });
  }
  for (const c of candidates) {
    const dist = Number((c.strike - spot).toFixed(2));
    if (nearest == null || Math.abs(dist) < Math.abs(nearest.distance_pts)) {
      nearest = { strike: c.strike, kind: c.kind, distance_pts: dist };
    }
  }

  const distance_to_flip_pct =
    flip != null && Number.isFinite(flip) && spot > 0
      ? Number((((spot - flip) / spot) * 100).toFixed(2))
      : null;

  const shift_summary = hm.shift?.available ? hm.shift.summary ?? null : null;

  return {
    ticker: root,
    spot,
    change_pct: hm.change_pct,
    asof: hm.asof,
    flip,
    call_wall: callWall,
    put_wall: putWall,
    max_pain: hm.max_pain,
    gex_king_strike: kingFromStrikeTotals(gex.strike_totals),
    net_gex: gex.total,
    gamma_posture: gex.regime.posture,
    gamma_regime_read: gex.regime.read,
    net_vex: vex.total,
    vanna_posture: vex.regime.posture,
    vanna_regime_read: vex.regime.read,
    net_dex: dex ? dex.total : null,
    dex_posture: dex ? dex.regime.posture : null,
    dex_regime_read: dex ? dex.regime.read : null,
    net_charm: charm ? charm.total : null,
    charm_posture: charm ? charm.regime.posture : null,
    charm_regime_read: charm ? charm.regime.read : null,
    nearest_wall: nearest,
    distance_to_flip_pct,
    shift_summary,
    source: "polygon",
  };
}

/**
 * One embeddable sentence built ONLY from present fields (any missing clause is
 * dropped). Returns null when getGexPositioning is null (cold matrix → emit nothing).
 *
 * Example:
 *   SPY dealer positioning: SHORT gamma below flip 745.0; call wall 750 (resistance),
 *   put wall 735 (support), max-pain 743, net GEX -$688M, net vanna +$120M.
 */
export async function gexContextLine(ticker: string): Promise<string | null> {
  const p = await getGexPositioning(ticker);
  if (!p) return null;

  // Lead clause: posture vs flip (only when both posture + flip are present).
  let lead = `${p.ticker} dealer positioning:`;
  if (p.gamma_posture && p.flip != null) {
    const side = p.distance_to_flip_pct != null && p.distance_to_flip_pct < 0 ? "below" : "above";
    lead += ` ${p.gamma_posture.toUpperCase()} gamma ${side} flip ${fmtNum(p.flip)};`;
  } else if (p.gamma_posture) {
    lead += ` ${p.gamma_posture.toUpperCase()} gamma;`;
  } else if (p.flip != null) {
    lead += ` flip ${fmtNum(p.flip)};`;
  }

  const clauses: string[] = [];
  if (p.call_wall != null) clauses.push(`call wall ${fmtNum(p.call_wall)} (resistance)`);
  if (p.put_wall != null) clauses.push(`put wall ${fmtNum(p.put_wall)} (support)`);
  if (p.max_pain != null) clauses.push(`max-pain ${fmtNum(p.max_pain)}`);
  if (Number.isFinite(p.net_gex)) clauses.push(`net GEX ${fmtPremium(p.net_gex)}`);
  if (Number.isFinite(p.net_vex) && p.net_vex !== 0) {
    clauses.push(`net vanna ${fmtPremium(p.net_vex)}`);
  }

  const body = clauses.length ? ` ${clauses.join(", ")}.` : "";
  // Trim a dangling lead colon/semicolon when no body and no posture/flip clause.
  return `${lead}${body}`.replace(/[;:]$/, ".").trim();
}

/**
 * Multi-line positioning block mirroring the explain route's local buildContext GEX
 * section — the canonical AI-prompt drop-in. Each clause is emitted ONLY when its
 * field is present; missing fields are omitted, never fabricated. Reuses the same
 * compact money formatter as every other surface.
 *
 * Returns null when getGexPositioning is null (cold matrix → emit nothing).
 */
export async function gexContextBlock(ticker: string): Promise<string | null> {
  // AI prompts benefit from the 0DTE intraday-adjusted lens (always clearly labeled an estimate),
  // so this block opts INTO it. It's not on the high-frequency light path, so the bounded extra
  // fetch is acceptable here. The canonical OI clauses above remain primary + unchanged.
  const p = await getGexPositioning(ticker, { includeIntradayAdjusted: true });
  if (!p) return null;

  const lines: string[] = [];
  lines.push(`Ticker: ${p.ticker}`);
  lines.push(
    `Spot: ${fmtNum(p.spot)} (${p.change_pct >= 0 ? "+" : ""}${p.change_pct.toFixed(2)}% on the day)`
  );

  // Gamma regime read is always a string (neutral when thin) — always present.
  lines.push(`GEX regime read: ${p.gamma_regime_read}`);

  if (p.flip != null || p.gamma_posture) {
    const flipPart = p.flip != null ? fmtNum(p.flip) : "undetermined";
    const posturePart = p.gamma_posture ?? "undetermined";
    let line = `Gamma flip: ${flipPart} | posture: ${posturePart}`;
    if (p.distance_to_flip_pct != null) {
      line += ` (${p.distance_to_flip_pct >= 0 ? "+" : ""}${p.distance_to_flip_pct}% from spot)`;
    }
    lines.push(line);
  }

  if (p.call_wall != null || p.put_wall != null) {
    lines.push(
      `Call wall (resistance/pin): ${fmtNum(p.call_wall)} | Put wall (support): ${fmtNum(p.put_wall)}`
    );
  }
  if (p.max_pain != null) lines.push(`Max pain: ${fmtNum(p.max_pain)}`);

  if (Number.isFinite(p.net_gex)) lines.push(`Net dealer $-gamma total: ${fmtPremium(p.net_gex)}`);

  // Vanna read is always a string; emit it as one line of context.
  lines.push(`VEX (vanna) read: ${p.vanna_regime_read}`);
  if (Number.isFinite(p.net_vex) && p.net_vex !== 0) {
    lines.push(`Net dealer $-vanna total: ${fmtPremium(p.net_vex)}`);
  }

  if (p.shift_summary) lines.push(`Intraday gamma shift: ${p.shift_summary}`);

  // DEX: dealer delta posture (stabilizing vs destabilizing).
  if (p.dex_regime_read) lines.push(`DEX (delta) read: ${p.dex_regime_read}`);
  if (p.net_dex != null && Number.isFinite(p.net_dex) && p.net_dex !== 0) {
    lines.push(`Net dealer $-delta total: ${fmtPremium(p.net_dex)}`);
  }

  // CHARM: delta-decay pinning read (pre-OPEX / end-of-day pin direction).
  if (p.charm_regime_read) lines.push(`CHARM (pinning) read: ${p.charm_regime_read}`);
  if (p.net_charm != null && Number.isFinite(p.net_charm) && p.net_charm !== 0) {
    lines.push(`Net dealer $-charm total: ${fmtPremium(p.net_charm)}`);
  }

  // 0DTE intraday-adjusted lens — ALWAYS labeled as an estimate + that canonical GEX is OI-based, so
  // the model can never present it as the primary number. Only emitted when a real adjustment exists.
  const adj = p.gex_intraday_adjusted;
  if (adj && adj.model === "signed-flow" && adj.net_gex_adjustment !== 0) {
    lines.push(
      `Intraday-adjusted (OI + volume model, 0DTE ${adj.front_expiry}, ESTIMATE — canonical GEX above is OI-based): ` +
        `net $-gamma ${fmtPremium(adj.net_gex_adjusted)} (OI ${fmtPremium(adj.net_gex_oi)} ${
          adj.net_gex_adjustment >= 0 ? "+" : "−"
        }${fmtPremium(Math.abs(adj.net_gex_adjustment))} front-expiry flow), flip ${fmtNum(
          adj.flip_adjusted
        )}, call wall ${fmtNum(adj.call_wall_adjusted)}, put wall ${fmtNum(adj.put_wall_adjusted)}` +
        ` [coverage ${(adj.meta.classification_coverage * 100).toFixed(0)}%]`
    );
  }

  return lines.join("\n");
}

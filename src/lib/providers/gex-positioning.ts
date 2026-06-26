import "server-only";

import { fetchGexHeatmap, type GexHeatmap } from "@/lib/providers/polygon-options-gex";

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
  /** Provenance — always the shared Polygon/Massive GEX matrix. */
  source: "polygon";
};

/**
 * Compact signed dollar magnitude — the SAME formatter the explain route uses,
 * so every surface renders net GEX/VEX identically. e.g. "$16.2M" / "-$688M".
 */
function fmtMoney(n: number): string {
  if (!Number.isFinite(n)) return "n/a";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
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
export async function getGexPositioning(ticker: string): Promise<GexPositioning | null> {
  const root = String(ticker ?? "").trim().toUpperCase();
  if (!root) return null;

  const hm = await fetchGexHeatmap(root).catch(() => null);
  return gexPositioningFromHeatmap(root, hm);
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
    net_gex: gex.total,
    gamma_posture: gex.regime.posture,
    gamma_regime_read: gex.regime.read,
    net_vex: vex.total,
    vanna_posture: vex.regime.posture,
    vanna_regime_read: vex.regime.read,
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
  if (Number.isFinite(p.net_gex)) clauses.push(`net GEX ${fmtMoney(p.net_gex)}`);
  if (Number.isFinite(p.net_vex) && p.net_vex !== 0) {
    clauses.push(`net vanna ${fmtMoney(p.net_vex)}`);
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
  const p = await getGexPositioning(ticker);
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

  if (Number.isFinite(p.net_gex)) lines.push(`Net dealer $-gamma total: ${fmtMoney(p.net_gex)}`);

  // Vanna read is always a string; emit it as one line of context.
  lines.push(`VEX (vanna) read: ${p.vanna_regime_read}`);
  if (Number.isFinite(p.net_vex) && p.net_vex !== 0) {
    lines.push(`Net dealer $-vanna total: ${fmtMoney(p.net_vex)}`);
  }

  if (p.shift_summary) lines.push(`Intraday gamma shift: ${p.shift_summary}`);

  return lines.join("\n");
}

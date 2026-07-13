// BLACKOUT Intelligence Engine — grounded Vector desk-brief intel.
//
// The Vector analogue of spx-desk-intel.ts: `{{…}}`-grounded one-liner brief lines
// (one per Vector surface — walls, regime, magnet, max pain, expected move, flow,
// ladder) plus `knownVectorNumbers`, the exhaustive set of citable numbers the brief
// may quote. Every number a brief line wraps in `{{…}}` MUST appear in
// knownVectorNumbers so a downstream grounding check (checkNumbersGrounded /
// verifyClaims) can trace it — that is the whole contract this file upholds.
//
// Deterministic, no LLM, no network — it reads a `VectorFullState` (assembled by
// vector-full-state.ts) and formats it.

import type { VectorFullState } from "@/lib/bie/vector-full-state";
import { fmtPremium } from "@/lib/fmt-money";

function num(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Grounded number token — mirrors spx-desk-intel.ts's `n()`. */
function n(v: number | null | undefined, d = 2): string {
  if (v == null || !Number.isFinite(v)) return "{{—}}";
  return `{{${v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}}}`;
}

/** Signed point distance token, e.g. `{{+40}}`. */
function signedPts(dist: number): string {
  const sign = dist >= 0 ? "+" : "";
  return `{{${sign}${dist.toFixed(0)}}}`;
}

/** Signed percent token WITHOUT the trailing % (caller appends it), e.g. `{{+0.53}}`. */
function signedPct(v: number, d = 2): string {
  const sign = v >= 0 ? "+" : "";
  return `{{${sign}${v.toFixed(d)}}}`;
}

function integrityTag(tier: string | null | undefined): string {
  return tier ? `, ${tier}` : "";
}

/** REGIME — dealer gamma posture, spot vs the gamma flip, and the mechanic it implies. */
export function regimeBriefLine(state: VectorFullState): string | null {
  const posture = state.regime?.posture;
  if (!posture || posture === "unknown") return null;

  const spot = num(state.spot);
  const flip = num(state.gammaFlip);
  const label =
    posture === "long" ? "LONG GAMMA" : posture === "short" ? "SHORT GAMMA" : "AT GAMMA FLIP";
  const mechanic =
    posture === "long"
      ? "dealers fade moves — range/mean-revert"
      : posture === "short"
        ? "dealers amplify moves — momentum/breaks run"
        : "regime undecided — sharpest moves fire here";

  const parts: string[] = [`{{${label}}}`];
  if (spot != null && flip != null) {
    const distPct = ((spot - flip) / spot) * 100;
    parts.push(`spot ${n(spot)} vs γflip ${n(flip)} (${signedPct(distPct)}%)`);
  } else if (spot != null) {
    parts.push(`spot ${n(spot)}`);
  }
  parts.push(mechanic);
  return `REGIME  ${parts.join(" · ")}`;
}

/** WALLS — top call/put gamma walls with signed distance + integrity tier, plus the flip. */
export function wallsBriefLine(state: VectorFullState): string | null {
  const walls = state.gexWalls;
  const spot = num(state.spot);
  if (!walls || (walls.callWalls.length === 0 && walls.putWalls.length === 0)) return null;

  const parts: string[] = [];
  const call = walls.callWalls[0];
  if (call) {
    const dist = spot != null ? ` (${signedPts(call.strike - spot)}` : " (";
    parts.push(`call wall ${n(call.strike)}${dist}${integrityTag(state.wallIntegrity?.call?.tier)}, caps upside)`);
  }
  const put = walls.putWalls[0];
  if (put) {
    const dist = spot != null ? ` (${signedPts(put.strike - spot)}` : " (";
    parts.push(`put wall ${n(put.strike)}${dist}${integrityTag(state.wallIntegrity?.put?.tier)}, dealer support)`);
  }
  const flip = num(state.gammaFlip);
  if (flip != null) parts.push(`γflip ${n(flip)}`);
  return `WALLS  ${parts.join(" · ")}`;
}

/** MAGNET — the dealer-hedging center of mass (pin in long gamma, pivot in short). */
export function magnetBriefLine(state: VectorFullState): string | null {
  const m = state.magnet;
  if (!m) return null;
  const lead = m.pull === "at" ? "pinned at" : `pull ${m.pull} toward`;
  return `MAGNET  ${lead} ${n(m.strike)} (${signedPct(m.distancePct * 100)}%) — ${m.callout.slice(0, 80)}`;
}

/** MAX PAIN — the max-pain strike and its signed distance from spot. */
export function maxPainBriefLine(state: VectorFullState): string | null {
  const mp = num(state.maxPain);
  if (mp == null) return null;
  const spot = num(state.spot);
  const dist = spot != null ? ` (${signedPts(mp - spot)})` : "";
  return `MAX PAIN  ${n(mp)}${dist}`;
}

/** EXPECTED MOVE — options-implied ±1σ / ±2σ bands for the horizon. */
export function expectedMoveBriefLine(state: VectorFullState): string | null {
  const em = state.expectedMove;
  if (!em || em.bands.length === 0) return null;
  const b1 = em.bands.find((b) => b.sigma === 1);
  const b2 = em.bands.find((b) => b.sigma === 2);
  const parts: string[] = [];
  if (b1) parts.push(`1σ ±${n(b1.movePts, 1)}pts (${signedPct(em.movePct * 100)}%) → ${n(b1.low)}–${n(b1.high)}`);
  if (b2) parts.push(`2σ → ${n(b2.low)}–${n(b2.high)}`);
  if (!parts.length) return null;
  return `EXPECTED MOVE  ${parts.join(" · ")}`;
}

/** FLOW — large options prints on the horizon's front expiry (feature #20). */
export function flowBriefLine(state: VectorFullState): string | null {
  const f = state.flow;
  if (!f || !f.available) return null;
  const shown = f.prints.length;
  if (shown === 0 && f.meta.largeFound === 0) return null;

  const parts: string[] = [`${shown} large prints`];
  if (f.expiry) parts.push(`front {{${f.expiry}}}`);
  if (f.meta.largeFound > shown) parts.push(`${f.meta.largeFound} found`);
  const top = f.prints[0];
  if (top) parts.push(`top ${top.side} ${n(top.strike)} ${fmtPremium(top.premium)}`);
  return `FLOW  ${parts.join(" · ")}`;
}

/** LADDER — the per-strike GEX ladder's dominant "king" strike each side + the strike count. */
export function ladderBriefLine(state: VectorFullState): string | null {
  const l = state.ladder;
  if (!l || l.rows.length === 0) return null;
  const callKing = l.rows.find((r) => r.side === "call" && r.isKing);
  const putKing = l.rows.find((r) => r.side === "put" && r.isKing);
  const parts: string[] = [];
  if (callKing) parts.push(`call king ${n(callKing.strike)}`);
  if (putKing) parts.push(`put king ${n(putKing.strike)}`);
  parts.push(`${l.rows.length} strikes`);
  return `LADDER  ${parts.join(" · ")}`;
}

/**
 * Every citable number the brief lines above may quote — the grounding contract. A downstream
 * check (`checkNumbersGrounded` for a strict discard, or Layer-4 `verifyClaims` for coverage)
 * confirms each `{{…}}` value is one of these; a value absent here reads as fabricated. So this
 * MUST stay exhaustive: raw levels (spot, flip, walls, max pain, EM edges, ladder strikes,
 * magnet), the DERIVED distances/percents the lines cite, and the integrity scores.
 */
export function knownVectorNumbers(state: VectorFullState): number[] {
  const set = new Set<number>();
  const add = (v: number | null | undefined) => {
    if (v != null && Number.isFinite(v)) set.add(Number(v));
  };

  const spot = num(state.spot);
  const flip = num(state.gammaFlip);
  add(spot);
  add(flip);
  // Distance-from-flip percent the regime line cites.
  if (spot != null && flip != null && spot !== 0) add(((spot - flip) / spot) * 100);

  // Walls: strike + concentration pct + the signed point distance from spot each wall line quotes.
  for (const w of state.gexWalls?.callWalls ?? []) {
    add(w.strike);
    add(w.pct);
    if (spot != null) add(w.strike - spot);
  }
  for (const w of state.gexWalls?.putWalls ?? []) {
    add(w.strike);
    add(w.pct);
    if (spot != null) add(w.strike - spot);
  }

  // Wall integrity scores (the tier itself is a word, but the score is a citable number).
  add(state.wallIntegrity?.call?.score);
  add(state.wallIntegrity?.put?.score);

  // Max pain + its signed distance.
  const mp = num(state.maxPain);
  add(mp);
  if (mp != null && spot != null) add(mp - spot);

  // Magnet strike + its percent (raw + rounded int, since the callout embeds the rounded level).
  if (state.magnet) {
    add(state.magnet.strike);
    add(Math.round(state.magnet.strike));
    add(state.magnet.distancePct * 100);
  }

  // Proximity level + percent.
  if (state.proximity) {
    add(state.proximity.strike);
    add(state.proximity.distancePct);
  }

  // Expected move: both band edges, move points, the headline move percent, and its own spot.
  if (state.expectedMove) {
    add(state.expectedMove.spot);
    add(state.expectedMove.movePct * 100);
    for (const b of state.expectedMove.bands) {
      add(b.low);
      add(b.high);
      add(b.movePts);
    }
  }

  // Ladder: every real per-strike level (kings included).
  for (const r of state.ladder?.rows ?? []) add(r.strike);

  // Flow: the notable print's strike.
  add(state.flow?.prints?.[0]?.strike);

  return Array.from(set);
}

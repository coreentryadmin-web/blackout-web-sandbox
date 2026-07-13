// BLACKOUT Intelligence Engine — full SPX desk intel for Live Desk briefs.
// Surfaces the same GEX/VEX/DEX/CHARM matrix, walls, chart, and expiry data
// Thermal + Largo already read — deterministic, no LLM.

import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { SpxConfluence } from "@/features/spx/lib/spx-signals";
import type { IntelHeatmapSlice } from "@/features/spx/lib/spx-odte-intel-feed";
import type { NightHawkEdition } from "@/features/nighthawk/lib/types";
import type { GexPositioning } from "@/lib/providers/gex-positioning";
import type { GexHeatmap } from "@/lib/providers/polygon-options-gex";
import { fmtPremium } from "@/lib/fmt-money";

export type SpxDeskBriefIntel = {
  positioning: GexPositioning | null;
  prevPositioning?: GexPositioning | null;
  heatmap?: GexHeatmap | null;
  prevHeatmapSlice?: IntelHeatmapSlice | null;
  /** Material desk/heatmap edges (same engine as Playbook terminal). */
  intelLines?: string[];
  nighthawk?: NightHawkEdition | null;
  prevNighthawk?: NightHawkEdition | null;
};

function n(n: number | null | undefined, d = 2): string {
  if (n == null || !Number.isFinite(n)) return "{{—}}";
  return `{{${n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}}}`;
}

function signedPts(dist: number): string {
  const sign = dist >= 0 ? "+" : "";
  return `{{${sign}${dist.toFixed(0)}}}`;
}

function greekLevels(hm: GexHeatmap | null | undefined) {
  return {
    vexFlip: hm?.vex?.flip ?? null,
    dexZero: hm?.dex?.zero_level ?? null,
    charmZero: hm?.charm?.zero_level ?? null,
  };
}

/** Numbers the brief may cite from positioning + heatmap greek levels (grounding). */
export function knownIntelNumbers(intel: SpxDeskBriefIntel | undefined): number[] {
  const raw = new Set<number>();
  const add = (v: number | null | undefined) => {
    if (v != null && Number.isFinite(v)) raw.add(Number(v));
  };

  const p = intel?.positioning;
  if (p) {
    add(p.spot);
    add(p.flip);
    add(p.call_wall);
    add(p.put_wall);
    add(p.max_pain);
    add(p.gex_king_strike);
    add(p.net_gex);
    add(p.net_vex);
    add(p.net_dex);
    add(p.net_charm);
    add(p.distance_to_flip_pct);
    add(p.nearest_wall?.strike);
    add(p.nearest_wall?.distance_pts);
    const adj = p.gex_intraday_adjusted;
    if (adj) {
      add(adj.flip_adjusted);
      add(adj.call_wall_adjusted);
      add(adj.put_wall_adjusted);
      add(adj.net_gex_adjusted);
      add(adj.net_gex_oi);
      add(adj.net_gex_adjustment);
    }
  }

  const levels = greekLevels(intel?.heatmap);
  add(levels.vexFlip);
  add(levels.dexZero);
  add(levels.charmZero);

  const nh = intel?.nighthawk;
  if (nh?.available) {
    for (const p of nh.plays ?? []) {
      const strike = parseFloat(String(p.entry_range ?? "").replace(/[^\d.]/g, ""));
      if (Number.isFinite(strike)) add(strike);
      const tgt = parseFloat(String(p.target ?? "").replace(/[^\d.]/g, ""));
      if (Number.isFinite(tgt)) add(tgt);
      const stp = parseFloat(String(p.stop ?? "").replace(/[^\d.]/g, ""));
      if (Number.isFinite(stp)) add(stp);
      if (p.score != null) add(p.score);
    }
  }

  return Array.from(raw);
}

/** Material positioning shifts vs prior window (max 2 snippets for Δ / EDGES). */
export function positioningDeltaSnippets(
  prev: GexPositioning | null | undefined,
  curr: GexPositioning | null | undefined
): string[] {
  if (!prev || !curr) return [];
  const out: string[] = [];

  if (prev.flip != null && curr.flip != null && Math.abs(prev.flip - curr.flip) >= 0.5) {
    out.push(`γflip ${n(prev.flip, 0)}→${n(curr.flip, 0)}`);
  }
  if (prev.gamma_posture && curr.gamma_posture && prev.gamma_posture !== curr.gamma_posture) {
    out.push(`GEX posture {{${prev.gamma_posture}}}→{{${curr.gamma_posture}}}`);
  }
  if (prev.vanna_posture && curr.vanna_posture && prev.vanna_posture !== curr.vanna_posture) {
    out.push(`VEX posture {{${prev.vanna_posture}}}→{{${curr.vanna_posture}}}`);
  }
  if (prev.call_wall != null && curr.call_wall != null && Math.abs(prev.call_wall - curr.call_wall) >= 1) {
    out.push(`call wall ${n(prev.call_wall, 0)}→${n(curr.call_wall, 0)}`);
  }
  if (prev.put_wall != null && curr.put_wall != null && Math.abs(prev.put_wall - curr.put_wall) >= 1) {
    out.push(`put wall ${n(prev.put_wall, 0)}→${n(curr.put_wall, 0)}`);
  }
  if (curr.shift_summary && curr.shift_summary !== prev.shift_summary) {
    out.push(curr.shift_summary.slice(0, 72));
  }

  return out.slice(0, 2);
}

/** Full dealer greek stack — GEX, VEX, DEX, CHARM from the shared matrix. */
export function dealersBriefLine(intel: SpxDeskBriefIntel | undefined): string | null {
  const p = intel?.positioning;
  if (!p) return null;

  const parts: string[] = [];
  if (p.gamma_posture || p.gamma_regime_read) {
    parts.push(
      `GEX {{${p.gamma_posture ?? "—"}}} ${p.gamma_regime_read ? p.gamma_regime_read.slice(0, 48) : ""}`.trim()
    );
  }
  if (p.vanna_posture || p.vanna_regime_read) {
    parts.push(
      `VEX {{${p.vanna_posture ?? "—"}}} ${p.vanna_regime_read ? p.vanna_regime_read.slice(0, 40) : ""}`.trim()
    );
  }
  if (p.dex_posture || p.dex_regime_read) {
    parts.push(
      `DEX {{${p.dex_posture ?? "—"}}} ${p.dex_regime_read ? p.dex_regime_read.slice(0, 40) : ""}`.trim()
    );
  }
  if (p.charm_posture || p.charm_regime_read) {
    parts.push(
      `CHARM {{${p.charm_posture ?? "—"}}} ${p.charm_regime_read ? p.charm_regime_read.slice(0, 40) : ""}`.trim()
    );
  }

  const { vexFlip, dexZero, charmZero } = greekLevels(intel?.heatmap);
  const levelBits: string[] = [];
  if (vexFlip != null) levelBits.push(`vanna flip ${n(vexFlip, 0)}`);
  if (dexZero != null) levelBits.push(`δ-zero ${n(dexZero, 0)}`);
  if (charmZero != null) levelBits.push(`charm-zero ${n(charmZero, 0)}`);
  if (levelBits.length) parts.push(levelBits.join(" · "));

  if (Number.isFinite(p.net_gex) && p.net_gex !== 0) {
    parts.push(`net γ ${fmtPremium(p.net_gex)}`);
  }
  if (Number.isFinite(p.net_vex) && p.net_vex !== 0) {
    parts.push(`net vanna ${fmtPremium(p.net_vex)}`);
  }
  if (p.net_dex != null && Number.isFinite(p.net_dex) && p.net_dex !== 0) {
    parts.push(`net δ ${fmtPremium(p.net_dex)}`);
  }
  if (p.net_charm != null && Number.isFinite(p.net_charm) && p.net_charm !== 0) {
    parts.push(`net charm ${fmtPremium(p.net_charm)}`);
  }

  const adj = p.gex_intraday_adjusted;
  if (adj && adj.model === "signed-flow" && adj.net_gex_adjustment !== 0) {
    parts.push(
      `0DTE adj flip ${n(adj.flip_adjusted, 0)} net γ ${fmtPremium(adj.net_gex_adjusted)} (estimate)`
    );
  }

  if (!parts.length) return null;
  return `DEALERS  ${parts.join(" · ")}`;
}

/** Canonical matrix walls — call / put / king / max pain with signed distance. */
export function wallsBriefLine(
  intel: SpxDeskBriefIntel | undefined,
  spot: number
): string | null {
  const p = intel?.positioning;
  if (!p) return null;

  const parts: string[] = [];
  if (p.call_wall != null) {
    parts.push(`call wall ${n(p.call_wall, 0)} (${signedPts(p.call_wall - spot)}, caps upside)`);
  }
  if (p.put_wall != null) {
    parts.push(`put wall ${n(p.put_wall, 0)} (${signedPts(p.put_wall - spot)}, dealer support)`);
  }
  if (p.gex_king_strike != null) {
    parts.push(`king ${n(p.gex_king_strike, 0)} (anchor node)`);
  }
  if (p.max_pain != null && Math.abs(p.max_pain - spot) <= 40) {
    parts.push(`max pain ${n(p.max_pain, 0)}`);
  }
  if (p.flip != null) {
    parts.push(`γflip ${n(p.flip, 0)}`);
  }
  if (p.distance_to_flip_pct != null) {
    parts.push(`{{${p.distance_to_flip_pct >= 0 ? "+" : ""}${p.distance_to_flip_pct.toFixed(1)}}}% from γflip`);
  }

  if (!parts.length) return null;
  return `WALLS  ${parts.join(" · ")}`;
}

/** Chart / structure — EMAs, opening range, gap. */
export function chartBriefLine(desk: SpxDeskPayload): string | null {
  const price = desk.price;
  if (price == null) return null;

  const parts: string[] = [];
  const emaTags: string[] = [];
  if (desk.ema20 != null) {
    emaTags.push(`EMA20 ${n(desk.ema20, 0)} (${price >= desk.ema20 ? "above" : "below"})`);
  }
  if (desk.ema50 != null) {
    emaTags.push(`EMA50 ${n(desk.ema50, 0)}`);
  }
  if (desk.ema200 != null) {
    emaTags.push(`EMA200 ${n(desk.ema200, 0)}`);
  }
  if (emaTags.length) parts.push(emaTags.join(" · "));

  const or = desk.opening_range;
  if (or?.high != null && or.low != null) {
    const breakTag = or.break ? `OR break {{${or.break}}}` : or.forming ? "OR forming" : "inside OR";
    parts.push(`open range ${n(or.low, 0)}-${n(or.high, 0)} · ${breakTag}`);
  }

  if (desk.gap_pct != null && Math.abs(desk.gap_pct) >= 0.15) {
    parts.push(`gap {{${desk.gap_pct >= 0 ? "+" : ""}${desk.gap_pct.toFixed(2)}}}%`);
  }

  if (!parts.length) return null;
  return `CHART  ${parts.join(" · ")}`;
}

export function expiryBriefLine(desk: SpxDeskPayload): string | null {
  const ge = desk.greek_exposure;
  if (!ge?.headline) return null;
  const top = ge.buckets?.[0];
  const bucket =
    top && top.pct_of_total != null
      ? ` · top bucket {{${top.pct_of_total.toFixed(0)}}}% {{${top.dte_label}}}`
      : "";
  return `EXPIRY  ${ge.headline}${bucket}`;
}

export function mag7BriefLine(desk: SpxDeskPayload): string | null {
  const m = desk.mag7_greek_flow;
  if (!m?.headline && m?.bias == null) return null;
  const bits = [m.headline, m.bias ? `bias {{${m.bias}}}` : null].filter(Boolean);
  return bits.length ? `MAG7  ${bits.join(" · ")}` : null;
}

export function breadthBriefLine(desk: SpxDeskPayload): string | null {
  const b = desk.market_breadth;
  if (!b) return null;
  const parts: string[] = [];
  if (b.pct_advancing != null) parts.push(`{{${b.pct_advancing.toFixed(0)}}}% advancing`);
  if (b.advance_decline_ratio != null) parts.push(`A/D {{${b.advance_decline_ratio.toFixed(2)}}}`);
  if (b.pct_above_vwap != null) parts.push(`{{${b.pct_above_vwap.toFixed(0)}}}% above VWAP`);
  if (!parts.length) return null;
  return `BREADTH  ${parts.join(" · ")}`;
}

export function volBriefLine(desk: SpxDeskPayload): string | null {
  const parts: string[] = [];
  if (desk.vix != null) parts.push(`VIX ${n(desk.vix, 1)}`);
  if (desk.vix_change_pct != null && Math.abs(desk.vix_change_pct) >= 1) {
    parts.push(`VIX {{${desk.vix_change_pct >= 0 ? "+" : ""}${desk.vix_change_pct.toFixed(1)}}}%`);
  }
  const vt = desk.vix_term;
  if (vt?.structure) parts.push(`term {{${vt.structure}}}`);
  if (!parts.length) return null;
  return `VOL  ${parts.join(" · ")}`;
}

export function edgesBriefLine(intel: SpxDeskBriefIntel | undefined): string | null {
  const snippets = positioningDeltaSnippets(intel?.prevPositioning, intel?.positioning);
  if (!snippets.length) return null;
  return `EDGES  ${snippets.join(" · ")}`;
}

/** Confluence engine snapshot — score, grade, action, top weighted factors. */
export function signalsBriefLine(confluence: SpxConfluence): string {
  const sorted = [...confluence.factors].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  const top = sorted
    .slice(0, 3)
    .map((f) => `${f.label} (${f.detail.slice(0, 36)})`)
    .join(" · ");
  return `SIGNALS  {{${confluence.grade}}} score {{${confluence.score.toFixed(0)}}} · ${confluence.action} · ${top}`;
}

/** UW cross-validation when matrix diverges from strike ladder. */
export function crossCheckBriefLine(intel: SpxDeskBriefIntel | undefined): string | null {
  const cv = intel?.positioning?.gex_cross_validation;
  if (!cv || cv.divergence == null || cv.divergence < 3) return null;
  const mismatches: string[] = [];
  if (!cv.callWallMatch) mismatches.push("call wall");
  if (!cv.putWallMatch) mismatches.push("put wall");
  if (!cv.flipMatch) mismatches.push("γflip");
  if (!mismatches.length) return null;
  return `CROSSCHK  Matrix vs UW diverge {{${cv.divergence.toFixed(0)}}}pt — ${mismatches.join(" · ")} mismatch`;
}

/** Night Hawk overnight edition — SPX play first when present. */
export function nighthawkBriefLine(intel: SpxDeskBriefIntel | undefined): string | null {
  const nh = intel?.nighthawk;
  if (!nh?.available || nh.stale) return null;

  if (nh.recap_only) {
    const head = nh.recap_headline ?? nh.edition_for ?? "recap";
    return `NIGHT HAWK  Recap · {{${head.slice(0, 72)}}}`;
  }

  const spx = nh.plays.find((p) => /^(SPX|SPXW)$/i.test(p.ticker));
  const top = spx ?? nh.plays[0];
  if (!top) {
    return nh.edition_for
      ? `NIGHT HAWK  Edition {{${nh.edition_for}}} · no ranked plays`
      : null;
  }

  const dir = top.direction.toUpperCase();
  const bits = [
    `NIGHT HAWK  #${top.rank} {{${top.ticker}}} {{${dir}}} · {{${top.conviction}}}`,
    top.target ? `tgt {{${top.target}}}` : null,
    top.stop ? `stop {{${top.stop}}}` : null,
    top.score != null ? `score {{${top.score}}}` : null,
    nh.edition_for ? `ed {{${nh.edition_for}}}` : null,
  ].filter(Boolean);
  return bits.join(" · ");
}

/** Format BieFullState sections for Largo/BIE markdown (no server-only). */

import type { BieFullState } from "@/lib/bie/full-platform-cache";
import type { ThermalMatrixSummary, ThermalPositioningSummary } from "@/lib/bie/thermal-matrix-summary";

const fmt = (n: unknown, digits = 2): string =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("en-US", { maximumFractionDigits: digits })
    : "—";

const fmtPct = (n: unknown): string =>
  typeof n === "number" && Number.isFinite(n) ? `${n >= 0 ? "+" : ""}${fmt(n, 2)}%` : "—";

function formatPositioning(label: string, p: ThermalPositioningSummary | null | undefined): string[] {
  if (!p) return [`**${label}:** no live Thermal positioning (matrix cold).`];
  return [
    `**${label}** · spot **${fmt(p.spot, 0)}** (${fmtPct(p.change_pct)}) · as of ${p.asof}`,
    `- γ flip **${fmt(p.flip, 0)}** · call wall **${fmt(p.call_wall, 0)}** · put wall **${fmt(p.put_wall, 0)}** · king **${fmt(p.gex_king_strike, 0)}**`,
    `- Net GEX **${fmt(p.net_gex, 0)}** · VEX **${fmt(p.net_vex, 0)}** · DEX **${fmt(p.net_dex, 0)}** · CHARM **${fmt(p.net_charm, 0)}**`,
    `- ${p.gamma_regime_read} · ${p.vanna_regime_read}${p.dex_regime_read ? ` · ${p.dex_regime_read}` : ""}${p.charm_regime_read ? ` · ${p.charm_regime_read}` : ""}`,
  ];
}

function formatMatrix(m: ThermalMatrixSummary | null | undefined): string[] {
  if (!m) return ["**SPX 0DTE matrix:** cold / unavailable."];
  const ladder = m.top_gex_strikes
    .slice(0, 6)
    .map((r) => `${fmt(r.strike, 0)}:${fmt(r.gex, 0)}`)
    .join(" · ");
  return [
    `**SPX matrix (${m.strike_count} strikes × ${m.expiry_count} expiries)** · spot **${fmt(m.spot, 0)}**`,
    `- GEX flip **${fmt(m.gex_flip, 0)}** · VEX flip **${fmt(m.vex_flip, 0)}** · DEX zero **${fmt(m.dex_zero, 0)}** · CHARM zero **${fmt(m.charm_zero, 0)}**`,
    `- Net GEX **${fmt(m.net_gex, 0)}** · VEX **${fmt(m.net_vex, 0)}** · DEX **${fmt(m.net_dex, 0)}** · CHARM **${fmt(m.net_charm, 0)}**`,
    ladder ? `- Near-spot γ ladder: ${ladder}` : "",
  ].filter(Boolean);
}

function formatPlatformSnapshot(platform: unknown): string[] {
  const p = platform as {
    spx?: { price?: number; change_pct?: number; gamma_flip?: number; gamma_regime?: string } | null;
    flows?: { count?: number; total_premium?: number; top_tickers?: Array<{ ticker: string }> } | null;
    nighthawk?: { play_count?: number; edition_for?: string; recap_headline?: string; available?: boolean } | null;
  } | null;
  if (!p) return [];
  const lines: string[] = ["**Cross-product snapshot**"];
  if (p.spx) {
    lines.push(
      `- **SPX Slayer:** ${fmt(p.spx.price, 0)} (${fmtPct(p.spx.change_pct)}) · γflip ${fmt(p.spx.gamma_flip, 0)} · ${p.spx.gamma_regime ?? "—"}`
    );
  }
  if (p.flows) {
    const tops = (p.flows.top_tickers ?? []).slice(0, 5).map((t) => t.ticker).join(", ");
    lines.push(`- **HELIX:** ${p.flows.count ?? 0} prints · $${fmt(p.flows.total_premium, 0)} premium · ${tops || "—"}`);
  }
  if (p.nighthawk?.available) {
    lines.push(
      `- **Night Hawk:** ${p.nighthawk.play_count ?? 0} plays · ${p.nighthawk.recap_headline ?? p.nighthawk.edition_for ?? "live"}`
    );
  }
  return lines;
}

function formatZerodte(z: unknown): string[] {
  const board = z as { plays?: Array<{ ticker: string; status: string; direction: string; strike: number | null }> } | null;
  if (!board?.plays?.length) return ["**0DTE Command:** no live board rows."];
  const open = board.plays.filter((p) => !/closed|graded/i.test(p.status));
  const sample = open.slice(0, 5).map((p) => `${p.ticker} ${fmt(p.strike, 0)}${p.direction === "long" ? "c" : "p"} (${p.status})`);
  return [`**0DTE Command:** ${board.plays.length} row(s) · ${open.length} active`, `- ${sample.join(" · ")}`];
}

function formatVector(v: unknown): string[] {
  const s = v as {
    spot?: number;
    gamma_flip?: number | null;
    gamma_regime?: string | null;
    call_wall?: number | null;
    put_wall?: number | null;
    play?: { bias?: string; conviction?: number; style?: string } | null;
  } | null;
  if (!s?.spot) return ["**Vector (SPX 0DTE):** no live desk surface."];
  return [
    `**Vector SPX 0DTE** · spot **${fmt(s.spot, 0)}** · regime **${s.gamma_regime ?? "—"}**`,
    `- γ flip **${fmt(s.gamma_flip, 0)}** · walls **${fmt(s.call_wall, 0)}** / **${fmt(s.put_wall, 0)}**`,
    s.play ? `- Play: **${s.play.bias ?? "—"}** · ${s.play.style ?? ""} · conviction ${fmt(s.play.conviction, 0)}` : "",
  ].filter(Boolean);
}

function formatIntel(intel: unknown): string[] {
  const i = intel as {
    composite_regime?: string | null;
    gex_regime?: string | null;
    flow_regime?: string | null;
    critical_anomaly_count?: number;
    anomaly_tickers?: string[];
    signal_recommendation?: string | null;
  } | null;
  if (!i) return [];
  return [
    "**Platform intel (RDS)**",
    `- Composite **${i.composite_regime ?? "—"}** · GEX **${i.gex_regime ?? "—"}** · Flow **${i.flow_regime ?? "—"}**`,
    `- Critical anomalies: **${i.critical_anomaly_count ?? 0}**${i.anomaly_tickers?.length ? ` (${i.anomaly_tickers.slice(0, 4).join(", ")})` : ""}`,
    i.signal_recommendation ? `- Signal: ${i.signal_recommendation}` : "",
  ].filter(Boolean);
}

/** Full cross-product markdown from the Redis/Live bie:full-state snapshot. */
export function formatBieFullStateAnswer(state: BieFullState): string {
  const lines: string[] = [
    "**BLACKOUT platform read (BIE)**",
    `_Snapshot as of ${state.asOf} — SPX Slayer · HELIX · Thermal · Vector · Night Hawk · 0DTE · Cortex-ready data plane._`,
    "",
  ];

  lines.push(...formatPlatformSnapshot(state.platform));
  lines.push("");
  lines.push(...formatIntel(state.intel));
  lines.push("");
  lines.push(...formatPositioning("Thermal SPX", state.thermalSpx as ThermalPositioningSummary | null));
  lines.push(...formatPositioning("Thermal SPY", state.thermalSpy as ThermalPositioningSummary | null));
  lines.push(...formatPositioning("Thermal QQQ", state.thermalQqq as ThermalPositioningSummary | null));
  lines.push("");
  lines.push(...formatMatrix(state.thermalMatrix as ThermalMatrixSummary | null));
  lines.push("");
  lines.push(...formatVector(state.vectorSpx));
  lines.push("");
  lines.push(...formatZerodte(state.zerodte));

  const regime = state.regime as { regime_label?: string; risk_tone?: string; session_phase?: string } | null;
  if (regime) {
    lines.push("", "**HELIX regime detector**", `- ${regime.regime_label ?? "—"} · ${regime.risk_tone ?? "—"} · ${regime.session_phase ?? "—"}`);
  }

  const hot = state.hotTickers as Array<{ ticker?: string; premium?: number }> | null;
  if (hot?.length) {
    lines.push("", "**Hot flow names**", `- ${hot.slice(0, 6).map((h) => `${h.ticker ?? "?"} ($${fmt((h as { total_premium?: number }).total_premium ?? (h as { premium?: number }).premium, 0)})`).join(" · ")}`);
  }

  const vu = state.vectorUniverse as { rows?: Array<{ ticker: string; spot?: number }> } | null;
  if (vu?.rows?.length) {
    lines.push("", "**Vector universe (summary rows)**", `- ${vu.rows.slice(0, 8).map((r) => `${r.ticker}${r.spot != null ? ` ${fmt(r.spot, 0)}` : ""}`).join(" · ")}`);
  }

  const errKeys = Object.keys(state.errors ?? {});
  if (errKeys.length) {
    lines.push("", `_Partial snapshot — loaders with errors: ${errKeys.join(", ")}._`);
  }

  const zr = state.zerodteRejections as { available?: boolean; rejections?: Array<{ ticker: string; gate_failed: string }> } | null;
  if (zr?.available && zr.rejections?.length) {
    lines.push("", "**0DTE scanner rejections (sample)**", `- ${zr.rejections.slice(0, 4).map((r) => `${r.ticker}:${r.gate_failed}`).join(" · ")}`);
  }

  const hn = state.helixNearMisses as { available?: boolean; near_misses?: Array<{ ticker: string; anomaly_type: string }> } | null;
  if (hn?.available && hn.near_misses?.length) {
    lines.push("", "**HELIX anomaly near-misses (sample)**", `- ${hn.near_misses.slice(0, 4).map((r) => `${r.ticker}:${r.anomaly_type}`).join(" · ")}`);
  }

  lines.push(
    "",
    "_Ask a focused follow-up (SPX desk, flow tape, Vector on NVDA, Night Hawk edition, Cortex on a ticker) to drill into one product._"
  );

  return lines.join("\n");
}

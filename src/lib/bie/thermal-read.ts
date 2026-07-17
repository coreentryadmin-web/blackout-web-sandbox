import type { BieComposed } from "@/lib/bie/composers-shared";
import {
  compactThermalMatrixSummary,
  compactThermalPositioning,
  type ThermalMatrixSummary,
  type ThermalPositioningSummary,
} from "@/lib/bie/thermal-matrix-summary";

const fmt = (n: unknown, d = 0): string =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("en-US", { maximumFractionDigits: d })
    : "—";

function formatPositioningBlock(p: ThermalPositioningSummary): string[] {
  return [
    `Spot **${fmt(p.spot, 0)}** (${p.change_pct >= 0 ? "+" : ""}${fmt(p.change_pct, 2)}%) · as of ${p.asof}`,
    `- γ flip **${fmt(p.flip, 0)}** · call wall **${fmt(p.call_wall, 0)}** · put wall **${fmt(p.put_wall, 0)}** · king **${fmt(p.gex_king_strike, 0)}**`,
    `- Net GEX **${fmt(p.net_gex, 0)}** · VEX **${fmt(p.net_vex, 0)}** · DEX **${fmt(p.net_dex, 0)}** · CHARM **${fmt(p.net_charm, 0)}**`,
    `- ${p.gamma_regime_read}`,
    `- ${p.vanna_regime_read}${p.dex_regime_read ? ` · ${p.dex_regime_read}` : ""}${p.charm_regime_read ? ` · ${p.charm_regime_read}` : ""}`,
  ];
}

function formatMatrixBlock(m: ThermalMatrixSummary): string[] {
  const ladder = m.top_gex_strikes
    .slice(0, 8)
    .map((r) => `${fmt(r.strike, 0)}:${fmt(r.gex, 0)}`)
    .join(" · ");
  return [
    `Matrix **${m.strike_count}×${m.expiry_count}** · GEX flip **${fmt(m.gex_flip, 0)}** · VEX flip **${fmt(m.vex_flip, 0)}**`,
    `- DEX zero **${fmt(m.dex_zero, 0)}** · CHARM zero **${fmt(m.charm_zero, 0)}** · max pain **${fmt(m.max_pain, 0)}**`,
    ladder ? `- Near-spot γ ladder: ${ladder}` : "",
  ].filter(Boolean);
}

function formatRegimeEvents(raw: unknown): string[] {
  const payload = raw as {
    available?: boolean;
    events?: Array<{ ticker?: string; event_type?: string; strike?: number; observed_at?: string }>;
    note?: string;
  } | null;
  if (!payload?.available || !payload.events?.length) {
    return ["**GEX regime events:** none logged recently."];
  }
  const lines = payload.events.slice(0, 6).map(
    (e) =>
      `- ${e.observed_at?.slice(11, 16) ?? "—"} · ${e.ticker ?? "—"} · ${e.event_type ?? "event"}${e.strike != null ? ` @ ${fmt(e.strike, 0)}` : ""}`
  );
  return ["**Recent GEX regime transitions**", ...lines];
}

/** BlackOut Thermal read — canonical GEX/VEX/DEX/CHARM + matrix ladder (same caches as /heatmap). */
export async function composeThermalRead(ticker = "SPX"): Promise<BieComposed> {
  const sym = ticker.trim().toUpperCase() || "SPX";
  const { getGexPositioning } = await import("@/lib/providers/gex-positioning");
  const { fetchGexHeatmap } = await import("@/lib/providers/polygon-options-gex");
  const { runLargoTool } = await import("@/lib/largo/run-tool");

  const [positioningRaw, heatmapRaw, regimeEvents] = await Promise.all([
    getGexPositioning(sym, sym === "SPX" ? { includeIntradayAdjusted: true } : undefined).catch(() => null),
    fetchGexHeatmap(sym).catch(() => null),
    runLargoTool("get_gex_regime_events", { ticker: sym, limit: 8 }).catch(() => null),
  ]);

  const positioning = compactThermalPositioning(positioningRaw);
  const matrix = compactThermalMatrixSummary(heatmapRaw);

  const lines = [`**BlackOut Thermal — ${sym}**`, ""];

  if (positioning) {
    lines.push("**Dealer positioning (canonical)**", ...formatPositioningBlock(positioning), "");
  } else {
    lines.push(`No live Thermal positioning for **${sym}** — matrix may be cold.`, "");
  }

  if (matrix) {
    lines.push("**0DTE matrix summary**", ...formatMatrixBlock(matrix), "");
  }

  lines.push(...formatRegimeEvents(regimeEvents));
  lines.push(
    "",
    "_Same GEX/VEX/DEX/CHARM caches as the Heat Maps UI and SPX rail — not the separate `get_gex` Polygon bundle._"
  );

  return {
    answer: lines.join("\n"),
    context: { ticker: sym, positioning, matrix, regimeEvents },
  };
}

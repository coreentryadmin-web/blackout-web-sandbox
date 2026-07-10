// Flow tape / unusual flow — deterministic when HELIX brief is empty.

import type { BiePlatformContext } from "@/lib/bie/platform-context";

const fmt = (n: number | null | undefined, d = 0): string =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("en-US", { maximumFractionDigits: d })
    : "—";

export function composeQuietFlowBrief(platform: BiePlatformContext): string {
  const parts: string[] = ["**HELIX flow — quiet window**", ""];
  const snap = platform.snapshot;

  if (snap.spx) {
    parts.push(
      `SPX ${fmt(snap.spx.price)} (${fmt(snap.spx.change_pct, 2)}%) · γflip ${fmt(snap.spx.gamma_flip, 0)}`
    );
  }
  if (platform.regime) {
    const r = platform.regime;
    if (r.regime_label) parts.push(`Regime: ${r.regime_label}${r.risk_tone ? ` · ${r.risk_tone}` : ""}`);
    if (r.critical_anomalies) parts.push(`Critical anomalies: ${r.critical_anomalies}`);
  }
  if (snap.flows && snap.flows.count > 0) {
    parts.push(
      `Platform tape: ${snap.flows.count} prints · $${fmt(snap.flows.total_premium, 0)} — no $15M+ whale memo this 15m window.`
    );
  } else {
    parts.push("No whale-tier prints in the shared 15m memo — scanner still running; size will print when tape concentrates.");
  }

  parts.push("", "_BIE deterministic memo — zero Claude. Refresh on next flow window._");
  return parts.join("\n");
}

export function composeFlowTapeAnswer(platform: BiePlatformContext, ticker: string | null): string {
  const snap = platform.snapshot;
  const lines = ["**Unusual / tape flow read**", ""];

  if (snap.flows) {
    lines.push(
      `**HELIX:** ${snap.flows.count} prints · $${fmt(snap.flows.total_premium, 0)} premium · leaders: ${(snap.flows.top_tickers ?? []).slice(0, 5).map((t) => t.ticker).join(", ") || "—"}`
    );
  }

  if (platform.regime) {
    const r = platform.regime;
    lines.push(
      `**Regime:** ${r.regime_label ?? "—"} · anomalies flagged: ${r.flow_anomaly_count ?? r.critical_anomalies ?? 0}`
    );
  }

  if (ticker) {
    lines.push("", `_Scoped ask mentioned ${ticker} — use "what's going on with ${ticker}" for full cross-instrument verdict._`);
  }

  lines.push("", composeQuietFlowBrief(platform).split("\n").slice(2).join("\n"));
  return lines.join("\n");
}

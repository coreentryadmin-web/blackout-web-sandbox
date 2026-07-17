import { marketPlatform } from "@/lib/platform";
import type { BieComposed } from "@/lib/bie/composers-shared";

const fmt = (n: unknown, d = 0): string =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("en-US", { maximumFractionDigits: d })
    : "—";

type NearMissRow = {
  ticker?: string;
  anomaly_type?: string;
  reason?: string;
};

/** HELIX analytics read — tape, anomalies, near-misses, dark pool (scoped or market-wide). */
export async function composeHelixRead(ticker: string | null): Promise<BieComposed> {
  const scoped = ticker?.trim().toUpperCase() || null;
  const { runLargoTool } = await import("@/lib/largo/run-tool");
  const { fetchUwDarkPoolMarketWide } = await import("@/lib/providers/unusual-whales");
  const { fetchHotTickers } = await import("@/lib/bie/hot-tickers");
  const { computeFlowStrikeStacks } = await import("@/lib/largo/flow-strike-stacks");

  const [tape, regime, nearMisses, darkPool, hotTickers] = await Promise.all([
    marketPlatform.flows.getFlowTapeSummary({ limit: 50, ticker: scoped ?? undefined }),
    runLargoTool("get_market_regime", {}).catch(() => null) as Promise<Record<string, unknown> | null>,
    runLargoTool("get_flow_anomaly_near_misses", {
      ticker: scoped ?? undefined,
      limit: 12,
    }).catch(() => null),
    fetchUwDarkPoolMarketWide({ limit: scoped ? 60 : 25 }).catch(() => null),
    fetchHotTickers(8).catch(() => []),
  ]);

  const rows = scoped
    ? (tape.recent ?? []).filter((r) => r.ticker?.toUpperCase() === scoped)
    : (tape.recent ?? []);
  const stacks = computeFlowStrikeStacks(rows);

  const lines = [
    scoped ? `**HELIX analytics — ${scoped}**` : "**HELIX analytics — market-wide**",
    "",
    `**Tape:** ${tape.count} prints · $${fmt(tape.total_premium, 0)} premium`,
  ];

  if (tape.top_tickers.length) {
    lines.push(
      `- Leaders: ${tape.top_tickers.slice(0, 6).map((t) => `${t.ticker} ($${fmt(t.premium, 0)})`).join(" · ")}`
    );
  }

  if (regime && !regime.error) {
    lines.push(
      `- Regime: **${regime.regime_label ?? "—"}** · anomalies **${regime.flow_anomaly_count ?? regime.critical_anomalies ?? 0}** · ${regime.session_phase ?? "—"}`
    );
  }

  const nm = nearMisses as { available?: boolean; near_misses?: NearMissRow[] } | null;
  if (nm?.available && nm.near_misses?.length) {
    lines.push("", "**Flow anomaly near-misses (HELIX scanner)**");
    for (const row of nm.near_misses.slice(0, 6)) {
      lines.push(`- ${row.ticker ?? "—"} · ${row.anomaly_type ?? "—"} · ${row.reason ?? ""}`.trim());
    }
  } else {
    lines.push("", "_No HELIX anomaly near-misses logged for this scope in-window._");
  }

  if (stacks.length) {
    lines.push("", "**Strike stacks (tape-derived)**");
    for (const s of stacks.slice(0, 5)) {
      lines.push(
        `- ${s.ticker} ${s.strike}${s.option_type === "call" ? "c" : "p"} · $${fmt(s.total_premium, 0)} · ${s.alert_count} hits · ${s.kind}`
      );
    }
  }

  const dp = darkPool as { prints?: Array<{ ticker?: string; price?: number; notional?: number }> } | null;
  const dpRows = (dp?.prints ?? []).filter((p) => !scoped || p.ticker === scoped);
  if (dpRows.length) {
    lines.push("", "**Dark pool (UW)**");
    lines.push(
      `- ${dpRows.slice(0, 5).map((p) => `${p.ticker} @ ${fmt(p.price, 2)} ($${fmt(p.notional, 0)})`).join(" · ")}`
    );
  }

  if (hotTickers.length && !scoped) {
    lines.push("", "**Hot tickers (6h flow)**", `- ${hotTickers.slice(0, 6).map((h) => `${h.ticker} ($${fmt(h.total_premium, 0)})`).join(" · ")}`);
  }

  lines.push(
    "",
    "_HELIX UI filter chips (DTE / whales / watchlist) are view state — this read uses live Postgres tape + regime + near-miss tables._"
  );

  return {
    answer: lines.join("\n"),
    context: { ticker: scoped, tape, regime, nearMisses, stacks, darkPool, hotTickers },
  };
}

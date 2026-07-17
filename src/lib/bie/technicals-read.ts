import type { BieComposed } from "@/lib/bie/composers-shared";
import { toProfessionalMarkdown } from "@/lib/bie/professional-tone";

const fmt = (n: unknown, d = 2): string =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("en-US", { maximumFractionDigits: d })
    : "—";

function indexAlias(ticker: string): string {
  const t = ticker.trim().toUpperCase();
  if (t === "ES") return "SPX";
  return t;
}

/** Polygon-backed RSI / EMA / ATR / swing levels — same path as Largo `get_technicals` tool. */
export async function composeTechnicalsRead(ticker: string, question?: string): Promise<BieComposed> {
  const sym = indexAlias(ticker || "SPX");
  const { buildLargoTechnicals, buildPeerRelativeStrength } = await import("@/lib/largo/technicals");
  const tech = await buildLargoTechnicals(sym);

  const lines = [`**${sym} technicals (Polygon live)**`, ""];

  if (!tech.price || tech.price <= 0) {
    lines.push(
      "_No live quote for this symbol — technicals require a valid spot. Retry after the feed reconnects._"
    );
    return { answer: toProfessionalMarkdown(lines.join("\n")), context: { tech, missing: true } };
  }

  lines.push(
    `- **Spot:** ${fmt(tech.price, 2)} (${tech.change_pct >= 0 ? "+" : ""}${fmt(tech.change_pct, 2)}%)`,
    `- **Trend (EMA stack):** ${tech.trend}`,
    `- **EMA20 / 50 / 200:** ${fmt(tech.emas.ema20, 2)} / ${fmt(tech.emas.ema50, 2)} / ${fmt(tech.emas.ema200, 2)}`,
    `- **RSI(14):** ${fmt(tech.rsi14, 1)}`,
    `- **ATR(14):** ${fmt(tech.atr14, 2)}`,
    `- **5d / 10d / 20d return:** ${fmt(tech.returns.d5, 2)}% / ${fmt(tech.returns.d10, 2)}% / ${fmt(tech.returns.d20, 2)}%`,
    `- **20d range:** ${fmt(tech.range_low_20d, 0)} – ${fmt(tech.range_high_20d, 0)}`
  );

  if (question && /\b(relative|rs|vs|outperform|lag)\b/i.test(question) && sym.length <= 5 && sym !== "SPX") {
    try {
      const rs = await buildPeerRelativeStrength(sym);
      lines.push(
        "",
        `**Relative strength vs ${rs.peer_etf}:** stock ${fmt(rs.stock.d10, 2)}% vs peer ${fmt(rs.peer.d10, 2)}% (10d) — **${rs.leading}**`
      );
    } catch {
      /* optional RS block */
    }
  }

  lines.push("", `_Source: ${tech.data_source}. Intraday TF reads route through Vector when a timeframe is named (e.g. 15m)._`);

  return {
    answer: toProfessionalMarkdown(lines.join("\n")),
    context: { tech, question },
  };
}

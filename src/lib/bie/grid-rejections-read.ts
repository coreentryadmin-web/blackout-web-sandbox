import type { BieComposed } from "@/lib/bie/composers-shared";

const fmt = (n: unknown, d = 0): string =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("en-US", { maximumFractionDigits: d })
    : "—";

/** 0DTE Command gate-rejection log — why a name didn't make the Grid board. */
export async function composeGridRejectionsRead(ticker: string | null): Promise<BieComposed> {
  const { zeroDteRejectionsForLargo } = await import("@/lib/zerodte/rejections");
  const scoped = ticker?.trim().toUpperCase() || null;
  const payload = await zeroDteRejectionsForLargo(scoped ?? undefined, 15);

  const lines = [
    scoped ? `**0DTE Command rejections — ${scoped}**` : "**0DTE Command rejections — session log**",
    "",
  ];

  if (!payload.available) {
    lines.push(String(payload.note ?? "No gate rejections logged yet this session."));
    lines.push("", "_Distinct from SPX Slayer engine snapshots — this is the multi-ticker Grid scanner._");
    return { answer: lines.join("\n"), context: payload };
  }

  const rows = (payload.rejections ?? []) as Array<{
    ticker: string;
    gate_failed: string;
    reason?: string;
    gross_premium?: number;
    direction?: string;
  }>;

  lines.push(`**${rows.length} rejection state(s)** · source: ${payload.source ?? "zerodte_scan_rejections"}`);
  for (const r of rows.slice(0, 10)) {
    lines.push(
      `- **${r.ticker}** · gate \`${r.gate_failed}\` · ${r.direction ?? "—"} · gross $${fmt(r.gross_premium, 0)}${r.reason ? ` — ${r.reason}` : ""}`
    );
  }

  lines.push("", "_For live board rows ask for today's 0DTE plays; for Cortex veto ask cortex on TICKER._");

  return { answer: lines.join("\n"), context: payload };
}

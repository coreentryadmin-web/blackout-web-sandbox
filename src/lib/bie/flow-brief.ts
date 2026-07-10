import type { FlowAlert } from "@/lib/api";
import { fmtPremium } from "@/lib/fmt-money";

type DarkBlock = {
  ticker: string;
  premium: number;
  side: string;
  share_size?: number;
};

/** Deterministic HELIX flow memo — same inputs the Claude path used, no LLM. */
export function composeFlowBrief(alerts: FlowAlert[], darkPrints: DarkBlock[]): string | null {
  if (!alerts.length) return null;

  const callPrem = alerts.filter((a) => a.option_type === "CALL").reduce((s, a) => s + a.premium, 0);
  const putPrem = alerts.filter((a) => a.option_type === "PUT").reduce((s, a) => s + a.premium, 0);
  const total = callPrem + putPrem;
  const callPct = total > 0 ? Math.round((callPrem / total) * 100) : 50;
  const whales = alerts.filter((a) => a.premium >= 1_000_000).length;

  const massiveFlow = alerts
    .filter((a) => a.premium >= 15_000_000)
    .sort((a, b) => b.premium - a.premium)[0];
  const massiveDark = darkPrints
    .filter((d) => d.premium >= 15_000_000)
    .sort((a, b) => b.premium - a.premium)[0];

  const parts: string[] = [];
  if (massiveDark) {
    parts.push(
      `${massiveDark.ticker} ${massiveDark.side.toUpperCase()} dark pool ${fmtPremium(massiveDark.premium)}`
    );
  }
  if (massiveFlow) {
    parts.push(
      `${massiveFlow.ticker} ${massiveFlow.option_type} ${massiveFlow.route} ${fmtPremium(massiveFlow.premium)}`
    );
  }

  const bias = callPct >= 58 ? "call-led" : callPct <= 42 ? "put-led" : "mixed";
  const lead =
    parts.length > 0
      ? `${parts.join(" · ")} anchor the tape.`
      : `${alerts.length} prints · ${callPct}% call premium.`;

  return `${lead} Flow is ${bias} (${fmtPremium(total)} notional, ${whales} whale prints >$1M).`;
}

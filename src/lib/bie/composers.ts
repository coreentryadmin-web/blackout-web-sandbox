// BLACKOUT Intelligence Engine — Layer 3 composers (server half).
// Deterministic answers assembled from the same source-of-truth readers the
// dashboards use. Markdown out, every number traceable by construction. Any
// failure returns null → the caller falls back to Claude; the router never
// leaves a member without an answer.

import { runLargoTool } from "@/lib/largo/run-tool";
import { zeroDtePlaysForLargo } from "@/lib/zerodte/scan";
import type { BieRoute } from "./router";

const fmt = (n: unknown, digits = 2): string =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("en-US", { maximumFractionDigits: digits })
    : "—";

type LargoPlay = {
  ticker: string;
  direction: string;
  strike: number | null;
  status: string;
  entry_premium: number | null;
  last_mark: number | null;
  live_pnl_pct: number | null;
  peak_score: number;
  action: string;
  intel: string;
  graded: { outcome: string; pnl_pct: number | null } | null;
};

function playLine(p: LargoPlay): string {
  const contract = `${p.ticker} ${fmt(p.strike)}${p.direction === "long" ? "c" : "p"}`;
  const state =
    p.graded != null
      ? `${p.graded.outcome}${p.graded.pnl_pct != null ? ` ${p.graded.pnl_pct > 0 ? "+" : ""}${p.graded.pnl_pct}%` : ""}`
      : p.live_pnl_pct != null
        ? `${p.live_pnl_pct >= 0 ? "+" : ""}${p.live_pnl_pct}%`
        : "";
  return `**${p.status}** · **${contract}**${p.entry_premium != null ? ` @ $${fmt(p.entry_premium)}` : ""}${state ? ` (${state})` : ""}\n  ${p.action} — ${p.intel}`;
}

async function composeZeroDtePlays(): Promise<string | null> {
  const board = (await zeroDtePlaysForLargo()) as {
    plays?: LargoPlay[];
    fresh_finds?: Array<{ ticker: string; direction: string; strike: number | null; score: number; intel: string }>;
    rules?: string;
  };
  const plays = board.plays ?? [];
  const fresh = board.fresh_finds ?? [];
  if (plays.length === 0 && fresh.length === 0) {
    return "No 0DTE plays on the board this session — the scanner hunts every 2 minutes through market hours, and plays print the moment the tape concentrates. Nothing clearing the conviction gates is itself information: no forced trades.";
  }
  const lines: string[] = ["**Today's 0DTE Command plays** (live board — /grid):", ""];
  for (const p of plays.slice(0, 10)) lines.push(`- ${playLine(p)}`);
  if (fresh.length) {
    lines.push("", "**Fresh finds (not yet plays):**");
    for (const f of fresh.slice(0, 4))
      lines.push(`- ${f.ticker} ${f.direction === "long" ? "calls" : "puts"} ${fmt(f.strike)} (score ${f.score}) — ${f.intel}`);
  }
  if (board.rules) lines.push("", `_${board.rules}_`);
  return lines.join("\n");
}

async function composeTickerPlayState(ticker: string): Promise<string | null> {
  const board = (await zeroDtePlaysForLargo()) as { plays?: LargoPlay[] };
  const play = (board.plays ?? []).find((p) => p.ticker === ticker.toUpperCase());
  if (!play) return null;
  return `**${play.ticker} play — ${play.status}**\n\n${playLine(play)}\n\n_Live state from the 0DTE Command board; statuses re-derive automatically every scan._`;
}

/** Whitelisted scalar dump of a platform tool payload — generic and safe: only
 *  prints fields that exist, never invents. */
function scalarSection(title: string, obj: Record<string, unknown>, keys: string[]): string | null {
  const rows = keys
    .map((k) => {
      const v = obj[k];
      if (v == null) return null;
      if (typeof v === "number") return `- ${k.replace(/_/g, " ")}: ${fmt(v)}`;
      if (typeof v === "string" && v.length <= 120) return `- ${k.replace(/_/g, " ")}: ${v}`;
      return null;
    })
    .filter(Boolean) as string[];
  if (rows.length === 0) return null;
  return [`**${title}**`, ...rows].join("\n");
}

async function composeSpxStructure(): Promise<string | null> {
  const raw = (await runLargoTool("get_spx_structure", {})) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object" || (raw as { error?: unknown }).error) return null;
  const section = scalarSection("SPX structure (live desk)", raw, [
    "price",
    "change_pct",
    "vwap",
    "gamma_flip",
    "call_wall",
    "put_wall",
    "max_pain",
    "regime",
    "gex_king_strike",
    "net_gex",
    "hod",
    "lod",
    "pdh",
    "pdl",
  ]);
  if (!section) return null;
  return `${section}\n\n_Direct read of the SPX desk — the same numbers SPX Slayer renders. Ask a follow-up if you want the reasoning behind any level._`;
}

async function composeMarketContext(): Promise<string | null> {
  const raw = (await runLargoTool("get_market_context", {})) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object" || (raw as { error?: unknown }).error) return null;
  const parts: string[] = [];
  const top = scalarSection("Market context (live)", raw, [
    "spx",
    "spy",
    "qqq",
    "vix",
    "regime",
    "tide",
    "breadth",
    "session",
    "market_label",
  ]);
  if (top) parts.push(top);
  // Nested one-level scalars (e.g. indices objects) — printed defensively.
  for (const [k, v] of Object.entries(raw)) {
    if (parts.length >= 3) break;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const sec = scalarSection(k.replace(/_/g, " "), v as Record<string, unknown>, [
        "price",
        "change_pct",
        "value",
        "label",
        "bias",
      ]);
      if (sec) parts.push(sec);
    }
  }
  if (parts.length === 0) return null;
  return `${parts.join("\n\n")}\n\n_Live platform read. For interpretation or a trade thesis, ask the follow-up — that's where deeper reasoning kicks in._`;
}

/** Compose the deterministic answer for a route, or null → Claude fallback. */
export async function composeBieAnswer(route: BieRoute): Promise<string | null> {
  try {
    switch (route.intent) {
      case "zerodte_plays":
        return await composeZeroDtePlays();
      case "ticker_play_state":
        return route.ticker ? await composeTickerPlayState(route.ticker) : null;
      case "spx_structure":
        return await composeSpxStructure();
      case "market_context":
        return await composeMarketContext();
      default:
        return null;
    }
  } catch {
    return null;
  }
}

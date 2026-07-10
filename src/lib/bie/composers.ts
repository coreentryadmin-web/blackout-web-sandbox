// BLACKOUT Intelligence Engine — Layer 3 composers (server half).
// Deterministic answers assembled from the same source-of-truth readers the
// dashboards use. Markdown out, every number traceable by construction. Any
// failure returns null → the caller falls back to Claude; the router never
// leaves a member without an answer.

import { runLargoTool } from "@/lib/largo/run-tool";
import { zeroDtePlaysForLargo } from "@/lib/platform/zerodte-service";
import { computeSpxConfluence } from "@/features/spx/lib/spx-signals";
import { composeSpxDeskBrief } from "@/lib/bie/spx-desk-brief";
import { spxSessionPhase } from "@/features/spx/lib/spx-session-phase";
import { formatKnowledgeFootnotes } from "@/lib/bie/platform-footnotes";
import { loadBiePlatformContext } from "@/lib/bie/platform-context";
import type { BieRoute } from "./router";

/** Deterministic answer plus the raw source payload for Layer 4 claim verification. */
export type BieComposed = { answer: string; context: unknown };

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

async function composeZeroDtePlays(): Promise<BieComposed | null> {
  const board = (await zeroDtePlaysForLargo()) as {
    plays?: LargoPlay[];
    fresh_finds?: Array<{ ticker: string; direction: string; strike: number | null; score: number; intel: string }>;
    rules?: string;
  };
  const plays = board.plays ?? [];
  const fresh = board.fresh_finds ?? [];
  if (plays.length === 0 && fresh.length === 0) {
    return {
      answer:
        "No 0DTE plays on the board this session — the scanner hunts every 2 minutes through market hours, and plays print the moment the tape concentrates. Nothing clearing the conviction gates is itself information: no forced trades.",
      context: board,
    };
  }
  const lines: string[] = ["**Today's 0DTE Command plays** (live board — /grid):", ""];
  for (const p of plays.slice(0, 10)) lines.push(`- ${playLine(p)}`);
  if (fresh.length) {
    lines.push("", "**Fresh finds (not yet plays):**");
    for (const f of fresh.slice(0, 4))
      lines.push(`- ${f.ticker} ${f.direction === "long" ? "calls" : "puts"} ${fmt(f.strike)} (score ${f.score}) — ${f.intel}`);
  }
  if (board.rules) lines.push("", `_${board.rules}_`);
  return { answer: lines.join("\n"), context: board };
}

async function composeTickerPlayState(ticker: string): Promise<BieComposed | null> {
  const board = (await zeroDtePlaysForLargo()) as { plays?: LargoPlay[] };
  const play = (board.plays ?? []).find((p) => p.ticker === ticker.toUpperCase());
  if (!play) return null;
  return {
    answer: `**${play.ticker} play — ${play.status}**\n\n${playLine(play)}\n\n_Live state from the 0DTE Command board; statuses re-derive automatically every scan._`,
    context: play,
  };
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

async function composeSpxDeskRead(): Promise<BieComposed | null> {
  const platform = await loadBiePlatformContext({
    scope: "desk",
    knowledgeQuery: "SPX gamma GEX dealer positioning live desk",
  });
  const desk = platform.desk;
  if (!desk) return null;
  const confluence = computeSpxConfluence(desk);
  if (!confluence) return null;

  const { openPlay, lotto, powerHour, outcomes } = platform.cross;

  const brief = composeSpxDeskBrief(desk, confluence, [], spxSessionPhase(desk.as_of), {
    openPlay: openPlay && openPlay.status === "open" ? openPlay : null,
    lotto: lotto && lotto.phase !== "NONE" && lotto.phase !== "INVALID" ? lotto : null,
    powerHour: powerHour && powerHour.phase !== "NONE" ? powerHour : null,
    outcomes: outcomes && outcomes.total_closed > 0 ? outcomes : null,
    intel: platform.intel ?? undefined,
  });
  const knowledge = formatKnowledgeFootnotes(platform.knowledge);
  const answer = [
    `**SPX Live Desk read**`,
    "",
    `**${brief.headline}**`,
    "",
    brief.body,
    knowledge ? `\n\n${knowledge}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    answer,
    context: { desk, confluence, brief, platform },
  };
}

async function composeSpxStructure(): Promise<BieComposed | null> {
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
  return {
    answer: `${section}\n\n_Direct read of the SPX desk — the same numbers SPX Slayer renders. Ask a follow-up if you want the reasoning behind any level._`,
    context: raw,
  };
}

async function composeMarketContext(): Promise<BieComposed | null> {
  const platform = await loadBiePlatformContext({
    scope: "market",
    knowledgeQuery: "market regime breadth VIX session context",
  });
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

  const regime = platform.regime;
  if (regime) {
    const regimeSec = scalarSection("HELIX regime detector", regime, [
      "regime_label",
      "risk_tone",
      "session_phase",
      "critical_anomalies",
      "flow_anomaly_count",
      "as_of",
    ]);
    if (regimeSec) parts.push(regimeSec);
  }

  const snap = platform.snapshot;
  if (snap.spx) {
    parts.push(
      `**SPX desk summary:** ${fmt(snap.spx.price)} (${fmt(snap.spx.change_pct)}%) · γflip ${fmt(snap.spx.gamma_flip, 0)} · γ ${snap.spx.gamma_regime ?? "—"}`
    );
  }
  if (snap.flows) {
    const tops = (snap.flows.top_tickers ?? []).slice(0, 4).map((t) => t.ticker).join(", ");
    parts.push(
      `**HELIX tape:** ${snap.flows.count} prints · $${fmt(snap.flows.total_premium, 0)} premium · top: ${tops || "—"}`
    );
  }
  if (snap.nighthawk?.available) {
    parts.push(
      `**Night Hawk:** ${snap.nighthawk.play_count} plays · ${snap.nighthawk.recap_headline ?? snap.nighthawk.edition_for ?? "edition live"}`
    );
  }

  // Nested one-level scalars (e.g. indices objects) — printed defensively.
  for (const [k, v] of Object.entries(raw)) {
    if (parts.length >= 6) break;
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
  const knowledge = formatKnowledgeFootnotes(platform.knowledge);
  if (knowledge) parts.push(knowledge);
  if (parts.length === 0) return null;
  return {
    answer: `${parts.join("\n\n")}\n\n_Live platform read — SPX desk, HELIX tape, Night Hawk, regime detector, and desk knowledge. Zero Claude cost._`,
    context: { market_context: raw, platform },
  };
}

async function composeTickerEcosystem(ticker: string): Promise<BieComposed | null> {
  const { fetchEcosystemContext } = await import("@/lib/bie/ecosystem-context");
  const ctx = await fetchEcosystemContext(ticker);
  const lines: string[] = [`**${ctx.ticker} — cross-instrument snapshot**`, ""];
  let any = false;

  if (ctx.zerodte_today) {
    any = true;
    const z = ctx.zerodte_today;
    lines.push(
      `- **0DTE Command today:** ${z.direction}, score ${fmt(z.score)}${z.conviction ? `, ${z.conviction} conviction` : ""}${z.status ? ` (${z.status})` : ""}`
    );
  }
  if (ctx.nighthawk_recent) {
    any = true;
    const n = ctx.nighthawk_recent;
    lines.push(
      `- **Night Hawk (${n.edition_for}):** ${n.direction}, ${n.conviction} conviction${n.score != null ? `, score ${fmt(n.score)}` : ""} — outcome: ${n.outcome}`
    );
  }
  if (ctx.recent_flow) {
    any = true;
    const f = ctx.recent_flow;
    lines.push(
      `- **HELIX flow (last ${f.window_hours}h):** ${f.print_count} prints — $${fmt(f.call_premium, 0)} call premium, $${fmt(f.put_premium, 0)} put premium${f.unknown_premium > 0 ? `, $${fmt(f.unknown_premium, 0)} unclassified` : ""}`
    );
  }
  if (ctx.recent_anomalies.length > 0) {
    any = true;
    lines.push(`- **Flow anomalies (24h):** ${ctx.recent_anomalies.map((a) => `${a.anomaly_type} (${a.severity})`).join(", ")}`);
  }
  if (!any) {
    lines.push(
      ctx.flow_feed_fresh
        ? "Nothing notable on the desk for this name right now — no 0DTE flag, no recent Night Hawk take, no unusual flow."
        : "_The live flow pipeline isn't reporting fresh data right now, so this may be incomplete — not necessarily quiet, just unconfirmed._"
    );
  }
  lines.push("", "_Cross-instrument read — the same signal Largo's tools compose from. Ask a follow-up for the reasoning behind any of this._");
  return { answer: lines.join("\n"), context: ctx };
}

/** Compose the deterministic answer for a route, or null → Claude fallback. */
export async function composeBieAnswer(route: BieRoute): Promise<BieComposed | null> {
  try {
    switch (route.intent) {
      case "zerodte_plays":
        return await composeZeroDtePlays();
      case "ticker_play_state":
        return route.ticker ? await composeTickerPlayState(route.ticker) : null;
      case "spx_structure":
        return await composeSpxStructure();
      case "spx_desk_read":
        return await composeSpxDeskRead();
      case "market_context":
        return await composeMarketContext();
      case "ticker_ecosystem":
        return route.ticker ? await composeTickerEcosystem(route.ticker) : null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

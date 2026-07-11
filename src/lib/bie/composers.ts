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
import { formatEcosystemNarrative } from "@/lib/bie/ecosystem-narrative";
import { synthesizeTickerVerdict, formatTickerVerdictMarkdown } from "@/lib/bie/ticker-verdict";
import { composeTickerCompare } from "@/lib/bie/ticker-compare";
import { composeSpxInvalidationLines } from "@/lib/bie/spx-invalidation";
import { composeFlowTapeAnswer, composeQuietFlowBrief } from "@/lib/bie/flow-tape-brief";
import { synthesizeSpxDeskIntel } from "@/lib/bie/spx-desk-synthesis";
import { buildPlayTechnicals } from "@/features/spx/lib/spx-play-technicals";
import { buildPlaybookShadowPanel } from "@/features/spx/lib/playbook-shadow-panel";
import {
  BIE_LARGO_ANSWER_TTL_MS,
  getCachedBiePlatformContext,
  largoAnswerCacheKey,
} from "@/lib/bie/platform-cache";
import { withServerCache } from "@/lib/server-cache";
import type { BieRoute } from "./router";

/** Optional member question — premise correction + advice routing context. */
export type ComposeBieOpts = { question?: string };

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

async function composeSpxDeskRead(question?: string): Promise<BieComposed | null> {
  const platform = await getCachedBiePlatformContext({ scope: "desk" });
  const desk = platform.desk;
  if (!desk) return null;
  const confluence = computeSpxConfluence(desk);
  if (!confluence) return null;

  const { openPlay, lotto, powerHour, outcomes } = platform.cross;

  let playbookShadow: import("@/lib/bie/spx-desk-brief").SpxDeskBriefCross["playbookShadow"] = null;
  try {
    const technicals = await buildPlayTechnicals(desk.price, {
      vwap: desk.vwap,
      pdh: desk.pdh,
      pdl: desk.pdl,
      hod: desk.hod,
      lod: desk.lod,
    });
    const panel = buildPlaybookShadowPanel(desk, technicals);
    if (panel) {
      const primary = panel.verdicts.find((v) => v.primary) ?? null;
      playbookShadow = {
        mode: panel.mode,
        primary_playbook_id: panel.primary_playbook_id,
        primary_name: primary?.name ?? null,
        primary_direction: primary?.direction ?? null,
        fired_count: panel.verdicts.filter((v) => v.trigger_fired).length,
      };
    }
  } catch {
    /* Largo desk read degrades without playbook panel */
  }

  const brief = composeSpxDeskBrief(desk, confluence, [], spxSessionPhase(desk.as_of), {
    openPlay: openPlay && openPlay.status === "open" ? openPlay : null,
    lotto: lotto && lotto.phase !== "NONE" && lotto.phase !== "INVALID" ? lotto : null,
    powerHour: powerHour && powerHour.phase !== "NONE" ? powerHour : null,
    outcomes: outcomes && outcomes.total_closed > 0 ? outcomes : null,
    intel: platform.intel ?? undefined,
    playbookShadow,
  }, question);
  const knowledge = formatKnowledgeFootnotes(platform.knowledge);
  const answer = [`**SPX Live Desk read**`, "", `**${brief.headline}**`, "", brief.body, knowledge ? `\n\n${knowledge}` : ""]
    .filter(Boolean)
    .join("\n");
  return {
    answer,
    context: { desk, confluence, brief, platform },
  };
}

async function composeSpxInvalidation(): Promise<BieComposed | null> {
  const platform = await getCachedBiePlatformContext({ scope: "desk" });
  const desk = platform.desk;
  if (!desk) return null;
  const confluence = computeSpxConfluence(desk);
  if (!confluence) return null;
  const cross = {
    openPlay: platform.cross.openPlay,
    intel: platform.intel ?? undefined,
  };
  const lines = composeSpxInvalidationLines(desk, confluence, cross);
  return { answer: lines.join("\n"), context: { desk, confluence, cross } };
}

async function composeSpxStructure(): Promise<BieComposed | null> {
  const [platform, raw] = await Promise.all([
    getCachedBiePlatformContext({ scope: "desk" }),
    runLargoTool("get_spx_structure", {}) as Promise<Record<string, unknown> | null>,
  ]);
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

  const parts = [section];
  const desk = platform.desk;
  if (desk) {
    const confluence = computeSpxConfluence(desk);
    if (confluence) {
      const synthesis = synthesizeSpxDeskIntel(
        desk,
        confluence,
        spxSessionPhase(desk.as_of),
        { intel: platform.intel ?? undefined, openPlay: platform.cross.openPlay ?? undefined }
      );
      parts.push("", synthesis.mechanic ?? "");
      if (synthesis.watch.length) {
        parts.push("", "**Watch**", ...synthesis.watch.slice(0, 3).map((w) => `- ${w}`));
      }
    }
  }
  parts.push("", "_Mini structure read — ask **What's the SPX setup right now?** for full THESIS/ALIGNMENT._");
  return { answer: parts.join("\n"), context: { raw, desk: platform.desk } };
}

async function composeMarketContext(): Promise<BieComposed | null> {
  const [platform, raw] = await Promise.all([
    getCachedBiePlatformContext({ scope: "market", flowLimit: 24 }),
    runLargoTool("get_market_context", {}) as Promise<Record<string, unknown> | null>,
  ]);
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
  const narrative = formatEcosystemNarrative(ctx);
  return {
    answer: `${narrative}\n\n_Ask a follow-up for SPX desk context or a structured verdict on ${ticker}._`,
    context: ctx,
  };
}

async function composeTickerAdvice(ticker: string, question: string): Promise<BieComposed | null> {
  const { fetchEcosystemContext } = await import("@/lib/bie/ecosystem-context");
  const ctx = await fetchEcosystemContext(ticker);
  const verdict = await synthesizeTickerVerdict(ctx, question);
  return {
    answer: formatTickerVerdictMarkdown(verdict),
    context: { ecosystem: ctx, verdict },
  };
}

async function composeFlowTape(ticker: string | null): Promise<BieComposed | null> {
  const platform = await getCachedBiePlatformContext({ scope: "market", flowLimit: 40 });
  return {
    answer: composeFlowTapeAnswer(platform, ticker),
    context: platform,
  };
}

/** Compose the deterministic answer for a route, or null → Claude fallback. */
export async function composeBieAnswer(route: BieRoute, opts?: ComposeBieOpts): Promise<BieComposed | null> {
  const cacheKey = largoAnswerCacheKey(route.intent, route.ticker, route.ticker_b, opts?.question);
  return withServerCache<BieComposed | null>(
    cacheKey,
    BIE_LARGO_ANSWER_TTL_MS,
    () => composeBieAnswerUncached(route, opts),
    { staleWhileRevalidate: true }
  );
}

async function composeBieAnswerUncached(route: BieRoute, opts?: ComposeBieOpts): Promise<BieComposed | null> {
  try {
    switch (route.intent) {
      case "zerodte_plays":
        return await composeZeroDtePlays();
      case "ticker_play_state":
        return route.ticker ? await composeTickerPlayState(route.ticker) : null;
      case "spx_structure":
        return await composeSpxStructure();
      case "spx_desk_read":
        return await composeSpxDeskRead(opts?.question);
      case "spx_invalidation":
        return await composeSpxInvalidation();
      case "market_context":
        return await composeMarketContext();
      case "flow_tape":
        return await composeFlowTape(route.ticker);
      case "ticker_ecosystem":
        return route.ticker ? await composeTickerEcosystem(route.ticker) : null;
      case "ticker_advice":
        return route.ticker && opts?.question
          ? await composeTickerAdvice(route.ticker, opts.question)
          : route.ticker
            ? await composeTickerAdvice(route.ticker, `structure on ${route.ticker}`)
            : null;
      case "ticker_compare":
        return route.ticker && route.ticker_b
          ? await composeTickerCompare(route.ticker, route.ticker_b)
          : null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

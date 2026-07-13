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
import { stripGroundingTokens } from "@/lib/bie/grounding-markers";
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
  // Strip the {{value}} grounding markers so the member sees the number, not the marker — the SPX
  // desk brief lines wrap every figure in {{…}} for the strict grounding guard, and the non-stream
  // Largo path was shipping them literally (live audit: "above γflip {{7,496}}").
  const answer = stripGroundingTokens(
    [`**SPX Live Desk read**`, "", `**${brief.headline}**`, "", brief.body, knowledge ? `\n\n${knowledge}` : ""]
      .filter(Boolean)
      .join("\n")
  );
  return {
    answer,
    context: { desk, confluence, brief, platform },
  };
}

/** Parse a chart timeframe (1m/5m/15m/1H) from the question → minutes, else undefined (default 5). */
function timeframeMinFromQuestion(q?: string): number | undefined {
  if (!q) return undefined;
  const m = q.match(/\b(1|3|5|15|30)\s?m\b/i);
  if (m) return Number(m[1]);
  const h = q.match(/\b(1|2|4)\s?h\b/i);
  if (h) return Number(h[1]) * 60;
  return undefined;
}

/**
 * Deterministic Vector desk read — the Largo-BIE path for Vector questions (zero Claude cost).
 * Assembles the FULL Vector state for (ticker, horizon) and renders the multi-section desk brief
 * (regime / walls / wall-dynamics / magnet / max-pain / expected-move / ladder / VEX / dark-pool /
 * flow / play). Returns null on no live spot → the router falls back (Claude, or the staging
 * SPX default). The returned context carries the state + knownVectorNumbers so Layer-4
 * verifyClaims can ground every cited figure.
 */
async function composeVectorRead(
  ticker: string,
  horizon: string,
  question?: string
): Promise<BieComposed | null> {
  const [{ fetchVectorFullState }, { normalizeDteHorizon }, { composeVectorDeskBrief }, { knownVectorNumbers }] =
    await Promise.all([
      import("@/lib/bie/vector-full-state"),
      import("@/features/vector/lib/vector-dte-horizon"),
      import("@/lib/bie/vector-desk-brief"),
      import("@/lib/bie/vector-desk-intel"),
    ]);

  const state = await fetchVectorFullState(
    ticker.toUpperCase(),
    normalizeDteHorizon(horizon),
    timeframeMinFromQuestion(question)
  );
  // No live state (markets closed, cold matrix, off-universe ticker) — fetchVectorFullState
  // fail-opens to null. Returning null here let the route 502 / fall back to an SPX desk-dump; the
  // honest behavior is to SAY we can't read it and record the gap, never crash or dump the wrong
  // desk. (BUG 1 from the live audit — SPY/QQQ/NVDA off-hours 502'd.)
  const { recordBieGap } = await import("@/lib/bie/gap-log");
  const { noLiveVectorStateMessage } = await import("@/lib/bie/vector-read-fallback");
  if (!state) {
    void recordBieGap({ question: question ?? "", intent: "vector_read", reason: "no_live_state" });
    return {
      answer: noLiveVectorStateMessage(ticker),
      context: { ticker: ticker.toUpperCase(), reason: "no_live_state" },
    };
  }

  const brief = composeVectorDeskBrief(state, question);
  const answer = stripGroundingTokens(
    [
      `**Vector desk read — ${ticker.toUpperCase()} (${state.horizon.toUpperCase()})**`,
      "",
      `**${brief.headline}**`,
      "",
      brief.body,
    ].join("\n")
  );
  return { answer, context: { state, known: knownVectorNumbers(state) } };
}

/**
 * Deterministic concept/definition read — answers "what is GEX / a King node / VEX / max pain",
 * "what does Night Hawk do" from the code-grounded glossary, zero LLM cost. On a known term it
 * returns the clean definition; on an UNKNOWN term it returns an HONEST "not in my glossary yet"
 * message (never a desk-dump) and records the miss via the gap-logger so the glossary can grow.
 */
async function composeConceptRead(question: string): Promise<BieComposed | null> {
  const { lookupGlossary } = await import("@/lib/bie/glossary");
  const entry = lookupGlossary(question);
  if (!entry) {
    const { recordBieGap } = await import("@/lib/bie/gap-log");
    void recordBieGap({ question, intent: "concept_read", reason: "no_definition" });
    return {
      answer:
        "I don't have a solid definition for that in my glossary yet — I've logged it so it can be added. " +
        "I can define the core desk concepts though: GEX, VEX, DEX, charm, the gamma flip, a King node, " +
        "call/put walls, max pain, expected move, the gamma magnet, wall integrity, the bead rail, confluence, " +
        "the gamma regime, VWAP/EMA/RSI/MACD, or any BlackOut product (Vector, SPX Slayer, Thermal, Helix, " +
        "Night Hawk, Largo, BIE).",
      context: { reason: "no_definition", question },
    };
  }
  // Glossary definitions carry no {{…}} markers, so no stripping needed.
  const answer = `**${entry.term}**\n\n${entry.definition}`;
  return { answer, context: { term: entry.term, category: entry.category } };
}

/** Split a "path?a=1&b=2" token into a path + params object. */
function splitPathQuery(raw: string): { path: string; params: Record<string, string> } {
  const [path, query] = raw.split("?");
  const params: Record<string, string> = {};
  if (query) {
    for (const kv of query.split("&")) {
      const [k, v] = kv.split("=");
      if (k) params[decodeURIComponent(k)] = decodeURIComponent(v ?? "");
    }
  }
  return { path: path!, params };
}

/**
 * Universal lookup — "pull / look up X from <internal path | provider>". Resolves the referenced
 * endpoint through the GOVERNED readers (callInternalApiRead / readUw / readPolygon — all read-only,
 * allowlisted) and returns the JSON, or an honest "name the endpoint/source" + gap-log when it can't
 * resolve one. Deterministic: it only acts on an explicitly-named path/provider (the router gate
 * guarantees one is present); it never guesses a natural-language resource → endpoint mapping (that's
 * the LLM tool path via get_uw/get_polygon/call_internal_api).
 */
async function composeUniversal(question: string): Promise<BieComposed | null> {
  const { recordBieGap } = await import("@/lib/bie/gap-log");
  const internalMatch = question.match(/\/api\/[\w\-\/]+(?:\?[\w=&%.\-]+)?/)?.[0] ?? null;
  const providerMatch =
    question.match(/\/v[0-9x]+\/[\w\-\/.]+(?:\?[\w=&%.\-]+)?/i)?.[0] ??
    question.match(/\/(?:snapshot|reference|marketstatus|aggs)[\w\-\/.]*(?:\?[\w=&%.\-]+)?/i)?.[0] ??
    null;
  const mentionsPolygon = /\b(polygon|massive)\b/i.test(question);
  const mentionsUw = /\b(unusual ?whales|uw)\b/i.test(question);

  let result: { ok?: boolean; error?: string; data?: unknown } | null = null;
  let source = "";

  if (mentionsUw && internalMatch) {
    const { readUw } = await import("@/lib/bie/provider-read");
    const { path, params } = splitPathQuery(internalMatch);
    result = await readUw(path, params);
    source = `Unusual Whales ${path}`;
  } else if (providerMatch || (mentionsPolygon && internalMatch)) {
    const { readPolygon } = await import("@/lib/bie/provider-read");
    const { path, params } = splitPathQuery(providerMatch ?? internalMatch!);
    result = await readPolygon(path, params);
    source = `Polygon ${path}`;
  } else if (internalMatch) {
    const { callInternalApiRead } = await import("@/lib/bie/internal-api");
    const { path, params } = splitPathQuery(internalMatch);
    result = await callInternalApiRead(path, params);
    source = `internal ${path}`;
  }

  if (result == null) {
    void recordBieGap({ question, intent: "universal_lookup", reason: "universal_unresolved" });
    return {
      answer:
        "I can pull live platform data — just name the endpoint or source. E.g. \"pull /api/market/gex-positioning?ticker=SPY\", " +
        "\"get /v3/reference/tickers from Polygon\", or a UW data path like \"/api/darkpool/NVDA from unusual whales\". Which endpoint?",
      context: { reason: "universal_unresolved" },
    };
  }
  if (!result.ok) {
    void recordBieGap({ question, intent: "universal_lookup", reason: result.error ?? "read_failed" });
    return {
      answer: `I couldn't read ${source} — ${result.error ?? "the read failed"}. That path is either denied (read-only + governed) or currently unavailable.`,
      context: result,
    };
  }
  const json = JSON.stringify(result.data ?? result, null, 2);
  const body = json.length > 2500 ? `${json.slice(0, 2500)}\n… (truncated)` : json;
  return { answer: `**${source}**\n\n\`\`\`json\n${body}\n\`\`\``, context: result };
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
  return { answer: stripGroundingTokens(lines.join("\n")), context: { desk, confluence, cross } };
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
  return { answer: stripGroundingTokens(parts.join("\n")), context: { raw, desk: platform.desk } };
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
      case "vector_read":
        return route.ticker
          ? await composeVectorRead(route.ticker, route.horizon ?? "all", opts?.question)
          : null;
      case "concept_read":
        return await composeConceptRead(opts?.question ?? "");
      case "universal_lookup":
        return await composeUniversal(opts?.question ?? "");
      default:
        return null;
    }
  } catch {
    return null;
  }
}

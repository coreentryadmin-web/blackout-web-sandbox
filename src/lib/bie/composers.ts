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
import {
  wantsBrevity,
  wantsCallWallOnly,
  wantsContradictionExplain,
  wantsGammaFlipOnly,
  wantsKingNodeOnly,
  wantsPutWallOnly,
  wantsVixOnly,
} from "@/lib/bie/question-focus";
import { classifyBieIntent, type BieRoute } from "./router";
import {
  splitCompoundQuestion,
  labelForSubQuestion,
  synthesizeCompoundAnswer,
  type CompoundPart,
} from "./decompose";

/** Optional member question — premise correction + advice routing context. */
export type ComposeBieOpts = {
  question?: string;
  /** Stream UI — status lines while composing / enriching. */
  onStatus?: (message: string) => void;
  /** Passed through to live enrichment tool calls (session attribution). */
  userId?: string;
};

/** Deterministic answer plus the raw source payload for Layer 4 claim verification. */
import { tierLine, type BieComposed } from "@/lib/bie/composers-shared";
export type { BieComposed };

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
  /** Commit-time merit tier (PR-F, entry_context.tier passthrough on the board
   *  row) — opaque blob, read structurally by tierLine below; absent/null on rows
   *  committed before the tier wiring shipped. */
  tier?: { tier?: unknown; factors?: unknown } | null;
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
  return `**${p.status}** · **${contract}**${p.entry_premium != null ? ` @ $${fmt(p.entry_premium)}` : ""}${state ? ` (${state})` : ""}\n  ${p.action} — ${p.intel}${tierLine(p.tier)}`;
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
  // PR-H: cite the pinned commit-time Cortex evidence per play (the WHY of record) —
  // one ledger read for the whole board, fail-soft to an empty map (list still renders).
  let cortexLines = new Map<string, string>();
  try {
    const { pinnedCortexLinesForSession } = await import("@/lib/bie/cortex-read");
    cortexLines = await pinnedCortexLinesForSession();
  } catch {
    /* plays render without cortex lines */
  }
  const lines: string[] = ["**Today's 0DTE Command plays** (live board — /grid):", ""];
  for (const p of plays.slice(0, 10)) {
    lines.push(`- ${playLine(p)}`);
    const cx = cortexLines.get(p.ticker.toUpperCase());
    if (cx) lines.push(`  ${cx}`);
  }
  if (fresh.length) {
    lines.push("", "**Fresh finds (not yet plays):**");
    for (const f of fresh.slice(0, 4))
      lines.push(`- ${f.ticker} ${f.direction === "long" ? "calls" : "puts"} ${fmt(f.strike)} (score ${f.score}) — ${f.intel}`);
  }
  if (plays.length > 0 && cortexLines.size > 0) {
    lines.push("", `_Ask "why did we commit <ticker>" for the full pinned Cortex evidence table._`);
  }
  if (board.rules) lines.push("", `_${board.rules}_`);
  return { answer: lines.join("\n"), context: board };
}

async function composeTickerPlayState(ticker: string): Promise<BieComposed | null> {
  const board = (await zeroDtePlaysForLargo()) as { plays?: LargoPlay[] };
  const play = (board.plays ?? []).find((p) => p.ticker === ticker.toUpperCase());
  if (!play) return null;
  let answer = `**${play.ticker} play — ${play.status}**\n\n${playLine(play)}\n\n_Live state from the 0DTE Command board; statuses re-derive automatically every scan._`;
  // PR-N9: when the same ticker is ALSO in the current Night Hawk edition, cite the
  // pinned overnight take (publish pin + pulled/verdict state) — pinned-only and one
  // ledger read, so the hot path stays cheap. Fail-soft: no record → no block.
  let nighthawkEdition: unknown = null;
  try {
    const { nighthawkEditionCitationFor, renderNighthawkEditionCitation } = await import(
      "@/lib/bie/nighthawk-edition-read"
    );
    const citation = await nighthawkEditionCitationFor(ticker);
    if (citation) {
      nighthawkEdition = citation;
      answer = `${answer}\n\n${renderNighthawkEditionCitation(citation)}`;
    }
  } catch {
    /* play state renders without the edition block */
  }
  return {
    answer,
    context: { play, nighthawk_edition: nighthawkEdition },
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

  if (question && wantsBrevity(question)) {
    const bias = confluence.bias;
    const dir =
      bias === "bullish" ? "bullish" : bias === "bearish" ? "bearish" : "mixed/neutral";
    const price = desk.price != null ? fmt(desk.price, 0) : "—";
    return {
      answer: `SPX **${dir}** at **${price}** (${fmt(desk.spx_change_pct, 2)}%) — grade **${confluence.grade}**, γ-flip **${fmt(desk.gamma_flip, 0)}**.`,
      context: { desk, confluence, brief: true },
    };
  }

  if (question && wantsContradictionExplain(question)) {
    const synthesis = synthesizeSpxDeskIntel(desk, confluence, spxSessionPhase(desk.as_of), {
      openPlay: platform.cross.openPlay ?? undefined,
      lotto: platform.cross.lotto ?? undefined,
      intel: platform.intel ?? undefined,
    });
    return {
      answer: [
        "**Why bullish and bearish show up together**",
        "",
        "- **Signal stack** (EMAs, VWAP reclaim, short-γ fuel) can read *tactical bullish* while…",
        `- **Confluence thesis** stays **${confluence.bias}** with grade **${confluence.grade}** — low edge / friction from GEX, flow, or gates.`,
        "",
        synthesis.friction ? `**Friction now:** ${synthesis.friction}` : "",
        "",
        "_Different layers: signals = tape posture; thesis = whether we'd size a 0DTE play._",
      ]
        .filter(Boolean)
        .join("\n"),
      context: { desk, confluence, synthesis },
    };
  }

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
  let answer = stripGroundingTokens(
    [`**SPX Live Desk read**`, "", `**${brief.headline}**`, "", brief.body, knowledge ? `\n\n${knowledge}` : ""]
      .filter(Boolean)
      .join("\n")
  );
  // PR-H: the SPX why/desk path cites the PINNED Cortex verdict when an SPX-family
  // 0DTE play exists on this session's ledger (one cheap ledger read). Deliberately
  // pinned-only — no live Cortex composition on the flagship question's hot path;
  // "cortex SPX" gets the full live evidence read. Fail-soft: no record → no block.
  let cortexCitation: unknown = null;
  try {
    const { cortexCitationFor, renderCortexCitation } = await import("@/lib/bie/cortex-read");
    const citation = await cortexCitationFor("SPX", { allowLive: false });
    if (citation) {
      cortexCitation = citation;
      answer = `${answer}\n\n${renderCortexCitation(citation)}`;
    }
  } catch {
    /* desk read renders without the cortex block */
  }
  return {
    answer,
    context: { desk, confluence, brief, platform, cortex: cortexCitation },
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

  // HONESTY GUARD: a question that names an UNSUPPORTED horizon (LEAP / multi-year / quarterly) can't
  // be scoped — normalizeDteHorizon would silently coerce it to the whole-chain "all", and we'd
  // answer that aggregate as if it satisfied the request (a fabricated read). Reject it honestly
  // BEFORE fetching, and record the gap. (0DTE/weekly/monthly/all are the only representable horizons.)
  const { namesUnsupportedHorizon, unsupportedHorizonMessage, noLiveVectorStateMessage } = await import(
    "@/lib/bie/vector-read-fallback"
  );
  const { recordBieGap } = await import("@/lib/bie/gap-log");
  if (question && namesUnsupportedHorizon(question)) {
    void recordBieGap({ question, intent: "vector_read", reason: "unsupported_horizon" });
    return {
      answer: unsupportedHorizonMessage(ticker),
      context: { ticker: ticker.toUpperCase(), reason: "unsupported_horizon" },
    };
  }

  const state = await fetchVectorFullState(
    ticker.toUpperCase(),
    normalizeDteHorizon(horizon),
    timeframeMinFromQuestion(question)
  );
  // No live state (markets closed, cold matrix, off-universe ticker) — fetchVectorFullState
  // fail-opens to null. Returning null here let the route 502 / fall back to an SPX desk-dump; the
  // honest behavior is to SAY we can't read it and record the gap, never crash or dump the wrong
  // desk. (BUG 1 from the live audit — SPY/QQQ/NVDA off-hours 502'd.)
  if (!state) {
    void recordBieGap({ question: question ?? "", intent: "vector_read", reason: "no_live_state" });
    return {
      answer: noLiveVectorStateMessage(ticker),
      context: { ticker: ticker.toUpperCase(), reason: "no_live_state" },
    };
  }

  const brief = composeVectorDeskBrief(state, question);
  let answer = stripGroundingTokens(
    [
      `**Vector desk read — ${ticker.toUpperCase()} (${state.horizon.toUpperCase()})**`,
      "",
      `**${brief.headline}**`,
      "",
      brief.body,
    ].join("\n")
  );

  const { appendVectorPulseSection } = await import("@/lib/bie/vector-pulse-brief");
  const { questionWantsVectorPulse } = await import("@/lib/bie/live-data-enrich-detect");
  if (questionWantsVectorPulse(question)) {
    const pulse = await appendVectorPulseSection(state);
    if (pulse.markdown) answer += pulse.markdown;
  }

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
  // Rich concept answer: a full multi-section EXPLANATION (What it is · How it works · Why it matters
  // · Example · On the platform) instead of a single dictionary line — BIE teaching the concept like a
  // desk analyst, deterministic + grounded. Glossary/rich content carries no {{…}} markers.
  const { buildConceptEnvelope } = await import("@/lib/bie/concept-narrative");
  const envelope = buildConceptEnvelope(entry);
  return { answer: envelope.markdown, context: { term: entry.term, category: entry.category }, envelope };
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

async function composeSpxStructure(question?: string): Promise<BieComposed | null> {
  const [platform, raw] = await Promise.all([
    getCachedBiePlatformContext({ scope: "desk" }),
    runLargoTool("get_spx_structure", {}) as Promise<Record<string, unknown> | null>,
  ]);
  if (!raw || typeof raw !== "object" || (raw as { error?: unknown }).error) return null;

  const r = raw as Record<string, unknown>;
  if (question && wantsPutWallOnly(question)) {
    return {
      answer: `**SPX put wall:** **${fmt(r.put_wall, 0)}** · spot **${fmt(r.price, 0)}** · γ-flip **${fmt(r.gamma_flip, 0)}**`,
      context: { raw, narrow: "put_wall" },
    };
  }
  if (question && wantsCallWallOnly(question)) {
    return {
      answer: `**SPX call wall:** **${fmt(r.call_wall, 0)}** · spot **${fmt(r.price, 0)}** · γ-flip **${fmt(r.gamma_flip, 0)}**`,
      context: { raw, narrow: "call_wall" },
    };
  }
  if (question && wantsKingNodeOnly(question)) {
    return {
      answer: `**SPX king node (GEX king):** **${fmt(r.gex_king_strike, 0)}** · spot **${fmt(r.price, 0)}** · net GEX **${fmt(r.net_gex, 0)}**`,
      context: { raw, narrow: "king_node" },
    };
  }
  if (question && wantsGammaFlipOnly(question)) {
    return {
      answer: `**SPX gamma flip:** **${fmt(r.gamma_flip, 0)}** · spot **${fmt(r.price, 0)}** · regime **${String(r.regime ?? "—")}**`,
      context: { raw, narrow: "gamma_flip" },
    };
  }

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
  parts.push("", "_Mini structure read — ask **What's the SPX setup right now?** for the full Live Desk brief._");
  return { answer: stripGroundingTokens(parts.join("\n")), context: { raw, desk: platform.desk } };
}

async function composeMarketContext(question?: string): Promise<BieComposed | null> {
  const [platform, raw] = await Promise.all([
    getCachedBiePlatformContext({ scope: "market", flowLimit: 24 }),
    runLargoTool("get_market_context", {}) as Promise<Record<string, unknown> | null>,
  ]);
  if (!raw || typeof raw !== "object" || (raw as { error?: unknown }).error) return null;

  if (question && wantsVixOnly(question)) {
    const vix = (raw as Record<string, unknown>).vix;
    const desk = platform.desk;
    const parts = ["**VIX (live)**"];
    if (vix && typeof vix === "object") {
      const sec = scalarSection("", vix as Record<string, unknown>, ["value", "change_pct", "label", "regime"]);
      if (sec) parts.push(sec.replace(/^\*\*:\*\*\n/, ""));
    } else if (typeof vix === "number") {
      parts.push(`- **${fmt(vix, 2)}**`);
    }
    if (desk?.vix != null) {
      parts.push(
        `- Desk VIX **${fmt(desk.vix, 2)}** — ${desk.vix > 20 ? "elevated vol" : "subdued vol"} for 0DTE sizing`
      );
    }
    if (question && /\b(spx|s&p|slayer|0dte)\b/i.test(question) && desk) {
      const confluence = computeSpxConfluence(desk);
      parts.push(
        "",
        `**SPX read impact:** grade **${confluence?.grade ?? "—"}** · ${confluence?.bias ?? "—"} thesis — ${desk.vix != null && desk.vix > 22 ? "high vol → widen stops / favor defined risk" : "vol OK for desk-sized 0DTE if gates pass"}.`
      );
    }
    parts.push("", "_For full cross-asset context ask **What's the market doing?**_");
    return { answer: parts.join("\n"), context: { vix, desk: platform.desk } };
  }

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
  // PR-H: advice on a 0DTE-relevant ticker cites the Cortex alongside the ecosystem
  // read — PINNED commit-time evidence when a play exists this session, the LIVE
  // composition otherwise. Fetched in parallel (both cache-first) and fail-soft: a
  // Cortex outage yields an honest "unavailable" line, never a stalled/failed answer.
  // PR-N9: advice on a ticker that is ALSO in the current Night Hawk edition cites the
  // pinned overnight take (publish pin + pulled/verdict state) — pinned-only and ONE
  // ledger read (no live composition), so the hot path stays cheap. Fetched in
  // parallel with the other reads; fail-soft: no record → no block.
  const [ctx, cortex, nighthawkEdition] = await Promise.all([
    fetchEcosystemContext(ticker),
    (async () => {
      try {
        const { cortexCitationFor, directionFromQuestion } = await import("@/lib/bie/cortex-read");
        return await cortexCitationFor(ticker, { direction: directionFromQuestion(question), allowLive: true });
      } catch {
        return null;
      }
    })(),
    (async () => {
      try {
        const { nighthawkEditionCitationFor } = await import("@/lib/bie/nighthawk-edition-read");
        return await nighthawkEditionCitationFor(ticker);
      } catch {
        return null;
      }
    })(),
  ]);
  const verdict = await synthesizeTickerVerdict(ctx, question);
  let answer = formatTickerVerdictMarkdown(verdict);
  if (cortex) {
    const { renderCortexCitation } = await import("@/lib/bie/cortex-read");
    answer = `${answer}\n\n${renderCortexCitation(cortex)}`;
  }
  if (nighthawkEdition) {
    const { renderNighthawkEditionCitation } = await import("@/lib/bie/nighthawk-edition-read");
    answer = `${answer}\n\n${renderNighthawkEditionCitation(nighthawkEdition)}`;
  }
  return {
    answer,
    context: { ecosystem: ctx, verdict, cortex, nighthawk_edition: nighthawkEdition },
  };
}

async function composeFlowTape(ticker: string | null): Promise<BieComposed | null> {
  const { composeHelixRead } = await import("@/lib/bie/helix-read");
  const q = ticker
    ? `unusual flow and top prints on ${ticker}`
    : "any unusual flow right now — top prints by premium";
  return composeHelixRead(ticker, q);
}

/** Per-sub-question deadline — a slow friend must never stall the whole compound answer. */
const COMPOUND_FRIEND_TIMEOUT_MS = 4000;
const COMPOUND_TIMEOUT = Symbol("compound-timeout");

/**
 * COMPOUND answer — the "15 questions in one ask" engine (task #57). Splits the message into
 * sub-questions and, WHEN it is confidently compound (≥2), fans them out over the EXISTING single-
 * intent path (classifyBieIntent → composeBieAnswer) in PARALLEL, each with a per-friend timeout,
 * then synthesizes ONE labeled answer. Returns null when the message is a single question, so the
 * caller falls through to the unchanged single path (no regression — the whole gate).
 *
 * Honesty spine: every part is EITHER real grounded data OR an honest "unavailable — timed out / no
 * live data" note + recordBieGap — never fabricated, never silently dropped. State is request-scoped
 * (the `ledger` local below), never shared/global, so concurrent calls can't cross-contaminate.
 */
export async function composeCompound(
  question: string,
  ledgerTickers: Set<string> = new Set()
): Promise<BieComposed | null> {
  const subQs = splitCompoundQuestion(question);
  if (subQs.length < 2) return null; // single question → caller uses the normal path unchanged

  const { recordBieGap } = await import("@/lib/bie/gap-log");

  // Request-scoped ledger — fresh per call, one row per friend. Never global.
  const ledger: Array<CompoundPart & { context: unknown }> = await Promise.all(
    subQs.map(async (subQ, i): Promise<CompoundPart & { context: unknown }> => {
      const index = i + 1;
      const label = labelForSubQuestion(subQ);
      const started = Date.now();
      const unavailable = (reason: string, intent: string | null): CompoundPart & { context: unknown } => ({
        index,
        label,
        ok: false,
        text: `unavailable — ${reason}`,
        intent,
        ms: Date.now() - started,
        context: null,
      });

      try {
        const route = classifyBieIntent(subQ, ledgerTickers);
        if (!route) {
          void recordBieGap({ question: subQ, intent: "compound_part", reason: "no_route" });
          return unavailable("no deterministic read for this part", null);
        }
        // Per-friend timeout: race the compose against a deadline so one slow read can't stall all.
        const raced = await Promise.race([
          composeBieAnswer(route, { question: subQ }),
          new Promise<typeof COMPOUND_TIMEOUT>((res) => setTimeout(() => res(COMPOUND_TIMEOUT), COMPOUND_FRIEND_TIMEOUT_MS)),
        ]);
        if (raced === COMPOUND_TIMEOUT) {
          void recordBieGap({ question: subQ, intent: route.intent, reason: "timeout" });
          return unavailable("timed out", route.intent);
        }
        if (!raced || !raced.answer) {
          void recordBieGap({ question: subQ, intent: route.intent, reason: "no_data" });
          return unavailable("no live data returned", route.intent);
        }
        return {
          index,
          label,
          ok: true,
          text: raced.answer.trim(),
          intent: route.intent,
          ms: Date.now() - started,
          context: raced.context,
        };
      } catch {
        void recordBieGap({ question: subQ, intent: "compound_part", reason: "error" });
        return unavailable("read failed", null);
      }
    })
  );

  const answer = synthesizeCompoundAnswer(ledger);
  return {
    answer,
    // Context carries each part's own grounded context so Layer-4 verifyClaims can trace every
    // number the synthesized answer cites back to the sub-answer it came from.
    context: {
      compound: true,
      parts: ledger.map((p) => ({ index: p.index, label: p.label, ok: p.ok, intent: p.intent, ms: p.ms })),
      subContexts: ledger.map((p) => p.context),
    },
  };
}

/** Compose the deterministic answer for a route, or null → Claude fallback. */
export async function composeBieAnswer(route: BieRoute, opts?: ComposeBieOpts): Promise<BieComposed | null> {
  const cacheKey = largoAnswerCacheKey(route.intent, route.ticker, route.ticker_b, opts?.question);
  let composed = await withServerCache<BieComposed | null>(
    cacheKey,
    BIE_LARGO_ANSWER_TTL_MS,
    () => composeBieAnswerUncached(route, opts),
    { staleWhileRevalidate: true }
  );
  // Backward-compatible envelope guarantee: every answer carries a structured BieAnswerEnvelope for
  // the member UI. Legs that already build one (verdict, and future migrations) keep theirs; a
  // string-only leg is wrapped in a minimal single-section envelope (no fabricated structure).
  if (composed) {
    const { enrichComposedIfNeeded } = await import("@/lib/bie/live-data-enrich");
    composed = await enrichComposedIfNeeded(route, composed, {
      question: opts?.question,
      onStatus: opts?.onStatus,
      userId: opts?.userId,
    });
  }
  if (composed && !composed.envelope) {
    const { envelopeFromMarkdown } = await import("@/lib/bie/answer-envelope");
    composed.envelope = envelopeFromMarkdown(composed.answer, {
      headline: headlineForRoute(route),
      intent: route.intent,
    });
  }
  if (composed) {
    const { applyDynamicFormat } = await import("@/lib/bie/dynamic-format");
    const { toProfessionalMarkdown } = await import("@/lib/bie/professional-tone");
    const formatted = applyDynamicFormat(route, opts?.question, composed);
    formatted.answer = toProfessionalMarkdown(formatted.answer);
    if (formatted.envelope) {
      formatted.envelope = {
        ...formatted.envelope,
        markdown: toProfessionalMarkdown(formatted.envelope.markdown),
        sections: formatted.envelope.sections.map((s) => ({
          ...s,
          body: toProfessionalMarkdown(s.body),
        })),
      };
    }
    return formatted;
  }
  return composed;
}

/** A short headline for the transition-shim envelope of a string-only leg. */
function headlineForRoute(route: BieRoute): string {
  const t = route.ticker ? `${route.ticker} ` : "";
  const map: Partial<Record<string, string>> = {
    spx_desk_read: "SPX Live Desk read",
    spx_structure: "SPX structure",
    spx_invalidation: "SPX invalidation",
    vector_read: `${t}Vector desk read`,
    concept_read: "Definition",
    market_context: "Market context",
    flow_tape: "Flow tape",
    ticker_ecosystem: `${t}ecosystem`,
    ticker_advice: `${t}read`,
    ticker_compare: "Comparison",
    universal_lookup: "Lookup",
    verdict: `${t}verdict`,
    system_diagnostic: `${t}diagnosis`,
    zerodte_plays: "0DTE plays",
    ticker_play_state: `${t}play`,
    cortex_read: `${t}Cortex read`,
    nighthawk_edition: `${t}Night Hawk edition`,
    scenario: `${t}scenario`,
    record_read: "Track record",
    platform_read: "Platform read",
    thermal_read: "Thermal read",
    helix_read: "HELIX analytics",
    grid_rejections_read: "0DTE rejections",
    play_engine_read: "Play engine",
    clarify_read: "Clarify",
    wall_dynamics_read: "Wall dynamics",
    technical_read: "Technicals",
    play_suggest_read: "Play suggestion",
    vector_pulse_read: "Vector Pulse",
  };
  return map[route.intent] ?? "BIE read";
}

async function composeBieAnswerUncached(route: BieRoute, opts?: ComposeBieOpts): Promise<BieComposed | null> {
  try {
    switch (route.intent) {
      case "zerodte_plays":
        return await composeZeroDtePlays();
      case "ticker_play_state":
        return route.ticker ? await composeTickerPlayState(route.ticker) : null;
      case "spx_structure":
        return await composeSpxStructure(opts?.question);
      case "spx_desk_read":
        return await composeSpxDeskRead(opts?.question);
      case "spx_invalidation":
        return await composeSpxInvalidation();
      case "market_context":
        return await composeMarketContext(opts?.question);
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
      case "verdict": {
        // Cross-tool verdict synthesis (task #59) — the only leg that returns a fully-populated
        // BieAnswerEnvelope directly (composeBieAnswer's shim leaves it untouched). Server-only
        // module, dynamically imported so tsx/test never loads its side-effectful deps.
        const { composeVerdict } = await import("@/lib/bie/verdict");
        return await composeVerdict(route.ticker ?? "SPX", opts?.question ?? "");
      }
      case "system_diagnostic": {
        const { composeDiagnostic } = await import("@/lib/bie/diagnostic");
        return await composeDiagnostic(route.ticker ?? "SPX", opts?.question ?? "");
      }
      case "cortex_read": {
        // BIE × Cortex bridge (PR-H) — "why did we commit/skip/exit X" from the PINNED
        // ledger/rejection records, "what does cortex say" via live composition. Returns
        // a fully-populated BieAnswerEnvelope directly (never null — honest no-verdict
        // envelopes on outage), so the shim leaves it untouched.
        const { composeCortexRead } = await import("@/lib/bie/cortex-read");
        return await composeCortexRead(route.ticker, opts?.question ?? "");
      }
      case "nighthawk_edition": {
        // BIE × Night Hawk edition bridge (PR-N9) — "tomorrow's plays" / "why was X
        // picked/pulled" / "what did the morning check see", answered from the #331
        // pinned records (publish_context, morning_verdict, the pulled latch). Returns
        // a fully-populated envelope directly (honest empty/miss envelopes included).
        const { composeNighthawkEditionRead } = await import("@/lib/bie/nighthawk-edition-read");
        return await composeNighthawkEditionRead(route.ticker, opts?.question ?? "");
      }
      case "scenario": {
        // Largo SCENARIO what-if (PR-L4c) — "if SPX drops 1%", "what if QQQ rips 2%",
        // "if we lose the flip". Recomputes regime / walls / max-pain at the SHIFTED spot
        // from the SAME live Vector state, and returns a fully-populated envelope directly
        // (honest "can't scope" envelopes when the shift is unparseable / data absent).
        // The shift is parsed from the member's question text.
        const { composeScenario } = await import("@/lib/bie/scenario-read");
        return await composeScenario(route.ticker ?? "SPX", opts?.question ?? "", { horizon: route.horizon ?? "all" });
      }
      case "record_read": {
        const { composeRecordRead } = await import("@/lib/bie/record-read");
        return await composeRecordRead();
      }
      case "platform_read": {
        const { composePlatformRead } = await import("@/lib/bie/platform-read");
        return await composePlatformRead();
      }
      case "thermal_read": {
        const { composeThermalRead } = await import("@/lib/bie/thermal-read");
        return await composeThermalRead(route.ticker ?? "SPX", opts?.question);
      }
      case "helix_read": {
        const { composeHelixRead } = await import("@/lib/bie/helix-read");
        return await composeHelixRead(route.ticker, opts?.question);
      }
      case "grid_rejections_read": {
        const { composeGridRejectionsRead } = await import("@/lib/bie/grid-rejections-read");
        return await composeGridRejectionsRead(route.ticker);
      }
      case "play_engine_read": {
        const { composePlayEngineRead } = await import("@/lib/bie/play-engine-read");
        return await composePlayEngineRead();
      }
      case "clarify_read": {
        const { composeClarifyRead } = await import("@/lib/bie/clarify-read");
        return composeClarifyRead(opts?.question ?? "");
      }
      case "wall_dynamics_read": {
        const { composeWallDynamicsRead } = await import("@/lib/bie/wall-dynamics-read");
        return await composeWallDynamicsRead(route.ticker ?? "SPX");
      }
      case "technical_read": {
        const { composeTechnicalsRead } = await import("@/lib/bie/technicals-read");
        return await composeTechnicalsRead(route.ticker ?? "SPX", opts?.question);
      }
      case "play_suggest_read": {
        const { composePlaySuggestRead } = await import("@/lib/bie/play-suggest-read");
        return await composePlaySuggestRead(route.ticker);
      }
      case "vector_pulse_read": {
        const { composeVectorPulseRead } = await import("@/lib/bie/vector-pulse-brief");
        const { normalizeDteHorizon } = await import("@/features/vector/lib/vector-dte-horizon");
        return route.ticker
          ? await composeVectorPulseRead(
              route.ticker,
              normalizeDteHorizon(route.horizon ?? "all"),
              opts?.question,
              timeframeMinFromQuestion(opts?.question)
            )
          : null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

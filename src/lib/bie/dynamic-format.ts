import type { BieAnswerEnvelope, BieLevel, BieTable } from "@/lib/bie/answer-envelope";
import { makeEnvelope } from "@/lib/bie/answer-envelope";
import type { BieComposed } from "@/lib/bie/composers-shared";
import { isRichBieEnvelope } from "@/lib/bie/envelope-richness";
import { markdownBullets, markdownTable } from "@/lib/bie/markdown-table";
import { inferAnswerShape } from "@/lib/bie/response-shape";
import type { BieRoute } from "@/lib/bie/router";

const fmt = (n: unknown, d = 0): string =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("en-US", { maximumFractionDigits: d })
    : "—";

function tableFromMarkdown(headers: string[], rows: string[][]): BieTable {
  return { headers, rows };
}

function formatHelixPrintTable(
  ctx: unknown,
  question?: string
): BieTable | null {
  const c = ctx as {
    top?: Array<{
      ticker?: string;
      strike?: number;
      premium?: number;
      direction?: string;
      option_type?: string;
    }>;
    tape?: {
      recent?: Array<{
        ticker: string;
        strike: number;
        premium: number;
        direction: string;
        option_type: string;
      }>;
    };
  };
  const rows_src = c.top ?? c.tape?.recent ?? [];
  if (!rows_src.length) return null;
  const topNMatch = question?.match(/\btop\s+(\d+)\b/i);
  const n = topNMatch ? Math.min(15, Math.max(1, Number(topNMatch[1]))) : 3;
  const sorted = [...rows_src].sort((a, b) => (b.premium ?? 0) - (a.premium ?? 0));
  const rows = sorted.slice(0, n).map((p) => [
    p.ticker ?? "—",
    `${p.strike ?? "—"}${p.option_type === "put" ? "p" : "c"}`,
    `$${fmt(p.premium, 0)}`,
    p.direction ?? "—",
  ]);
  return tableFromMarkdown(["Ticker", "Contract", "Premium", "Side"], rows);
}

function formatGridRejectionsTable(ctx: unknown): BieTable | null {
  const c = ctx as {
    rejections?: Array<{
      ticker: string;
      gate_failed: string;
      direction?: string;
      gross_premium?: number;
      reason?: string;
    }>;
  };
  const rows = c.rejections ?? [];
  if (!rows.length) return null;
  return tableFromMarkdown(
    ["Ticker", "Gate", "Dir", "Gross $", "Note"],
    rows.slice(0, 12).map((r) => [
      r.ticker,
      r.gate_failed,
      r.direction ?? "—",
      `$${fmt(r.gross_premium, 0)}`,
      (r.reason ?? "").slice(0, 48),
    ])
  );
}

function formatPlayEngineTable(ctx: unknown): BieTable | null {
  const c = ctx as {
    openPlay?: {
      status?: string;
      direction?: string;
      entry_price?: number;
      stop?: number;
      target?: number;
      grade?: string;
    } | null;
    lotto?: { phase?: string; direction?: string; strike?: number } | null;
    powerHour?: { phase?: string; direction?: string; strike?: number } | null;
  };
  const rows: string[][] = [];
  const op = c.openPlay;
  if (op?.status === "open") {
    rows.push([
      "Slayer engine",
      "OPEN",
      op.direction === "long" ? "LONG" : "SHORT",
      `${fmt(op.entry_price, 0)} · stop ${fmt(op.stop, 0)} · tgt ${fmt(op.target, 0)} · ${op.grade ?? "—"}`,
    ]);
  } else {
    rows.push(["Slayer engine", "Flat", "—", "Scanning — no OPEN play"]);
  }
  const lotto = c.lotto;
  if (lotto && lotto.phase !== "NONE" && lotto.phase !== "INVALID") {
    rows.push([
      "Lotto",
      lotto.phase ?? "—",
      lotto.direction === "long" ? "calls" : "puts",
      fmt(lotto.strike, 0),
    ]);
  } else {
    rows.push(["Lotto", "Inactive", "—", "NONE this session"]);
  }
  const ph = c.powerHour;
  if (ph && ph.phase !== "NONE") {
    rows.push([
      "Power hour",
      ph.phase ?? "—",
      ph.direction === "long" ? "calls" : "puts",
      fmt(ph.strike, 0),
    ]);
  } else {
    rows.push(["Power hour", "Inactive", "—", "—"]);
  }
  return tableFromMarkdown(["Engine", "Phase", "Bias", "Detail"], rows);
}

function formatThermalMetricTable(ctx: unknown): BieTable | null {
  const c = ctx as {
    positioning?: {
      spot?: number;
      flip?: number;
      net_gex?: number;
      net_vex?: number;
      net_dex?: number;
      net_charm?: number;
      charm_regime_read?: string;
      gamma_regime_read?: string;
      vanna_regime_read?: string;
    };
    narrow?: string;
  };
  const p = c.positioning;
  if (!p) return null;
  if (c.narrow === "charm") {
    return tableFromMarkdown(
      ["Metric", "Value"],
      [
        ["Net CHARM", fmt(p.net_charm, 0)],
        ["Regime", p.charm_regime_read ?? "—"],
        ["Spot", fmt(p.spot, 0)],
        ["γ-flip", fmt(p.flip, 0)],
      ]
    );
  }
  return tableFromMarkdown(
    ["Lens", "Net exposure", "Regime read"],
    [
      ["GEX", fmt(p.net_gex, 0), p.gamma_regime_read ?? "—"],
      ["VEX", fmt(p.net_vex, 0), p.vanna_regime_read ?? "—"],
      ["DEX", fmt(p.net_dex, 0), "—"],
      ["CHARM", fmt(p.net_charm, 0), p.charm_regime_read ?? "—"],
    ]
  );
}

function levelsFromStructureContext(ctx: unknown): BieLevel[] {
  const raw = ctx as { raw?: Record<string, unknown>; narrow?: string };
  const r = raw.raw ?? (ctx as Record<string, unknown>);
  const levels: BieLevel[] = [];
  const push = (label: string, key: string) => {
    const v = r[key];
    if (typeof v === "number" && Number.isFinite(v)) levels.push({ label, price: v });
  };
  if (raw.narrow === "put_wall") push("put wall", "put_wall");
  else if (raw.narrow === "call_wall") push("call wall", "call_wall");
  else if (raw.narrow === "king_node") push("king node", "gex_king_strike");
  else if (raw.narrow === "gamma_flip") push("gamma flip", "gamma_flip");
  else {
    push("γ-flip", "gamma_flip");
    push("call wall", "call_wall");
    push("put wall", "put_wall");
    push("king node", "gex_king_strike");
  }
  push("spot", "price");
  return levels;
}

function headlineForRoute(route: BieRoute): string {
  const t = route.ticker ? `${route.ticker} ` : "";
  const map: Partial<Record<string, string>> = {
    spx_desk_read: "SPX Live Desk",
    spx_structure: "SPX structure",
    helix_read: "HELIX tape",
    thermal_read: "Thermal",
    play_engine_read: "Play engines",
    grid_rejections_read: "Grid rejections",
    ticker_compare: "Compare",
    clarify_read: "Rephrase",
  };
  return map[route.intent] ?? `${t}read`;
}

function buildDynamicEnvelope(
  route: BieRoute,
  shape: ReturnType<typeof inferAnswerShape>,
  body: string,
  table: BieTable | null,
  levels: BieLevel[] | undefined
): BieAnswerEnvelope {
  const sectionTitle =
    shape === "table" ? "Data" : shape === "levels" ? "Levels" : shape === "sentence" ? "Answer" : "Read";

  const levelRows = levels?.filter((l) => l.label !== "spot");
  const structured = shape === "table" || shape === "levels";

  return makeEnvelope({
    headline: headlineForRoute(route),
    bias: "neutral",
    intent: route.intent,
    sections: [
      {
        title: sectionTitle,
        body: table ? "" : body,
        table: table ?? undefined,
        levels: levelRows?.length ? levelRows : undefined,
        confidence: structured
          ? {
              level: "high",
              why: "Formatted dynamically from live platform readers for this question shape.",
            }
          : undefined,
      },
    ],
    levels: levelRows?.length ? levelRows : undefined,
    evidence: [],
    confidence: {
      level: structured ? "high" : "moderate",
      why: structured
        ? "Live data shaped to your question (table/levels)."
        : "Deterministic read from live platform data.",
    },
  });
}

/**
 * Reshape markdown + envelope from the question — tables for compares/lists, one line for brevity,
 * level rows for narrow structure asks. Skips verdict/cortex/compound envelopes that are already rich.
 */
export function applyDynamicFormat(
  route: BieRoute,
  question: string | undefined,
  composed: BieComposed
): BieComposed {
  if (composed.envelope && isRichBieEnvelope(composed.envelope)) {
    return composed;
  }

  const shape = inferAnswerShape(route, question);
  if (shape === "prose" || shape === "sections") {
    return composed;
  }

  const ctx = composed.context;
  let body = composed.answer;
  let levels: BieLevel[] | undefined;
  let table: BieTable | null = null;

  switch (shape) {
    case "table":
      if (route.intent === "helix_read") table = formatHelixPrintTable(ctx, question);
      else if (route.intent === "grid_rejections_read") table = formatGridRejectionsTable(ctx);
      else if (route.intent === "play_engine_read") table = formatPlayEngineTable(ctx);
      else if (route.intent === "thermal_read") table = formatThermalMetricTable(ctx);
      if (table) body = markdownTable(table.headers, table.rows);
      break;
    case "levels":
      levels = levelsFromStructureContext(ctx);
      if (levels.length) {
        const spot = levels.find((l) => l.label === "spot");
        const focus = levels.find((l) => l.label !== "spot" && l.label !== "γ-flip");
        const primary = focus ?? levels.find((l) => l.label !== "spot");
        if (primary) {
          body = `**${primary.label}:** **${fmt(primary.price, 0)}**${spot ? ` · spot **${fmt(spot.price, 0)}**` : ""}`;
        }
      }
      break;
    case "sentence":
      body = body.replace(/\s+/g, " ").trim();
      if (body.length > 320) {
        const first = body.split(/(?<=[.!?])\s+/)[0] ?? body.slice(0, 280);
        body = first.trim();
      }
      break;
    case "bullets":
      if (route.intent === "clarify_read" && !body.includes("\n- ")) {
        body = markdownBullets(body.split("\n").filter((l) => l.trim().length > 0));
      }
      break;
    default:
      break;
  }

  const envelope = buildDynamicEnvelope(route, shape, body, table, levels);

  return {
    answer: envelope.markdown,
    context: composed.context,
    envelope,
  };
}

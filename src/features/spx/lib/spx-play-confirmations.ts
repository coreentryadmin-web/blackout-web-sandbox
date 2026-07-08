import type { SpxConfluence } from "@/features/spx/lib/spx-signals";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { PlayTechnicals } from "@/features/spx/lib/spx-play-technicals";
import { evaluateMtfHybrid, keyLevelForDirection } from "@/features/spx/lib/spx-play-mtf";
import { playMinConfirmationsRequired, playStructureProximityPts } from "@/features/spx/lib/spx-play-config";
// Canonical news-sentiment patterns live in spx-play-conflicts to avoid duplication.
import { BEAR_NEWS, BULL_NEWS } from "@/features/spx/lib/spx-play-conflicts";

export type PlayConfirmationCheck = {
  label: string;
  passed: boolean;
  required: boolean;
  detail: string;
};

export type PlayConfirmationResult = {
  passed: boolean;
  passed_count: number;
  total: number;
  checks: PlayConfirmationCheck[];
};

function newsSentiment(headlines: SpxDeskPayload["news_headlines"]): "bullish" | "bearish" | "neutral" {
  let bull = 0;
  let bear = 0;
  for (const h of headlines.slice(0, 5)) {
    const t = h.title ?? "";
    if (BEAR_NEWS.test(t)) bear += 1;
    if (BULL_NEWS.test(t)) bull += 1;
  }
  if (bear > bull) return "bearish";
  if (bull > bear) return "bullish";
  return "neutral";
}

function nearLevel(price: number, level: number | null, pts = playStructureProximityPts()): boolean {
  return level != null && Math.abs(price - level) <= pts;
}

export type FlowAlignment = {
  aligned: boolean;
  thin: boolean;
  detail: string;
};

function evaluateFlowAlignment(desk: SpxDeskPayload, direction: "long" | "short"): FlowAlignment {
  const net = desk.flow_0dte_net;
  if (net != null && Math.abs(net) > 40_000) {
    if (direction === "long" && net > 0) {
      return { aligned: true, thin: false, detail: "0DTE call premium leading" };
    }
    if (direction === "short" && net < 0) {
      return { aligned: true, thin: false, detail: "0DTE put premium leading" };
    }
    return { aligned: false, thin: false, detail: "0DTE net flow opposes direction" };
  }

  let bull = 0;
  let bear = 0;
  for (const f of desk.spx_flows?.slice(0, 6) ?? []) {
    if (f.direction === "bullish" || f.option_type.toUpperCase().startsWith("C")) bull += f.premium;
    else bear += f.premium;
  }
  if (bull + bear < 50_000) {
    return {
      aligned: false,
      thin: true,
      detail: "Thin 0DTE flow — early session, not blocking",
    };
  }
  const aligned = direction === "long" ? bull > bear * 1.1 : bear > bull * 1.1;
  return {
    aligned,
    thin: false,
    detail: aligned ? "SPX flow skew aligned" : "Flow not confirming direction",
  };
}

export function flowAlignedForDirection(desk: SpxDeskPayload, direction: "long" | "short"): boolean {
  const flow = evaluateFlowAlignment(desk, direction);
  if (flow.thin) return true;
  return flow.aligned;
}

function structureAligned(
  desk: SpxDeskPayload,
  direction: "long" | "short",
  opts: { t1Trigger: boolean; keyLevel: number }
): { passed: boolean; detail: string } {
  const price = desk.price;
  const supports = (desk.levels ?? []).filter((l) => l.kind === "support");
  const resistances = (desk.levels ?? []).filter((l) => l.kind === "resistance");

  if (direction === "long") {
    const atSupport = supports.some((l) => nearLevel(price, l.value));
    const wall = desk.gex_walls?.find((w) => w.kind === "support" && nearLevel(price, w.strike));
    if (atSupport || wall) {
      return {
        passed: true,
        detail: wall
          ? `Long at GEX support ${wall.strike.toFixed(0)}`
          : `Long near ${supports[0]?.label ?? "support"} ${supports[0]?.value?.toFixed(0)}`,
      };
    }
    if (desk.above_vwap && nearLevel(price, desk.vwap)) {
      return { passed: true, detail: "Long — holding VWAP support" };
    }
    if (desk.above_vwap && desk.vwap != null) {
      return { passed: true, detail: "Long — above VWAP trend hold (between nodes)" };
    }
    if (opts.t1Trigger) {
      return { passed: true, detail: `Long — MTF trigger @ ${opts.keyLevel.toFixed(0)}` };
    }
    return { passed: false, detail: "Long needs support node / VWAP hold" };
  }

  const atResistance = resistances.some((l) => nearLevel(price, l.value));
  const wall = desk.gex_walls?.find((w) => w.kind === "resistance" && nearLevel(price, w.strike));
  if (atResistance || wall) {
    return {
      passed: true,
      detail: wall
        ? `Short at GEX resistance ${wall.strike.toFixed(0)}`
        : `Short near ${resistances[0]?.label ?? "resistance"} ${resistances[0]?.value?.toFixed(0)}`,
    };
  }
  if (!desk.above_vwap && nearLevel(price, desk.vwap)) {
    return { passed: true, detail: "Short — below VWAP resistance" };
  }
  if (!desk.above_vwap && desk.vwap != null) {
    return { passed: true, detail: "Short — below VWAP trend hold (between nodes)" };
  }
  if (opts.t1Trigger) {
    return { passed: true, detail: `Short — MTF trigger @ ${opts.keyLevel.toFixed(0)}` };
  }
  return { passed: false, detail: "Short needs resistance node / VWAP reject" };
}

export function evaluatePlayConfirmations(
  desk: SpxDeskPayload,
  confluence: SpxConfluence,
  technicals: PlayTechnicals
): PlayConfirmationResult {
  const direction = confluence.direction;
  const checks: PlayConfirmationCheck[] = [];

  if (!direction) {
    return { passed: false, passed_count: 0, total: 0, checks: [] };
  }

  const keyLevel = keyLevelForDirection(desk, direction, confluence);
  const hybrid = evaluateMtfHybrid(direction, keyLevel, technicals, confluence.grade, confluence.score);

  // m3Ok: hard 3m close confirmation OR soft 3m bypass (uses soft_3m, not soft_5m,
  // to avoid double-counting a 5m bypass as a 3m pass).
  const m3Ok = hybrid.t2_confirm_3m || (hybrid.ok && hybrid.soft_3m);
  checks.push({
    label: "3m MTF",
    required: true,
    passed: m3Ok,
    detail: m3Ok
      ? `3m hold @ ${keyLevel.toFixed(2)} · close ${technicals.m3_close?.toFixed(2) ?? "—"}${hybrid.soft_3m ? " (soft)" : ""}`
      : hybrid.failure_reason ?? "3m close has not confirmed direction",
  });

  const m5Ok = hybrid.t3_regime_5m || (hybrid.ok && hybrid.soft_5m);
  const m5Detail = m5Ok
    ? `${hybrid.summary} · RSI ${technicals.m5_rsi?.toFixed(0) ?? "—"}${technicals.m5_rsi_warning ? ` · ${technicals.m5_rsi_warning}` : ""}`
    : `5m ${technicals.m5_trend} opposes ${direction}`;
  checks.push({
    label: "5m trend",
    required: true,
    passed: m5Ok,
    detail: m5Detail,
  });

  const struct = structureAligned(desk, direction, {
    t1Trigger: hybrid.t1_trigger,
    keyLevel,
  });
  checks.push({
    label: "S/R structure",
    required: true,
    passed: struct.passed,
    detail: struct.detail,
  });

  const breakoutOk =
    direction === "long"
      ? technicals.breakout.pdh_break ||
        technicals.breakout.hod_break ||
        technicals.breakout.vwap_reclaim ||
        (desk.above_vwap && desk.vwap != null) ||
        hybrid.t1_trigger
      : technicals.breakout.pdl_break ||
        technicals.breakout.lod_break ||
        technicals.breakout.vwap_lost ||
        (!desk.above_vwap && desk.vwap != null) ||
        hybrid.t1_trigger;
  checks.push({
    label: "Breakout / level",
    required: true,
    passed: breakoutOk,
    detail:
      direction === "long"
        ? technicals.breakout.pdh_break
          ? "PDH breakout"
          : technicals.breakout.hod_break
            ? "HOD breakout"
            : technicals.breakout.vwap_reclaim
              ? "VWAP reclaim"
              : desk.above_vwap
                ? "Above VWAP — trend hold"
                : hybrid.t1_trigger
                  ? "At key level trigger"
                  : "No breakout / level hold"
        : technicals.breakout.pdl_break
          ? "PDL breakdown"
          : technicals.breakout.lod_break
            ? "LOD breakdown"
            : technicals.breakout.vwap_lost
              ? "VWAP rejection"
              : !desk.above_vwap
                ? "Below VWAP — trend hold"
                : hybrid.t1_trigger
                  ? "At key level trigger"
                  : "No breakdown / level hold",
  });

  const flow = evaluateFlowAlignment(desk, direction);
  checks.push({
    label: "0DTE flow",
    required: !flow.thin,
    passed: flow.aligned || flow.thin,
    detail: flow.detail,
  });

  const dp = desk.dark_pool?.bias;
  const dpOk = !dp || dp === "neutral" || dp === "mixed" || dp === (direction === "long" ? "bullish" : "bearish");
  checks.push({
    label: "Dark pool",
    required: false,
    passed: dpOk,
    detail: dp ? `Dark pool ${dp}` : "No dark pool bias",
  });

  const tide = desk.tide_bias;
  const tideOk = !tide || tide === "neutral" || tide === (direction === "long" ? "bullish" : "bearish");
  checks.push({
    label: "Market tide",
    required: false,
    passed: tideOk,
    detail: tide ? `Tide ${tide}` : "Tide neutral",
  });

  // TICK thresholds: ±400 is a meaningful signal threshold — NYSE TICK routinely
  // fluctuates ±300 on normal days, so ±800 was nearly always passing and added
  // no real filter. ±400 blocks entries when breadth is genuinely opposed.
  const tickOk =
    desk.tick == null ||
    (direction === "long" ? desk.tick > -400 : desk.tick < 400);
  checks.push({
    label: "Internals",
    required: false,
    passed: tickOk,
    detail: desk.tick != null ? `TICK ${desk.tick > 0 ? "+" : ""}${desk.tick.toFixed(0)}` : "TICK n/a",
  });

  const news = newsSentiment(desk.news_headlines ?? []);
  const newsOk =
    news === "neutral" ||
    (direction === "long" && news === "bullish") ||
    (direction === "short" && news === "bearish");
  const topHeadline = desk.news_headlines?.[0]?.title?.slice(0, 80) ?? "none";
  checks.push({
    label: "News catalyst",
    required: false,
    passed: newsOk,
    detail: newsOk ? `News ${news} · ${topHeadline}` : `News opposes ${direction}: ${topHeadline}`,
  });

  const price = desk.price;
  const gexOk =
    direction === "long"
      ? // Require a GEX support wall within 10 pts below price — a wall at SPX 4000 while
        // price is at 5600 is irrelevant and should not satisfy the GEX confirmation.
        (desk.gamma_regime !== "amplification" || desk.above_gamma_flip) &&
        (desk.gex_walls?.some((w) => w.kind === "support" && w.strike >= price - 10) ?? false)
      : // Resistance within 10 pts above price caps upside for shorts (symmetric to long support).
        (desk.gamma_regime !== "amplification" || !desk.above_gamma_flip) &&
        (desk.gex_walls?.some(
          (w) => w.kind === "resistance" && w.strike >= price - 2 && w.strike <= price + 12
        ) ?? false);
  checks.push({
    label: "Dealer GEX",
    required: false,
    passed: gexOk,
    detail: `γ ${desk.gamma_regime} · flip ${desk.gamma_flip?.toFixed(0) ?? "—"}`,
  });

  const vixOk =
    desk.vix == null ||
    desk.vix < 30 ||
    (direction === "short" && desk.vix > 18);
  checks.push({
    label: "Vol regime",
    required: false,
    passed: vixOk,
    detail: desk.vix != null ? `VIX ${desk.vix.toFixed(1)}` : "VIX n/a",
  });

  const passedCount = checks.filter((c) => c.passed).length;
  const requiredFailed = checks.some((c) => c.required && !c.passed);
  const minRequired = playMinConfirmationsRequired();

  return {
    passed: !requiredFailed && passedCount >= minRequired,
    passed_count: passedCount,
    total: checks.length,
    checks,
  };
}

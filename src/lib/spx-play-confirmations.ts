import type { SpxConfluence } from "@/lib/spx-signals";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import type { PlayTechnicals } from "@/lib/spx-play-technicals";
import { evaluateMtfHybrid, keyLevelForDirection } from "@/lib/spx-play-mtf";
import { playMinConfirmationsRequired, playStructureProximityPts } from "@/lib/spx-play-config";

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

const BEAR_NEWS = /\b(crash|plunge|selloff|sell-off|hawkish|hot cpi|inflation surge|war|recession|downgrade|lawsuit|probe|tariff)\b/i;
const BULL_NEWS = /\b(rally|surge|soar|dovish|rate cut|beat estimates|record high|stimulus|ceasefire)\b/i;

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

function flowAligned(desk: SpxDeskPayload, direction: "long" | "short"): boolean {
  const net = desk.flow_0dte_net;
  if (net != null && Math.abs(net) > 75_000) {
    if (direction === "long" && net > 0) return true;
    if (direction === "short" && net < 0) return true;
  }

  let bull = 0;
  let bear = 0;
  for (const f of desk.spx_flows?.slice(0, 6) ?? []) {
    if (f.direction === "bullish" || f.option_type.toUpperCase().startsWith("C")) bull += f.premium;
    else bear += f.premium;
  }
  if (bull + bear < 100_000) return false;
  return direction === "long" ? bull > bear * 1.2 : bear > bull * 1.2;
}

function structureAligned(desk: SpxDeskPayload, direction: "long" | "short"): { passed: boolean; detail: string } {
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

  const m3Ok = hybrid.t2_confirm_3m || (hybrid.ok && hybrid.soft_5m);
  checks.push({
    label: "3m MTF",
    required: true,
    passed: m3Ok,
    detail: m3Ok
      ? `3m hold @ ${keyLevel.toFixed(2)} · close ${technicals.m3_close?.toFixed(2) ?? "—"}${hybrid.soft_5m ? " (soft)" : ""}`
      : hybrid.failure_reason ?? "3m close has not confirmed direction",
  });

  const m5Ok = hybrid.t3_regime_5m || (hybrid.ok && hybrid.soft_5m);
  checks.push({
    label: "5m trend",
    required: true,
    passed: m5Ok,
    detail: m5Ok
      ? `${hybrid.summary} · RSI ${technicals.m5_rsi?.toFixed(0) ?? "—"}`
      : `5m ${technicals.m5_trend} opposes ${direction}`,
  });

  const struct = structureAligned(desk, direction);
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
        struct.passed
      : technicals.breakout.pdl_break ||
        technicals.breakout.lod_break ||
        technicals.breakout.vwap_lost ||
        struct.passed;
  checks.push({
    label: "Breakout / level",
    required: true,
    passed: breakoutOk,
    detail:
      direction === "long"
        ? technicals.breakout.pdh_break
          ? "PDH breakout"
          : technicals.breakout.vwap_reclaim
            ? "VWAP reclaim"
            : struct.detail
        : technicals.breakout.pdl_break
          ? "PDL breakdown"
          : technicals.breakout.vwap_lost
            ? "VWAP rejection"
            : struct.detail,
  });

  const flowOk = flowAligned(desk, direction);
  checks.push({
    label: "0DTE flow",
    required: true,
    passed: flowOk,
    detail: flowOk ? "SPX flow skew aligned" : "Flow not confirming direction",
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

  const tickOk =
    desk.tick == null ||
    (direction === "long" ? desk.tick > -100 : desk.tick < 100);
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
    required: true,
    passed: newsOk,
    detail: newsOk ? `News ${news} · ${topHeadline}` : `News opposes ${direction}: ${topHeadline}`,
  });

  const gexOk =
    direction === "long"
      ? (desk.gamma_regime !== "amplification" || desk.above_gamma_flip) &&
        (desk.gex_walls?.some((w) => w.kind === "support") ?? false)
      : (desk.gamma_regime !== "amplification" || !desk.above_gamma_flip) &&
        (desk.gex_walls?.some((w) => w.kind === "resistance") ?? false);
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

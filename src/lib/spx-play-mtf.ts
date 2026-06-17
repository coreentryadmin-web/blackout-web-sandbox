import type { SpxConfluence, SpxPlayDirection } from "@/lib/spx-signals";
import type { PlayTechnicals } from "@/lib/spx-play-technicals";
import { gradeRank, playMtfBufferPts } from "@/lib/spx-play-config";

export type MtfHybrid = {
  ok: boolean;
  soft_5m: boolean;
  t1_trigger: boolean;
  t2_confirm_3m: boolean;
  t3_regime_5m: boolean;
  failure_reason: string | null;
  summary: string;
};

function soft3mAllowed(grade: string, score: number): boolean {
  return gradeRank(grade) >= 3 && Math.abs(score) >= 75;
}

function soft5mAllowed(grade: string): boolean {
  return gradeRank(grade) >= 3;
}

/** Discord-style hybrid MTF: 1m trigger → 3m close hold → 5m regime filter. */
export function evaluateMtfHybrid(
  direction: SpxPlayDirection,
  keyLevel: number | null,
  technicals: PlayTechnicals,
  grade: string,
  score: number
): MtfHybrid {
  const buf = playMtfBufferPts();
  const level = keyLevel ?? technicals.price;
  const m3 = technicals.m3_close;
  const fail: string[] = [];

  const t1 =
    direction === "long"
      ? technicals.price >= level - buf
      : technicals.price <= level + buf;

  let t2 = false;
  if (m3 == null) {
    fail.push("3m bar unavailable");
  } else if (direction === "long") {
    t2 = m3 >= level + buf;
    if (!t2) fail.push(`3m close ${m3.toFixed(2)} below level ${level.toFixed(2)}`);
  } else {
    t2 = m3 <= level - buf;
    if (!t2) fail.push(`3m close ${m3.toFixed(2)} above level ${level.toFixed(2)}`);
  }

  let t3 =
    direction === "long" ? technicals.mtf.m5_confirms_long : technicals.mtf.m5_confirms_short;
  if (!t3) {
    fail.push(`5m ${technicals.m5_trend} RSI ${technicals.m5_rsi?.toFixed(0) ?? "—"} opposes ${direction}`);
  }

  let ok = t1 && t2 && t3;
  let soft_5m = false;

  if (!t2 && soft3mAllowed(grade, score) && t3) {
    ok = true;
    soft_5m = true;
    fail.push("soft 3m (A/A+ high score)");
  } else if (!t3 && soft5mAllowed(grade) && t1 && t2) {
    ok = true;
    soft_5m = true;
    fail.push("soft 5m (A/A+ grade)");
  }

  const summary = `T1 ${t1 ? "✓" : "✗"} · T2 3m ${t2 ? "✓" : soft_5m ? "~" : "✗"} · T3 5m ${t3 ? "✓" : soft_5m ? "~" : "✗"}`;

  return {
    ok,
    soft_5m,
    t1_trigger: t1,
    t2_confirm_3m: t2,
    t3_regime_5m: t3,
    failure_reason: fail.length ? fail[0] : null,
    summary,
  };
}

/** Strict MTF for WATCH→ENTRY promote (no soft pass). */
export function mtfHardPass(
  direction: SpxPlayDirection,
  keyLevel: number | null,
  technicals: PlayTechnicals
): boolean {
  const h = evaluateMtfHybrid(direction, keyLevel, technicals, "A", 80);
  return h.t1_trigger && h.t2_confirm_3m && h.t3_regime_5m;
}

export function keyLevelForDirection(
  desk: { price: number; vwap: number | null; levels?: Array<{ kind: string; value: number | null }> },
  direction: SpxPlayDirection,
  confluence: SpxConfluence
): number {
  if (direction === "long") {
    return (
      confluence.levels.stop ??
      desk.levels?.find((l) => l.kind === "support")?.value ??
      desk.vwap ??
      desk.price
    );
  }
  return (
    confluence.levels.stop ??
    desk.levels?.find((l) => l.kind === "resistance")?.value ??
    desk.vwap ??
    desk.price
  );
}

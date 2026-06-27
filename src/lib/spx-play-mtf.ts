import type { SpxConfluence, SpxPlayDirection } from "@/lib/spx-signals";
import type { PlayTechnicals } from "@/lib/spx-play-technicals";
import { gradeRank, playMtfBufferPts } from "@/lib/spx-play-config";

export type MtfHybrid = {
  ok: boolean;
  /** True when the 3m close check was bypassed via soft pass (high-grade, high-score). */
  soft_3m: boolean;
  /** True when the 5m regime check was bypassed via soft pass (A/A+ grade). */
  soft_5m: boolean;
  t1_trigger: boolean;
  t2_confirm_3m: boolean;
  t3_regime_5m: boolean;
  failure_reason: string | null;
  summary: string;
};

function soft3mAllowed(grade: string, score: number): boolean {
  // Was 58 (the BUY threshold) — circular: couldn't get the MTF bypass that
  // helps reach 58 without already being at 58. Lowered to 45 to unblock
  // B-grade setups in the WATCHING band from the promote path.
  return gradeRank(grade) >= 2 && Math.abs(score) >= 45;
}

function soft5mAllowed(grade: string): boolean {
  return gradeRank(grade) >= 2;
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
    fail.push(`5m trend ${technicals.m5_trend} opposes ${direction}`);
  }

  let ok = t1 && t2 && t3;
  let soft_3m = false;
  let soft_5m = false;

  if (!t2 && soft3mAllowed(grade, score) && t3) {
    // 3m close didn't confirm but grade/score is high enough to soft-pass it.
    // soft_3m = true, soft_5m stays false — only the 3m check was bypassed.
    ok = true;
    soft_3m = true;
    fail.push("soft 3m (A/A+ high score)");
  } else if (!t3 && soft5mAllowed(grade) && t1 && t2) {
    // 5m regime didn't confirm but grade is high enough to soft-pass it.
    // soft_5m = true, soft_3m stays false — only the 5m check was bypassed.
    ok = true;
    soft_5m = true;
    fail.push("soft 5m (A/A+ grade)");
  }

  const summary = `T1 ${t1 ? "✓" : "✗"} · T2 3m ${t2 ? "✓" : soft_3m ? "~" : "✗"} · T3 5m ${t3 ? "✓" : soft_5m ? "~" : "✗"}`;

  return {
    ok,
    soft_3m,
    soft_5m,
    t1_trigger: t1,
    t2_confirm_3m: t2,
    t3_regime_5m: t3,
    failure_reason: fail.length ? fail[0] : null,
    summary,
  };
}

/**
 * Strict MTF for WATCH→ENTRY promote (no soft pass).
 *
 * We call evaluateMtfHybrid with synthetic grade="A" score=80 so that soft3mAllowed /
 * soft5mAllowed return true internally — but we intentionally IGNORE h.ok (which would
 * reflect any soft bypasses) and instead check only the three raw flags t1/t2/t3.
 * This means soft_3m and soft_5m have no effect on the return value: a hard pass
 * requires all three timeframe checks to fire independently. The synthetic grade/score
 * is a harmless no-op here — it enables soft paths inside evaluateMtfHybrid but we
 * never read h.ok or h.soft_3m/soft_5m, so the result is strictly hard-pass only.
 */
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
  // For a long, the stop is a support level BELOW price — T1 (price >= level - buf) is
  // trivially true when level is the stop and nearly meaningless as a trigger confirmation.
  // Prefer VWAP or the nearest support node above stop as a more meaningful anchor.
  // For a short, same problem inverted — prefer VWAP or resistance over the stop.
  if (direction === "long") {
    return (
      desk.vwap ??
      desk.levels?.find((l) => l.kind === "support")?.value ??
      confluence.levels.stop ??
      desk.price
    );
  }
  return (
    desk.vwap ??
    desk.levels?.find((l) => l.kind === "resistance")?.value ??
    confluence.levels.stop ??
    desk.price
  );
}

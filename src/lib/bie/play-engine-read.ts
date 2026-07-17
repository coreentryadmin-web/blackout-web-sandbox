import { getCachedBiePlatformContext } from "@/lib/bie/platform-cache";
import type { BieComposed } from "@/lib/bie/composers-shared";

const fmt = (n: unknown, d = 0): string =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("en-US", { maximumFractionDigits: d })
    : "—";

/** SPX Slayer play engine + lotto + power-hour — no full desk dump. */
export async function composePlayEngineRead(): Promise<BieComposed> {
  const platform = await getCachedBiePlatformContext({ scope: "desk" });
  const { openPlay, lotto, powerHour } = platform.cross;
  const lines = ["**SPX play engine state (live)**", ""];

  if (openPlay && openPlay.status === "open") {
    const dir = openPlay.direction === "long" ? "LONG" : "SHORT";
    lines.push(
      `- **Slayer engine:** OPEN **${dir}** · entry ${fmt(openPlay.entry_price, 0)} · stop ${fmt(openPlay.stop, 0)} · target ${fmt(openPlay.target, 0)} · grade ${openPlay.grade ?? "—"}`
    );
  } else {
    lines.push("- **Slayer engine:** flat / scanning — no committed OPEN play on the board.");
  }

  if (lotto && lotto.phase !== "NONE" && lotto.phase !== "INVALID") {
    const side = lotto.direction === "long" ? "calls" : "puts";
    lines.push(`- **Lotto engine:** phase **${lotto.phase}** · ${side} ${fmt(lotto.strike, 0)}`);
  } else {
    lines.push("- **Lotto engine:** inactive (NONE / no arm this session).");
  }

  if (powerHour && powerHour.phase !== "NONE") {
    const side = powerHour.direction === "long" ? "calls" : "puts";
    lines.push(`- **Power hour:** phase **${powerHour.phase}** · ${side} ${fmt(powerHour.strike, 0)}`);
  } else {
    lines.push("- **Power hour:** not active.");
  }

  lines.push("", "_For the full desk thesis ask **What's the SPX setup right now?**_");

  return { answer: lines.join("\n"), context: { openPlay, lotto, powerHour } };
}

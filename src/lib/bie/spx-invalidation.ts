// SPX play / thesis invalidation — deterministic levels from confluence + engine.

import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { SpxConfluence } from "@/features/spx/lib/spx-signals";
import type { SpxDeskBriefCross } from "@/lib/bie/spx-desk-brief";

const fmt = (n: number | null | undefined, d = 0): string =>
  n != null && Number.isFinite(n)
    ? n.toLocaleString("en-US", { maximumFractionDigits: d })
    : "—";

export function composeSpxInvalidationLines(
  desk: SpxDeskPayload,
  confluence: SpxConfluence,
  cross?: SpxDeskBriefCross
): string[] {
  const lines: string[] = ["**SPX — what flips / kills the read**", ""];
  const { stop, target } = confluence.levels;

  if (stop != null) {
    lines.push(`- **Thesis dead below ${fmt(stop, 0)}** — confluence invalidation (go flat).`);
  }
  if (desk.gamma_flip != null) {
    const side = desk.above_gamma_flip ? "below" : "above";
    lines.push(
      `- **γ regime flips on cross ${side} ${fmt(desk.gamma_flip, 0)}** — dealer hedging behavior inverts.`
    );
  }
  if (desk.vwap != null && desk.price != null) {
    const vwapSide = desk.price >= desk.vwap ? "lose" : "reclaim";
    lines.push(`- **VWAP ${fmt(desk.vwap, 0)}** — ${vwapSide} it and session bias shifts.`);
  }

  const op = cross?.openPlay;
  if (op?.status === "open" && op.stop != null) {
    lines.push(`- **ENGINE stop ${fmt(op.stop, 0)}** — live ${op.direction.toUpperCase()} play exits here.`);
  }
  if (target != null) {
    lines.push(`- **Target ${fmt(target, 0)}** — upside objective if thesis holds.`);
  }

  const walls = desk.gex_walls ?? [];
  const callWall = walls.find((w) => w.kind === "resistance");
  const putWall = walls.find((w) => w.kind === "support");
  if (callWall) lines.push(`- **Call wall ${fmt(callWall.strike, 0)}** — upside cap / pin magnet.`);
  if (putWall) lines.push(`- **Put wall ${fmt(putWall.strike, 0)}** — support shelf.`);

  lines.push("", `_Levels from SPX Slayer confluence + live engine — same numbers on the desk._`);
  return lines;
}

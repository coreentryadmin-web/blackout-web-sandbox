// BLACKOUT Intelligence Engine — deterministic Vector desk brief.
//
// The Vector analogue of composeSpxDeskBrief: assembles a { headline, bias, body,
// watch, as_of } read entirely from a VectorFullState — the grounded surface brief
// lines (regime / walls / magnet / max pain / expected move / ladder / flow) plus the
// single concrete play the engine already derived (state.play), formatted into
// SETUP / RISK / NEXT. Every number traces back to the state; no LLM, no network.

import type { VectorFullState } from "@/lib/bie/vector-full-state";
import type { VectorPlayBias } from "@/features/vector/lib/vector-play-engine";
import {
  regimeBriefLine,
  wallsBriefLine,
  magnetBriefLine,
  maxPainBriefLine,
  expectedMoveBriefLine,
  flowBriefLine,
  ladderBriefLine,
} from "@/lib/bie/vector-desk-intel";

export type VectorDeskBriefResult = {
  headline: string;
  bias: "bullish" | "bearish" | "neutral";
  body: string;
  /** The "watch this NOW" set — the play's starred items (headline first). */
  watch: string[];
  as_of: string;
};

function num(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function n(v: number | null | undefined, d = 2): string {
  if (v == null || !Number.isFinite(v)) return "{{—}}";
  return `{{${v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}}}`;
}

/** Map the play's trade bias to the desk's bullish/bearish/neutral rail bias. A range or neutral
 *  play is genuinely two-way — neither bullish nor bearish — so it maps to neutral, not a guess. */
function biasFor(playBias: VectorPlayBias | undefined): "bullish" | "bearish" | "neutral" {
  if (playBias === "long") return "bullish";
  if (playBias === "short") return "bearish";
  return "neutral";
}

/**
 * Compose the Vector desk brief for a full state. `question` is accepted for parity with
 * composeSpxDeskBrief (and future premise-correction routing) but is not required — the read is
 * fully determined by the state.
 */
export function composeVectorDeskBrief(
  state: VectorFullState,
  _question?: string
): VectorDeskBriefResult {
  const play = state.play ?? null;
  const spot = num(state.spot);
  const bias = biasFor(play?.bias);

  const regimeLabel =
    state.regime?.posture === "long"
      ? "LONG-γ"
      : state.regime?.posture === "short"
        ? "SHORT-γ"
        : state.regime?.posture === "transition"
          ? "AT-FLIP"
          : "";

  const verb = play ? `{{${play.grade}}} ${play.style.toUpperCase()} ${play.bias.toUpperCase()}` : "NO-EDGE";
  const headline = [state.ticker, spot != null ? n(spot) : "", verb, regimeLabel]
    .filter(Boolean)
    .join(" · ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);

  // Surface brief lines — one per Vector read, in the order a desk scans them.
  const lines: string[] = [
    regimeBriefLine(state),
    wallsBriefLine(state),
    magnetBriefLine(state),
    maxPainBriefLine(state),
    expectedMoveBriefLine(state),
    ladderBriefLine(state),
    flowBriefLine(state),
  ].filter(Boolean) as string[];

  if (play) {
    lines.push(`PLAY  ${play.headline}`);
    lines.push(`THESIS  ${play.thesis}`);
    const targets = play.targets.length ? play.targets.join(" → ") : "—";
    lines.push(`SETUP  ${play.entryZone ?? "—"} · targets ${targets}`);
    lines.push(
      `RISK  ${play.invalidation ?? "no hard invalidation"} · conviction {{${play.conviction}}} grade {{${play.grade}}}`
    );
    // NEXT = the first imminent "watch now" item after the headline (starred[0] is the headline),
    // else the live wall/flip proximity callout.
    const watchNow = play.starred.slice(1).find(Boolean) ?? state.proximity?.callout ?? "watch the flip + nearest wall";
    lines.push(`NEXT  ${watchNow}`);
  } else {
    // buildVectorPlay returns null only when there is no spot or no structure at all.
    lines.push(
      "SETUP  No clean play — structure too sparse for a high-conviction read; wait for spot to engage a level or the regime to declare."
    );
  }

  // watch = the play's starred set (headline first) so the caller can surface the same "eyes on
  // this now" items the chart terminal stars; always at least one line.
  const watch = play?.starred?.length ? play.starred : ["Waiting for a clean Vector setup to form."];

  return {
    headline,
    bias,
    body: lines.join("\n"),
    watch,
    as_of: state.asOf ?? new Date().toISOString(),
  };
}

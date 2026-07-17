import type { BieRoute } from "@/lib/bie/router";
import {
  wantsBrevity,
  wantsCallWallOnly,
  wantsCharmLens,
  wantsGammaFlipOnly,
  wantsGexVexCompare,
  wantsHelixPrintList,
  wantsKingNodeOnly,
  wantsPutWallOnly,
} from "@/lib/bie/question-focus";

/** How the member-facing answer should be shaped for this turn. */
export type AnswerShape = "sentence" | "table" | "levels" | "bullets" | "sections" | "prose";

export function inferAnswerShape(route: BieRoute, question?: string): AnswerShape {
  const q = question?.trim() ?? "";
  if (!q) {
    if (route.intent === "ticker_compare") return "table";
    if (route.intent === "grid_rejections_read" || route.intent === "play_engine_read") return "table";
    return "prose";
  }
  if (wantsBrevity(q)) return "sentence";
  if (wantsHelixPrintList(q)) return "table";
  if (wantsCharmLens(q) || wantsGexVexCompare(q)) return "table";
  if (
    wantsPutWallOnly(q) ||
    wantsCallWallOnly(q) ||
    wantsKingNodeOnly(q) ||
    wantsGammaFlipOnly(q)
  ) {
    return "levels";
  }
  switch (route.intent) {
    case "ticker_compare":
    case "grid_rejections_read":
    case "play_engine_read":
      return "table";
    case "clarify_read":
      return "bullets";
    case "platform_read":
    case "compound_lookup":
      return "sections";
    case "spx_desk_read":
      if (/\b(full|setup|read|why|explain)\b/i.test(q)) return "sections";
      return "prose";
    default:
      return "prose";
  }
}

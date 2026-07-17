import type { BieComposed } from "@/lib/bie/composers-shared";
import { wantsHonestUnknown } from "@/lib/bie/question-focus";

const SUGGESTIONS = [
  "**SPX desk** — *What's the SPX setup right now?*",
  "**Structure** — *What's the SPX gamma flip and put wall?*",
  "**Flow** — *Any unusual flow on SPX?*",
  "**Ticker** — *Should I buy NVDA calls into earnings?* or *Compare NVDA vs AMD*",
  "**Products** — *What's on the HELIX tape?* · *Thermal GEX on SPX* · *Grid scanner rejections*",
];

/** Honest rephrase prompt — never a platform dump. */
export function composeClarifyRead(question: string): BieComposed {
  if (wantsHonestUnknown(question)) {
    return {
      answer: [
        "Honest limits on what I can answer from **live platform data**:",
        "",
        "- I don't have your private watchlist, broker fills, or off-platform news unless it's in the desk feed.",
        "- I won't invent strike-level flow if the tape is quiet — I'll say so.",
        "- Admin/cron internals and raw Redis dumps aren't exposed here.",
        "",
        "Ask a **specific** market question (ticker, level, product) and I'll read the same data the dashboards use.",
      ].join("\n"),
      context: { kind: "honest_unknown" },
    };
  }

  return {
    answer: [
      "I didn't map that to a specific live read — rephrase with **what you want** (ticker, level, or product).",
      "",
      "Examples:",
      ...SUGGESTIONS.map((s) => `- ${s}`),
    ].join("\n"),
    context: { kind: "clarify", question },
  };
}

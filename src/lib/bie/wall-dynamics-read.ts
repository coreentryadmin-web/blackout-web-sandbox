import { getCachedBiePlatformContext } from "@/lib/bie/platform-cache";
import type { BieComposed } from "@/lib/bie/composers-shared";
import { wallsBriefLine as spxWallsBriefLine } from "@/lib/bie/spx-desk-intel";
import { toProfessionalMarkdown } from "@/lib/bie/professional-tone";

const fmt = (n: unknown, d = 0): string =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("en-US", { maximumFractionDigits: d })
    : "—";

/** Dealer wall ladder + build/fade dynamics — SPX via desk intel; single names via Vector rail. */
export async function composeWallDynamicsRead(ticker: string): Promise<BieComposed | null> {
  const sym = (ticker.trim().toUpperCase() || "SPX").replace(/^SPXW$/, "SPX");

  if (sym !== "SPX") {
    const { fetchVectorFullState } = await import("@/lib/bie/vector-full-state");
    const { wallsBriefLine, wallDynamicsBriefLine } = await import("@/lib/bie/vector-desk-intel");
    const state = await fetchVectorFullState(sym, "all");
    if (!state?.spot) {
      return {
        answer: toProfessionalMarkdown(
          `**${sym} wall dynamics** — no live Vector snapshot for this symbol right now. Data refreshes on the next positioning poll.`
        ),
        context: { ticker: sym, missing: true },
      };
    }
    const parts = [
      `**${sym} dealer walls & dynamics (live Vector)**`,
      wallsBriefLine(state) ?? "- Wall snapshot unavailable.",
      wallDynamicsBriefLine(state) ?? "- No material re-stacking in the current session rail.",
    ];
    return {
      answer: toProfessionalMarkdown(parts.filter(Boolean).join("\n\n")),
      context: state,
    };
  }

  const platform = await getCachedBiePlatformContext({ scope: "desk" });
  const desk = platform.desk;
  if (!desk?.price) {
    return {
      answer: toProfessionalMarkdown(
        "**SPX wall dynamics** — desk feed is cold; positioning will populate on the next live refresh."
      ),
      context: { missing: true },
    };
  }

  const parts = [
    "**SPX dealer walls & dynamics (live)**",
    spxWallsBriefLine(platform.intel ?? undefined, desk.price) ??
      `- Spot **${fmt(desk.price, 0)}** · γ-flip **${fmt(desk.gamma_flip, 0)}**`,
  ];

  const ladder = desk.gex_walls ?? [];
  if (ladder.length) {
    parts.push("", "**γ ladder (desk):**");
    for (const w of ladder.slice(0, 10)) {
      parts.push(
        `- ${w.kind}: **${fmt(w.strike, 0)}** · net GEX **${fmt(w.net_gex, 0)}** · **${fmt(w.distance_pts, 1)}** pts from spot`
      );
    }
  }

  parts.push(
    "",
    "_Build/fade transitions log when |net GEX| on a strike shifts materially session-over-session. For full regime context ask **What's the SPX setup right now?**_"
  );

  return {
    answer: toProfessionalMarkdown(parts.join("\n")),
    context: { desk, intel: platform.intel, ladder },
  };
}

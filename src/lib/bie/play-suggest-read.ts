import { computeSpxConfluence } from "@/features/spx/lib/spx-signals";
import { buildPlayIdea } from "@/features/spx/lib/spx-play-intel";
import { getCachedBiePlatformContext } from "@/lib/bie/platform-cache";
import type { BieComposed } from "@/lib/bie/composers-shared";
import { toProfessionalMarkdown } from "@/lib/bie/professional-tone";

const fmt = (n: unknown, d = 0): string =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("en-US", { maximumFractionDigits: d })
    : "—";

function professionalPlayLine(raw: string): string {
  return raw
    .replace(/^I like /i, "Desk lean: ")
    .replace(/ could be the play/i, " — candidate structure")
    .replace(/ is the play/i, " — primary candidate")
    .replace(/ on watch/i, " — watchlist only");
}

/** Actionable play ticket from live desk / Vector engine — no fabricated strikes. */
export async function composePlaySuggestRead(ticker: string | null): Promise<BieComposed | null> {
  const sym = (ticker?.trim().toUpperCase() || "SPX").replace(/^SPXW$/, "SPX");

  if (sym === "SPX") {
    const platform = await getCachedBiePlatformContext({ scope: "desk" });
    const desk = platform.desk;
    if (!desk?.price) {
      return {
        answer: toProfessionalMarkdown(
          "**SPX play suggestion** — desk is unavailable; cannot derive a strike from live structure. Retry when `/api/market/spx/desk` is warm."
        ),
        context: { missing: true },
      };
    }
    const confluence = computeSpxConfluence(desk);
    if (!confluence) {
      return {
        answer: toProfessionalMarkdown(
          `**SPX play suggestion** — spot **${fmt(desk.price, 0)}** but confluence stack is incomplete; no ticket issued.`
        ),
        context: { desk },
      };
    }

    const idea = buildPlayIdea(desk, confluence);
    const open = platform.cross.openPlay;
    const lines = [
      "**SPX 0DTE play suggestion (desk-derived)**",
      "",
      `- **Grade:** ${confluence.grade} · **Bias:** ${confluence.bias} · **Direction:** ${confluence.direction ?? "—"}`,
      `- **γ-flip:** ${fmt(desk.gamma_flip, 0)} · **Spot:** ${fmt(desk.price, 0)}`,
    ];

    if (idea) {
      lines.push(
        `- **Structure:** ${idea.direction.toUpperCase()} ${idea.strike}${idea.option_type === "call" ? "C" : "P"}`,
        `- **Read:** ${professionalPlayLine(idea.line)}`
      );
      if (confluence.levels.target != null) {
        lines.push(`- **Desk target:** ${fmt(confluence.levels.target, 0)}`);
      }
      if (confluence.levels.stop != null) {
        lines.push(`- **Invalidation:** ${fmt(confluence.levels.stop, 0)}`);
      }
    } else {
      lines.push("- **Structure:** No ticket — edge insufficient or gates blocked.");
    }

    if (open?.status === "open") {
      lines.push(
        "",
        `- **Committed engine play:** ${open.direction?.toUpperCase() ?? "—"} · entry ${fmt(open.entry_price, 0)} · grade ${open.grade ?? "—"}`
      );
    }

    lines.push(
      "",
      "_Strike is computed from live walls + confluence — not a chain fetch. Confirm size against your risk rules._"
    );

    return {
      answer: toProfessionalMarkdown(lines.join("\n")),
      context: { desk, confluence, idea, openPlay: open },
    };
  }

  const { fetchVectorFullState } = await import("@/lib/bie/vector-full-state");
  const { composeVectorDeskBrief } = await import("@/lib/bie/vector-desk-brief");
  const state = await fetchVectorFullState(sym, "0dte");
  if (!state?.spot) {
    return {
      answer: toProfessionalMarkdown(
        `**${sym} play suggestion** — no live Vector snapshot; cannot derive a play without spot and walls.`
      ),
      context: { ticker: sym, missing: true },
    };
  }

  const brief = composeVectorDeskBrief(state);
  const play = state.play;
  const lines = [
    `**${sym} play suggestion (Vector engine)**`,
    "",
    `**${brief.headline}**`,
    brief.body,
  ];
  if (play) {
    lines.push(
      "",
      `**Ticket:** ${play.bias.toUpperCase()} · style **${play.style}** · grade **${play.grade}** · conviction **${play.conviction}**`,
      `- **Thesis:** ${play.thesis}`,
      play.entryZone ? `- **Entry zone:** ${play.entryZone}` : "",
      play.invalidation ? `- **Invalidation:** ${play.invalidation}` : "",
      play.targets.length ? `- **Targets:** ${play.targets.join(" · ")}` : "",
      play.starred.length ? `- **Watch:** ${play.starred.slice(0, 4).join(" · ")}` : ""
    );
  } else {
    lines.push("", "_Vector engine returned no committed play — structure may be range-bound or data thin._");
  }

  return {
    answer: toProfessionalMarkdown(lines.filter(Boolean).join("\n")),
    context: { state, brief },
  };
}

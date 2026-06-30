import type { PlaybookPlay } from "./types";

export function buildGroundedPlayExplanationFallback(params: {
  play: PlaybookPlay;
  reason?: string;
}): string {
  return [
    `**Why ranked #${params.play.rank}**`,
    params.play.thesis || params.play.key_signal || "No thesis on file.",
    "",
    "**The contract & premium**",
    params.play.options_play,
    params.play.entry_premium != null
      ? `Entry premium: $${params.play.entry_premium}/share · $${params.play.entry_cost_per_contract ?? Math.round(params.play.entry_premium * 100)}/lot`
      : "Entry premium was not available on the grounded play card.",
    "",
    "**Entry · target · stop logic**",
    `Entry: ${params.play.entry_range}`,
    `Target: ${params.play.target}`,
    `Stop: ${params.play.stop}`,
    "",
    "**Risks & invalidation**",
    params.play.risk_note || "Use the entry, target, and stop from the published play card; no additional risk note was generated.",
    "",
    "**Bottom line:**",
    params.reason ?? "Full Hawk Intel generation is temporarily unavailable; this fallback uses only the grounded published play card.",
  ]
    .filter((line) => line != null)
    .join("\n");
}

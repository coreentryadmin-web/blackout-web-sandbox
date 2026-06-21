export type PlayDiscordAction = "BUY" | "SELL" | "TRIM";

export async function notifyPlayDiscord(input: {
  action: PlayDiscordAction;
  direction: string | null;
  headline: string;
  thesis?: string;
  price?: number;
  grade?: string;
  score?: number;
}): Promise<void> {
  const url = process.env.DISCORD_PLAY_WEBHOOK_URL?.trim();
  if (!url) return;

  const emoji = input.action === "BUY" ? "🟢" : input.action === "TRIM" ? "🟡" : "🔴";
  const dir = input.direction?.toUpperCase() ?? "—";
  const lines = [
    `${emoji} **SPX PLAY ${input.action}** · ${dir}`,
    `**${input.headline}**`,
  ];
  if (input.grade) lines.push(`Grade **${input.grade}**${input.score != null ? ` · score ${Math.round(input.score)}` : ""}`);
  if (input.price != null && input.price > 0) lines.push(`SPX **${input.price.toFixed(2)}**`);
  if (input.thesis) lines.push(input.thesis.slice(0, 500));
  lines.push("[Blackout Desk](https://blackouttrades.com/dashboard)");

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: lines.join("\n").slice(0, 1900) }),
  }).catch((err) => console.warn("[spx-play-notify] discord webhook:", err));
}

export async function notifyOpsDiscord(input: {
  title: string;
  body: string;
  severity?: "critical" | "warning" | "info";
}): Promise<void> {
  // N-2: Warn if ops alerts will fall back to the play webhook (could pollute trade channel).
  if (!process.env.DISCORD_OPS_WEBHOOK_URL) {
    console.warn("[notify] DISCORD_OPS_WEBHOOK_URL not set — ops alerts will post to play channel");
  }
  const url =
    process.env.DISCORD_OPS_WEBHOOK_URL?.trim() ||
    process.env.DISCORD_PLAY_WEBHOOK_URL?.trim();
  if (!url) return;

  const emoji =
    input.severity === "critical" ? "🚨" : input.severity === "warning" ? "⚠️" : "ℹ️";
  const content = `${emoji} **${input.title}**\n${input.body}`.slice(0, 1900);

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  }).catch((err) => console.warn("[spx-play-notify] ops webhook:", err));
}

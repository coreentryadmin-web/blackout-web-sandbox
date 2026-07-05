import { postDiscordWebhook } from "@/lib/discord-post";
import { notifyPlayPersonal } from "@/lib/personal-alert-fanout";

export type PlayDiscordAction = "BUY" | "SELL" | "TRIM" | "WATCH";

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

  const emoji =
    input.action === "BUY"
      ? "🟢"
      : input.action === "TRIM"
        ? "🟡"
        : input.action === "WATCH"
          ? "👁️"
          : "🔴";
  const dir = input.direction?.toUpperCase() ?? "—";
  const lines = [
    `${emoji} **SPX PLAY ${input.action}** · ${dir}`,
    `**${input.headline}**`,
  ];
  if (input.grade) lines.push(`Grade **${input.grade}**${input.score != null ? ` · score ${Math.round(input.score)}` : ""}`);
  if (input.price != null && input.price > 0) lines.push(`SPX **${input.price.toFixed(2)}**`);
  if (input.thesis) lines.push(input.thesis.slice(0, 500));
  lines.push("[Blackout Desk](https://blackouttrades.com/dashboard)");

  const content = lines.join("\n").slice(0, 1900);
  await postDiscordWebhook(url, { content }, "spx-play");

  // Additive: fan the same content out to opt-in personal webhooks. Fire-and-forget,
  // never throws, and no-ops unless SPX_PERSONAL_ALERTS is enabled. The shared
  // webhook delivery above is unchanged.
  void notifyPlayPersonal(content);
}

// One-time guard so the "ops webhook not set" fallback warning logs once per process, not on
// every alert.
let opsFallbackWarned = false;

/**
 * Post an ops alert to Discord. Returns `true` ONLY if the message was actually delivered to a
 * webhook — `false` if NO webhook is configured (silent drop) or delivery failed. Callers that
 * MUST be heard (e.g. the cron-staleness watchdog) check the return value so an alert that went
 * nowhere is surfaced loudly instead of vanishing. Never throws.
 */
export async function notifyOpsDiscord(input: {
  title: string;
  body: string;
  severity?: "critical" | "warning" | "info";
}): Promise<boolean> {
  // N-2: Warn ONCE per process if ops alerts will fall back to the play webhook (could pollute
  // the trade channel). Logging this on every alert just spams stderr every ~20 min.
  if (!process.env.DISCORD_OPS_WEBHOOK_URL && !opsFallbackWarned) {
    opsFallbackWarned = true;
    console.warn("[notify] DISCORD_OPS_WEBHOOK_URL not set — ops alerts will post to play channel");
  }
  const url =
    process.env.DISCORD_OPS_WEBHOOK_URL?.trim() ||
    process.env.DISCORD_PLAY_WEBHOOK_URL?.trim();
  if (!url) {
    // No ops AND no play webhook: the alert has nowhere to go. This is the silent-no-op the #90
    // post-mortem flagged — make it LOUD so it shows up in logs even though we can't reach Discord.
    console.error(
      `[notify] ops alert DROPPED — neither DISCORD_OPS_WEBHOOK_URL nor DISCORD_PLAY_WEBHOOK_URL is set. ` +
        `Lost alert: ${input.title}`
    );
    return false;
  }

  const emoji =
    input.severity === "critical" ? "🚨" : input.severity === "warning" ? "⚠️" : "ℹ️";
  const content = `${emoji} **${input.title}**\n${input.body}`.slice(0, 1900);

  return postDiscordWebhook(url, { content }, "ops");
}

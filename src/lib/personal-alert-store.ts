// Per-user personal Discord webhook storage. Reuses Clerk privateMetadata as the
// user store (same pattern as membership.ts's publicMetadata writes), so NO new DB
// table is required. privateMetadata is SERVER-ONLY and never shipped to the client,
// which matters because a Discord webhook URL embeds a secret token.
//
// SECURITY: we never log or return the stored URL. Callers receive only a redacted
// host (via redactWebhook) for display/confirmation.

import { clerkClient } from "@clerk/nextjs/server";
import { redactWebhook } from "@/lib/discord-post";
import { isValidDiscordWebhook } from "@/lib/personal-alert-validate";

// Re-export the pure validator so existing importers of the store keep working.
export { isValidDiscordWebhook };

export const PERSONAL_WEBHOOK_META_KEY = "personal_discord_webhook";

/** Read a user's stored personal webhook URL from Clerk privateMetadata (or null). */
export async function getPersonalWebhook(userId: string): Promise<string | null> {
  const user = await (await clerkClient()).users.getUser(userId);
  const raw = (user.privateMetadata as { [k: string]: unknown } | undefined)?.[
    PERSONAL_WEBHOOK_META_KEY
  ];
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/**
 * Set (validated) or clear (url=null) a user's personal webhook. Uses
 * updateUserMetadata so Clerk deep-merges privateMetadata server-side (no
 * read-modify-write race). Returns the redacted host for safe display.
 * Throws on an invalid URL so the route can return 400.
 */
export async function setPersonalWebhook(
  userId: string,
  url: string | null
): Promise<{ cleared: boolean; host: string | null }> {
  if (url === null) {
    await (await clerkClient()).users.updateUserMetadata(userId, {
      privateMetadata: { [PERSONAL_WEBHOOK_META_KEY]: null },
    });
    return { cleared: true, host: null };
  }
  const trimmed = url.trim();
  if (!isValidDiscordWebhook(trimmed)) {
    throw new Error("INVALID_WEBHOOK");
  }
  await (await clerkClient()).users.updateUserMetadata(userId, {
    privateMetadata: { [PERSONAL_WEBHOOK_META_KEY]: trimmed },
  });
  return { cleared: false, host: redactWebhook(trimmed) };
}

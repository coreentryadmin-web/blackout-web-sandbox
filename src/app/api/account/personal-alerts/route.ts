// Self-serve opt-in for personal play alerts. A signed-in (premium) user can set or
// clear their own personal Discord webhook. The webhook is stored in Clerk
// privateMetadata (server-only) and is NEVER returned to the client — GET returns only
// a redacted host so the user can confirm one is configured.
//
// This route is additive and does nothing to the shared DISCORD_PLAY_WEBHOOK_URL path.
// Delivery to personal webhooks is still gated by SPX_PERSONAL_ALERTS at fan-out time,
// so configuring a webhook here is harmless until an operator enables the feature.

import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { redactWebhook } from "@/lib/discord-post";
import { getPersonalWebhook, setPersonalWebhook } from "@/lib/personal-alert-store";
import { parseTier, tierAtLeast } from "@/lib/tiers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = await getPersonalWebhook(userId);
  return NextResponse.json({
    configured: Boolean(url),
    host: url ? redactWebhook(url) : null,
  });
}

export async function PUT(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await currentUser();
  const tier = parseTier(user?.publicMetadata?.tier);
  if (!tierAtLeast(tier, "premium")) {
    return NextResponse.json({ error: "Premium required" }, { status: 403 });
  }

  let body: { url?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.url !== "string" || !body.url.trim()) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  try {
    const res = await setPersonalWebhook(userId, body.url);
    return NextResponse.json({ ok: true, configured: true, host: res.host });
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_WEBHOOK") {
      return NextResponse.json(
        { error: "Must be an https discord.com /api/webhooks/... URL" },
        { status: 400 }
      );
    }
    console.error("[personal-alerts PUT]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed to save webhook" }, { status: 500 });
  }
}

export async function DELETE() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await setPersonalWebhook(userId, null);
    return NextResponse.json({ ok: true, configured: false });
  } catch (err) {
    console.error("[personal-alerts DELETE]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed to clear webhook" }, { status: 500 });
  }
}

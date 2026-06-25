import { auth } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { dbConfigured, dbQuery } from "@/lib/db";

export const dynamic = "force-dynamic";

// Lazily ensure the table exists without touching the global migration set.
// Idempotent; cheap; only runs when push is actually used.
async function ensurePushTable(): Promise<void> {
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint   TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      p256dh     TEXT NOT NULL,
      auth       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

/** Persist (or refresh) the caller's web-push subscription. */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!dbConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  let body: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const endpoint = body.endpoint?.trim();
  const p256dh = body.keys?.p256dh?.trim();
  const authKey = body.keys?.auth?.trim();
  if (!endpoint || !p256dh || !authKey) {
    return NextResponse.json({ error: "Malformed subscription" }, { status: 400 });
  }

  try {
    await ensurePushTable();
    // IDOR guard (audit 08-Med-4): only refresh the keys when the endpoint already belongs to THIS
    // user. The conflict update must NOT reassign user_id — otherwise anyone who knows another user's
    // (opaque, but exfiltratable) endpoint could overwrite the row's owner and hijack their push
    // channel. A conflict on an endpoint owned by a different user is left untouched.
    await dbQuery(
      `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth)
         VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint)
         DO UPDATE SET p256dh = EXCLUDED.p256dh,
                       auth   = EXCLUDED.auth
         WHERE push_subscriptions.user_id = EXCLUDED.user_id`,
      [endpoint, userId, p256dh, authKey]
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[push subscribe]", error);
    return NextResponse.json({ error: "Failed to store subscription" }, { status: 500 });
  }
}

/** Remove the caller's subscription by endpoint. */
export async function DELETE(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!dbConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  let endpoint: string | undefined;
  try {
    endpoint = (await req.json())?.endpoint?.trim();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!endpoint) return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });

  try {
    await ensurePushTable();
    // Scope deletion to the caller so a user can only remove their own subscription.
    await dbQuery(`DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2`, [
      endpoint,
      userId,
    ]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[push unsubscribe]", error);
    return NextResponse.json({ error: "Failed to remove subscription" }, { status: 500 });
  }
}

// Night's Watch — single saved option position.
// PATCH  → edit fields, or close the position (with exit_premium).
// DELETE → remove the position (only the signed-in user's own).
//
// Per-user isolation: user_id always comes from Clerk auth(); every query is
// scoped by (user_id, id) so one user can never touch another's rows.

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  requireDatabaseInProduction,
  updateUserPosition,
  closeUserPosition,
  deleteUserPosition,
  type UserPositionPatch,
} from "@/lib/db";
import { enrichPosition } from "@/lib/nights-watch/valuation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isValidYmd(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  return Number.isFinite(Date.parse(`${v}T00:00:00Z`));
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dbGuard = requireDatabaseInProduction();
  if (dbGuard) return dbGuard;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    // Close path: presence of exit_premium (or status:'closed') closes the position.
    const closing = body.status === "closed" || body.exit_premium != null;
    if (closing) {
      const exitPremium = Number(body.exit_premium);
      if (!Number.isFinite(exitPremium) || exitPremium < 0) {
        return NextResponse.json(
          { error: "exit_premium must be >= 0 to close a position" },
          { status: 400 }
        );
      }
      const closed = await closeUserPosition(userId, id, exitPremium);
      if (!closed) return NextResponse.json({ error: "Position not found" }, { status: 404 });
      return NextResponse.json({ position: enrichPosition(closed, null) });
    }

    // Edit path: build a validated patch of only the provided fields.
    const patch: UserPositionPatch = {};
    if (typeof body.ticker === "string") {
      const t = body.ticker.trim().toUpperCase();
      if (!t) return NextResponse.json({ error: "ticker cannot be empty" }, { status: 400 });
      patch.ticker = t;
    }
    if (body.option_type !== undefined) {
      if (body.option_type !== "call" && body.option_type !== "put") {
        return NextResponse.json({ error: "option_type must be 'call' or 'put'" }, { status: 400 });
      }
      patch.option_type = body.option_type;
    }
    if (body.strike !== undefined) {
      const s = Number(body.strike);
      if (!Number.isFinite(s) || s <= 0) {
        return NextResponse.json({ error: "strike must be > 0" }, { status: 400 });
      }
      patch.strike = s;
    }
    if (body.expiry !== undefined) {
      if (!isValidYmd(body.expiry)) {
        return NextResponse.json({ error: "expiry must be a valid YYYY-MM-DD date" }, { status: 400 });
      }
      patch.expiry = body.expiry;
    }
    if (body.side !== undefined) {
      if (body.side !== "long" && body.side !== "short") {
        return NextResponse.json({ error: "side must be 'long' or 'short'" }, { status: 400 });
      }
      patch.side = body.side;
    }
    if (body.contracts !== undefined) {
      const c = Number(body.contracts);
      if (!Number.isInteger(c) || c <= 0) {
        return NextResponse.json({ error: "contracts must be an integer > 0" }, { status: 400 });
      }
      patch.contracts = c;
    }
    if (body.entry_premium !== undefined) {
      const e = Number(body.entry_premium);
      if (!Number.isFinite(e) || e < 0) {
        return NextResponse.json({ error: "entry_premium must be >= 0" }, { status: 400 });
      }
      patch.entry_premium = e;
    }
    if (body.entry_date !== undefined) {
      if (!isValidYmd(body.entry_date)) {
        return NextResponse.json({ error: "entry_date must be a valid YYYY-MM-DD date" }, { status: 400 });
      }
      patch.entry_date = body.entry_date;
    }
    if (body.notes !== undefined) {
      patch.notes =
        typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
    }

    const updated = await updateUserPosition(userId, id, patch);
    if (!updated) return NextResponse.json({ error: "Position not found" }, { status: 404 });

    // Cheap write: persist + return immediately. Open positions report 'pending';
    // the next GET poll fills live valuation from the shared chain cache.
    return NextResponse.json({
      position: enrichPosition(updated, null, new Date(), updated.status === "open"),
    });
  } catch (error) {
    console.error("[account/positions/[id] PATCH]", error);
    return NextResponse.json({ error: "Failed to update position" }, { status: 502 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dbGuard = requireDatabaseInProduction();
  if (dbGuard) return dbGuard;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const removed = await deleteUserPosition(userId, id);
    if (!removed) return NextResponse.json({ error: "Position not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[account/positions/[id] DELETE]", error);
    return NextResponse.json({ error: "Failed to delete position" }, { status: 502 });
  }
}

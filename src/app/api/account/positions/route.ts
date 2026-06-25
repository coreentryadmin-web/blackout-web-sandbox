// Night's Watch — per-user saved option positions.
// GET  → the signed-in user's positions (default status=open), each enriched
//        server-side with a live valuation (snapshot failures → unavailable).
// POST → create a new open position (validated).
//
// Per-user isolation: user_id always comes from Clerk auth(), never the client.

import { NextResponse } from "next/server";
import { requireDatabaseInProduction, createUserPosition } from "@/lib/db";
import { enrichPosition } from "@/lib/nights-watch/valuation";
import { validateExpiryYmd } from "@/lib/nights-watch/expiry";
import {
  getEnrichedPositionsForUser,
  getEnrichedOpenAndRecentClosedForUser,
} from "@/lib/nights-watch/enrichment";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { requireToolApi } from "@/lib/tool-access-server";
import { requireTierApi } from "@/lib/market-api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * YYYY-MM-DD calendar-date guard for stored labels (e.g. entry_date), where past
 * dates are valid. Verifies the date is REAL via round-trip — Date.parse silently
 * rolls impossible dates (2026-02-30 → 03-02), which must not pass. Expiry has its
 * own stricter guard (no-past + weekend warning) in validateExpiryYmd.
 */
function isValidYmd(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export async function GET(req: Request) {
  const gate = await requireTierApi("premium");
  if (gate instanceof Response) return gate;
  const { userId } = gate;

  // Launch gate — locked to non-admins until this tool ships.
  const locked = await requireToolApi("nighthawk");
  if (locked) return locked;

  // Boot the shared data sockets (idempotent, env-gated). Night's Watch is the PRIMARY consumer
  // of the options WS live-mark engine, so a user who only ever visits Night's Watch (never the
  // SPX desk/flows routes that also call this) must still kick the engine awake — otherwise the
  // WS would never boot in this replica even with OPTIONS_WS_ENABLED set, leaving the fastest
  // mark path (live WS) silently inert and valuation stuck on the slower snapshot/chain path.
  // A strict no-op when the flag is off, so it can never destabilize the REST fallback.
  ensureDataSockets();

  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status");
  // Explicit ?status= overrides (used by tools / tests) stay exact: "closed" → only closed,
  // "all" → every status, "open" → only open. The DEFAULT view (no param) is special: it
  // returns OPEN positions PLUS a bounded tail of recently-CLOSED ones so the panel can show
  // realized P&L for just-settled legs without those closed rows growing unbounded.
  const explicitStatus: "open" | "closed" | "all" | "default" =
    statusParam === "closed"
      ? "closed"
      : statusParam === "all"
        ? "all"
        : statusParam === "open"
          ? "open"
          : "default";

  try {
    // Orchestration lives in the shared helper (one cached chain per distinct
    // underlying|expiry, one desk read) so the route and the Largo get_my_positions
    // tool can never drift. user_id is the trusted Clerk scope passed straight through.
    const enriched =
      explicitStatus === "default"
        ? await getEnrichedOpenAndRecentClosedForUser(userId)
        : await getEnrichedPositionsForUser(
            userId,
            explicitStatus === "all" ? undefined : explicitStatus
          );
    return NextResponse.json({ positions: enriched });
  } catch (error) {
    console.error("[account/positions GET]", error);
    return NextResponse.json({ error: "Failed to load positions" }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const gate = await requireTierApi("premium");
  if (gate instanceof Response) return gate;
  const { userId } = gate;

  // Launch gate — locked to non-admins until this tool ships.
  const locked = await requireToolApi("nighthawk");
  if (locked) return locked;

  const dbGuard = requireDatabaseInProduction();
  if (dbGuard) return dbGuard;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // --- validate ---
  const ticker = typeof body.ticker === "string" ? body.ticker.trim().toUpperCase() : "";
  if (!ticker) return NextResponse.json({ error: "ticker is required" }, { status: 400 });

  const optionType = body.option_type;
  if (optionType !== "call" && optionType !== "put") {
    return NextResponse.json({ error: "option_type must be 'call' or 'put'" }, { status: 400 });
  }

  const strike = Number(body.strike);
  if (!Number.isFinite(strike) || strike <= 0) {
    return NextResponse.json({ error: "strike must be > 0" }, { status: 400 });
  }

  const expiryCheck = validateExpiryYmd(body.expiry);
  if (!expiryCheck.ok) {
    return NextResponse.json({ error: expiryCheck.error }, { status: 400 });
  }
  const expiry = expiryCheck.ymd;

  const side = body.side == null ? "long" : body.side;
  if (side !== "long" && side !== "short") {
    return NextResponse.json({ error: "side must be 'long' or 'short'" }, { status: 400 });
  }

  const contracts = Number(body.contracts);
  if (!Number.isInteger(contracts) || contracts <= 0) {
    return NextResponse.json({ error: "contracts must be an integer > 0" }, { status: 400 });
  }

  const entryPremium = Number(body.entry_premium);
  if (!Number.isFinite(entryPremium) || entryPremium < 0) {
    return NextResponse.json({ error: "entry_premium must be >= 0" }, { status: 400 });
  }

  // entry_date optional → defaults to today (ET-agnostic UTC date is fine for a stored label).
  const entryDate = body.entry_date == null
    ? new Date().toISOString().slice(0, 10)
    : body.entry_date;
  if (!isValidYmd(entryDate)) {
    return NextResponse.json({ error: "entry_date must be a valid YYYY-MM-DD date" }, { status: 400 });
  }

  const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;

  try {
    const position = await createUserPosition(userId, {
      ticker,
      option_type: optionType,
      strike,
      expiry,
      side,
      contracts,
      entry_premium: entryPremium,
      entry_date: entryDate,
      notes,
    });
    // Cheap write: persist + return immediately as 'pending' (no inline upstream call).
    // Live valuation lands on the next GET poll, served from the shared chain cache.
    return NextResponse.json(
      {
        position: enrichPosition(position, null, new Date(), true),
        // Soft, non-blocking advisory (e.g. weekend expiry); absent when clean.
        ...(expiryCheck.listingWarning ? { listing_warning: expiryCheck.listingWarning } : {}),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[account/positions POST]", error);
    return NextResponse.json({ error: "Failed to create position" }, { status: 502 });
  }
}

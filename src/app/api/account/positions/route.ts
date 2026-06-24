// Night's Watch — per-user saved option positions.
// GET  → the signed-in user's positions (default status=open), each enriched
//        server-side with a live valuation (snapshot failures → unavailable).
// POST → create a new open position (validated).
//
// Per-user isolation: user_id always comes from Clerk auth(), never the client.

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { requireDatabaseInProduction, listUserPositions, createUserPosition } from "@/lib/db";
import { enrichPosition, valuationFromContract, type ContractValuation, type LiveMark } from "@/lib/nights-watch/valuation";
import { getNwChain, matchContract, nwChainKey, type NwChain } from "@/lib/nights-watch/chain-cache";
import { buildOcc, getLiveOptionMark } from "@/lib/ws/options-socket";
import { buildPositionContextMap } from "@/lib/nights-watch/position-context";
import { computeVerdict } from "@/lib/nights-watch/verdict";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** YYYY-MM-DD calendar-date guard (and that it parses to a real date). */
function isValidYmd(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const ms = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(ms);
}

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status");
  const status: "open" | "closed" | undefined =
    statusParam === "closed" ? "closed" : statusParam === "all" ? undefined : "open";

  try {
    const positions = await listUserPositions(userId, status);
    // Batch by (underlying, expiry): each distinct chain is fetched ONCE via the shared
    // single-flight cache, then every strike is matched in-memory. Upstream cost is
    // O(distinct chains) regardless of user/position count — never a per-position call.
    const groupKeys = Array.from(new Set(positions.map((p) => nwChainKey(p.ticker, p.expiry))));
    const chains = new Map<string, NwChain | null>();
    await Promise.all(
      groupKeys.map(async (key) => {
        const [root, exp] = key.split("|");
        chains.set(key, await getNwChain(root, exp).catch(() => null));
      })
    );
    // Resolve a fresh live WS mark per position (in-memory store first, Redis
    // fallback). Best-effort: any miss yields null and the valuation cleanly
    // falls back to the cached snapshot mark, so a WS outage never degrades GET.
    const liveMarks = new Map<number, LiveMark | null>();
    await Promise.all(
      positions.map(async (p) => {
        try {
          const occ = buildOcc(p.ticker, p.expiry, p.option_type, p.strike);
          if (occ) liveMarks.set(p.id, await getLiveOptionMark(occ));
        } catch {
          /* live mark optional — snapshot fallback covers it */
        }
      })
    );

    // Cross-tool context resolved ONCE per request, keyed by underlying. For SPX
    // this is a single shared, cached desk read (O(distinct underlyings) — never a
    // per-position or per-user upstream call). Non-SPX underlyings get empty
    // context in v1, so the verdict engine only uses on-position data for them.
    const contextMap = await buildPositionContextMap(positions.map((p) => p.ticker));

    const enriched = positions.map((p) => {
      const chain = chains.get(nwChainKey(p.ticker, p.expiry)) ?? null;
      let valuation: ContractValuation | null = null;
      if (chain) {
        const contract = matchContract(chain.contracts, p.strike, p.option_type);
        if (contract) {
          valuation = valuationFromContract(contract, chain.spot, liveMarks.get(p.id) ?? null);
        }
      }
      const enrichedPosition = enrichPosition(p, valuation);
      const ctx = contextMap.get(p.ticker.trim().toUpperCase());
      // Deterministic, pure, free verdict — every action traces to named signals.
      const verdict = computeVerdict(enrichedPosition, ctx);
      return { ...enrichedPosition, verdict };
    });
    return NextResponse.json({ positions: enriched });
  } catch (error) {
    console.error("[account/positions GET]", error);
    return NextResponse.json({ error: "Failed to load positions" }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  if (!isValidYmd(body.expiry)) {
    return NextResponse.json({ error: "expiry must be a valid YYYY-MM-DD date" }, { status: 400 });
  }

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
      expiry: body.expiry,
      side,
      contracts,
      entry_premium: entryPremium,
      entry_date: entryDate,
      notes,
    });
    // Cheap write: persist + return immediately as 'pending' (no inline upstream call).
    // Live valuation lands on the next GET poll, served from the shared chain cache.
    return NextResponse.json(
      { position: enrichPosition(position, null, new Date(), true) },
      { status: 201 }
    );
  } catch (error) {
    console.error("[account/positions POST]", error);
    return NextResponse.json({ error: "Failed to create position" }, { status: 502 });
  }
}

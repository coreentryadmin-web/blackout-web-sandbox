import { NextResponse } from "next/server";
import { polygonConfigured, uwConfigured, finnhubConfigured } from "@/lib/providers/config";
import { dbConfigured, pingDatabase } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {  const db = await pingDatabase();
  return NextResponse.json({
    ok: (polygonConfigured() || uwConfigured()) && db.ok,
    polygon: polygonConfigured(),
    unusual_whales: uwConfigured(),
    finnhub: finnhubConfigured(),
    postgres: db.ok,
    postgres_mode: db.mode ?? null,
    postgres_error: db.error ?? null,
  });
}
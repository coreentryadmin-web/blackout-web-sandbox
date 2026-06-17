import { NextResponse } from "next/server";
import { polygonConfigured, uwConfigured, finnhubConfigured } from "@/lib/providers/config";
import { dbConfigured, pingDatabase } from "@/lib/db";

export async function GET() {
  const db = await pingDatabase();
  return NextResponse.json({
    ok: (polygonConfigured() || uwConfigured()) && db.ok,
    polygon: polygonConfigured(),
    unusual_whales: uwConfigured(),
    finnhub: finnhubConfigured(),
    postgres: db.ok,
    postgres_error: db.error ?? null,
  });
}
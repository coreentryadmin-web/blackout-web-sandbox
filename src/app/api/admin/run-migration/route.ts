/**
 * POST /api/admin/run-migration
 *
 * Applies a named SQL migration file from src/lib/migrations/.
 * Restricted to admin users only.
 *
 * Body: { "filename": "004_god_tier_features.sql" }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { applyMigrationFile } from "@/lib/run-migration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  let filename: string;
  try {
    const body = await req.json();
    filename = body?.filename;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!filename || typeof filename !== "string") {
    return NextResponse.json(
      { ok: false, error: "Missing required field: filename" },
      { status: 400 }
    );
  }

  const result = await applyMigrationFile(filename);

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

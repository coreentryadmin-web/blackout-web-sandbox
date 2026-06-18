import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import { buildEveningEdition } from "@/lib/nighthawk/edition-builder";
import { isWeekdayEt, etNowParts } from "@/lib/nighthawk/session";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function cronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const q = req.nextUrl.searchParams.get("secret");
  return auth === secret || q === secret;
}

function editionEnabled(): boolean {
  const flag = process.env.NIGHTHAWK_EDITION_ENABLED?.trim();
  return flag !== "0" && flag !== "false";
}

function inEditionWindow(force: boolean): boolean {
  if (force) return true;
  if (!isWeekdayEt()) return false;
  const hour = Number(process.env.NIGHTHAWK_EDITION_HOUR_ET ?? "17");
  const minute = Number(process.env.NIGHTHAWK_EDITION_MINUTE_ET ?? "30");
  const { hour: nowH, minute: nowM } = etNowParts();
  const now = nowH * 60 + nowM;
  const target = hour * 60 + minute;
  const catchup = Number(process.env.NIGHTHAWK_EDITION_CATCHUP_MIN ?? "120");
  return now >= target && now <= target + catchup;
}

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  if (!editionEnabled()) {
    return NextResponse.json({ ok: false, skipped: true, reason: "NIGHTHAWK_EDITION_ENABLED=0" });
  }

  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!inEditionWindow(force)) {
    return NextResponse.json({
      ok: false,
      skipped: true,
      reason: "Outside edition window — use ?force=1 to override",
    });
  }

  try {
    const result = await buildEveningEdition({ force });
    const status = result.ok ? 200 : 502;
    return NextResponse.json(result, { status });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[cron/nighthawk-edition]", error);
    return NextResponse.json({ ok: false, error: "Edition build failed", detail }, { status: 500 });
  }
}

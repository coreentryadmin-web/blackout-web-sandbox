import { NextResponse } from "next/server";
import { pingDatabaseConnectivity, dbConfigured } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Railway deploy gate — connectivity only (no migration lock). Retries cold PgBouncer boot. */
const READY_ATTEMPTS = 6;
const READY_RETRY_MS = 4_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Readiness probe — checks DB connectivity. Use for Railway deploy gates, not liveness. */
export async function GET() {
  if (!dbConfigured()) {
    return NextResponse.json({ ok: true, db: "skipped" });
  }

  let lastError: string | undefined;
  let lastMode: string | undefined;

  for (let attempt = 1; attempt <= READY_ATTEMPTS; attempt++) {
    const { ok, error, mode } = await pingDatabaseConnectivity();
    if (ok) {
      return NextResponse.json({ ok: true, db: "connected", mode });
    }
    lastError = error;
    lastMode = mode;
    if (attempt < READY_ATTEMPTS) {
      console.warn(
        `[ready] database ping attempt ${attempt}/${READY_ATTEMPTS} failed:`,
        error
      );
      await sleep(READY_RETRY_MS);
    }
  }

  console.error("[ready] database ping failed after retries:", lastError);
  return NextResponse.json(
    { ok: false, db: "unreachable", error: lastError, mode: lastMode },
    { status: 503 }
  );
}

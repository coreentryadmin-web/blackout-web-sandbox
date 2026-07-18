import { NextResponse } from "next/server";
import { pingDatabaseConnectivity, dbConfigured } from "@/lib/db";
import { redisStatus } from "@/lib/redis-health";
import { ensureWebBootWarm } from "@/lib/web-boot-warm";

export const dynamic = "force-dynamic";

/** ECS deploy gate — connectivity only (no migration lock). Retries cold PgBouncer boot. */
const READY_ATTEMPTS = 6;
const READY_RETRY_MS = 4_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Readiness probe — checks DB connectivity. Use for ECS deploy gates, not liveness. */
export async function GET() {
  ensureWebBootWarm();

  if (!dbConfigured()) {
    return NextResponse.json({ ok: true, db: "skipped" });
  }

  let lastError: string | undefined;
  let lastMode: string | undefined;

  for (let attempt = 1; attempt <= READY_ATTEMPTS; attempt++) {
    const { ok, error, mode } = await pingDatabaseConnectivity();
    if (ok) {
      return NextResponse.json({ ok: true, db: "connected", mode, redis: await redisStatus() });
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

  // Log the real diagnostic server-side only -- this route is public/unauthenticated
  // (scripts/verify-api-auth-guards.mjs's allowlist), and the raw driver error can embed
  // internal hostnames or credential text (e.g. RDS proxy host, "password authentication
  // failed for user ..."). Never forward it verbatim to an unauthenticated caller.
  console.error("[ready] database ping failed after retries:", lastError, lastMode);
  return NextResponse.json({ ok: false, db: "unreachable", error: "db_unreachable" }, { status: 503 });
}

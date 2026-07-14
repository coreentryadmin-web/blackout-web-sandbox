// Cron: NIGHT HAWK end-of-session DEBRIEF (PR-N10) — the automated post-mortem.
//
// FIRES: after the session resolves. The 4:30pm ET outcomes cron grades the day's plays and
// pins each play's forensic debrief (debrief-persist.ts); THIS cron runs strictly after that
// (~5:00pm ET) and rolls the graded session up into ONE immutable, member-readable artifact:
// what went well, the real winners, what misfired (and WHY, from the N6/N7 axes), and
// deterministic "how to improve" observations. Schedule doc: railway.nighthawk-debrief.toml
// (17:00 + 18:00 UTC-band pair, DST-safe like the sibling nighthawk crons; self-skips the
// off-band fire via inEtWindow).
//
// WHAT IT DOES:
//   1. Fetches the recent graded outcome rows (fetchNighthawkOutcomeAnalytics) and slices out
//      THIS session (edition_for = target date).
//   2. buildSessionDebrief — pure, evidence-only, #333-anti-blend, low-N-honest (session-debrief.ts).
//   3. buildNighthawkDebriefReport — the tested rolling-window aggregate; its improvement queue
//      becomes the session debrief's `how_to_improve.window_patterns` (the properly-powered levers).
//   4. buildTuningObservations (N11) — SHADOW auto-tune proposals from the same report; NEVER
//      applied (observation only, pinned separately for human review — not on the member route).
//   5. PINS both blobs to Redis, first-write-wins (SET NX) keyed by date, with a long TTL so
//      the session's debrief is stable and auditable. An existing pin is NEVER overwritten.
//
// AUTH: Bearer CRON_SECRET (isCronAuthorized). force-dynamic. maxDuration 60s.
//
// FAIL-SOFT: a Redis or aggregate failure is reported in the payload; the cron itself does not
// throw into a 500 unless the whole run collapses. The pinned debrief is a read artifact — it
// never touches the graded record (the outcome rows are the source of truth and are untouched).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { requireDatabaseInProduction, fetchNighthawkOutcomeAnalytics } from "@/lib/db";
import { logCronRun } from "@/lib/cron-run";
import { makeRedis } from "@/lib/make-redis";
import { inEtWindow } from "@/features/nighthawk/lib/et-window";
import { todayEt, isTradingDayEt } from "@/features/nighthawk/lib/session";
import {
  buildSessionDebrief,
  SESSION_DEBRIEF_VERSION,
  type SessionDebriefRow,
} from "@/features/nighthawk/lib/session-debrief";
import { buildNighthawkDebriefReport } from "@/features/nighthawk/lib/debrief-aggregate";
import { buildTuningObservations } from "@/features/nighthawk/lib/auto-tune-observe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CRON_KEY = "nighthawk-debrief";
// Local (NOT exported): a Next.js route module may only export the framework's reserved fields
// (GET, runtime, dynamic, …). The member read route (/api/nighthawk/debrief) keeps its own
// copy of the debrief key — the two must stay in sync (nh:debrief:{date}).
const DEBRIEF_REDIS_KEY = (date: string) => `nh:debrief:${date}`;
const TUNING_REDIS_KEY = (date: string) => `nh:tuning-observations:${date}`;
// 400 days: long enough to keep a full year+ of session debriefs auditable (the read route
// serves any past date), short enough to bound Redis growth. The blob is immutable (SET NX).
const REDIS_TTL_S = 60 * 60 * 24 * 400;
// How far back to pull graded rows: the session slice needs only today, but the rolling
// aggregate (window_patterns + tuning evidence) reads the same fetch over its own window.
const LOOKBACK_DAYS = 45;

function inDebriefWindow(force: boolean): boolean {
  if (force) return true;
  // 17:00 ET (after the 16:30 outcomes grade), wide catch-up so both UTC-band fires land.
  return inEtWindow({
    targetHour: Number(process.env.NIGHTHAWK_DEBRIEF_HOUR_ET ?? "17"),
    targetMinute: Number(process.env.NIGHTHAWK_DEBRIEF_MINUTE_ET ?? "0"),
    catchupMin: Number(process.env.NIGHTHAWK_DEBRIEF_CATCHUP_MIN ?? "120"),
  });
}

/** SET NX with TTL — first-write-wins. Returns whether THIS call wrote (vs a pin already there). */
async function pinFirstWriteWins(
  redis: Awaited<ReturnType<typeof makeRedis>>,
  key: string,
  value: string
): Promise<boolean> {
  const res = await redis.set(key, value, "EX", REDIS_TTL_S, "NX");
  return res === "OK";
}

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!inDebriefWindow(force)) {
    const payload = { ok: false, skipped: true, reason: "Outside debrief window (~5:00 PM ET) — use ?force=1 to override" };
    await logCronRun(CRON_KEY, started, payload);
    return NextResponse.json(payload);
  }

  const targetDate = req.nextUrl.searchParams.get("date") ?? todayEt();
  if (!force && !isTradingDayEt(targetDate)) {
    const payload = { ok: false, skipped: true, reason: `Market holiday/non-trading day (${targetDate}) — no session to debrief` };
    await logCronRun(CRON_KEY, started, payload);
    return NextResponse.json(payload);
  }

  try {
    // ── Fetch the graded rows once; the session slice AND the rolling aggregate read them. ──
    const { rows } = await fetchNighthawkOutcomeAnalytics(LOOKBACK_DAYS);
    const sessionRows: SessionDebriefRow[] = rows.filter((r) => r.edition_for === targetDate);
    const gradedThisSession = sessionRows.filter((r) => r.outcome !== "pending");

    if (gradedThisSession.length === 0) {
      // Not ready yet: outcomes for this session haven't been graded (the 4:30pm cron hasn't
      // run / bars not final). Do NOT pin an empty debrief — retry next run for free.
      const payload = {
        ok: true,
        skipped: true,
        reason: `No graded plays for ${targetDate} yet — debrief not pinned (will retry)`,
      };
      await logCronRun(CRON_KEY, started, payload);
      return NextResponse.json(payload);
    }

    // ── Rolling aggregate (tested) → window patterns + tuning evidence. Fail-soft. ──
    const nowMs = Date.now();
    const report = await buildNighthawkDebriefReport({ days: LOOKBACK_DAYS, nowMs });

    const generatedAt = new Date(nowMs).toISOString();
    const sessionDebrief = {
      ...buildSessionDebrief({
        editionFor: targetDate,
        rows: sessionRows,
        windowPatterns: report.improvement_queue,
      }),
      generated_at: generatedAt,
    };
    const tuning = { ...buildTuningObservations(report), generated_at: generatedAt };

    // ── Pin both blobs, first-write-wins. A Redis outage is reported, never fatal. ──
    let debriefWritten: boolean | null = null;
    let tuningWritten: boolean | null = null;
    let redisNote: string | undefined;
    const redisUrl = process.env.REDIS_URL ?? "";
    if (!redisUrl) {
      redisNote = "Redis not configured — debrief computed but not pinned";
    } else {
      let redis: Awaited<ReturnType<typeof makeRedis>> | null = null;
      try {
        redis = await makeRedis("nighthawk-debrief", redisUrl, { maxRetriesPerRequest: 1 });
        debriefWritten = await pinFirstWriteWins(redis, DEBRIEF_REDIS_KEY(targetDate), JSON.stringify(sessionDebrief));
        tuningWritten = await pinFirstWriteWins(redis, TUNING_REDIS_KEY(targetDate), JSON.stringify(tuning));
      } catch (redisErr) {
        redisNote = `Redis write failed: ${redisErr instanceof Error ? redisErr.message : String(redisErr)}`;
        console.error("[nighthawk-debrief] Redis write failed:", redisErr);
      } finally {
        await redis?.quit().catch(() => undefined);
      }
    }

    const payload = {
      ok: true,
      edition_for: targetDate,
      debrief_version: SESSION_DEBRIEF_VERSION,
      plays_graded: sessionDebrief.plays_graded,
      winners: sessionDebrief.summary.winners,
      losers: sessionDebrief.summary.losers,
      misfires: sessionDebrief.what_misfired.length,
      win_rate_pct: sessionDebrief.summary.win_rate_pct,
      low_n: sessionDebrief.summary.low_n,
      window_patterns: report.improvement_queue.length,
      tuning_proposals: tuning.proposals.length,
      tuning_bar_cleared: tuning.proposals.filter((p) => p.evidence_bar_cleared).length,
      debrief_pinned: debriefWritten === true ? "written" : debriefWritten === false ? "already_pinned" : "skipped",
      tuning_pinned: tuningWritten === true ? "written" : tuningWritten === false ? "already_pinned" : "skipped",
      ...(redisNote ? { redis_note: redisNote } : {}),
      duration_ms: Date.now() - started,
    };
    await logCronRun(CRON_KEY, started, payload);
    return NextResponse.json(payload);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[nighthawk-debrief] fatal:", error);
    await logCronRun(CRON_KEY, started, { ok: false, error });
    return NextResponse.json({ ok: false, error: "Debrief run failed", detail: error }, { status: 500 });
  }
}

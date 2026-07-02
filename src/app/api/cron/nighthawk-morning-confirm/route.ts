// Cron: NIGHT HAWK MORNING CONFIRMATION — validates overnight plays before market open.
//
// FIRES: 13:15 + 14:15 UTC Mon-Fri (railway.nighthawk-morning-confirm.toml) — dual
// band so one firing always lands in the 9:10-9:45 ET window across both DST regimes.
//
// WHAT IT DOES:
//   1. Reads /api/platform/intel for current regime, anomalies, GEX brief.
//   2. Fetches today's Night Hawk edition plays via the edition DB helper.
//   3. Fetches pre-market SPX price from Polygon snapshot.
//   4. For each play: computes CONFIRMED / DEGRADED / INVALIDATED verdict.
//   5. Writes the status blob to Redis at nh:play-status:{YYYYMMDD} (TTL 24h).
//   6. Writes docs/nighthawk/morning-confirm-{YYYYMMDD}.md (best-effort, ephemeral FS).
//   7. Ops-alerts on Discord if any play is INVALIDATED.
//
// AUTH: Bearer CRON_SECRET (isCronAuthorized). force-dynamic. maxDuration 60s.
//
// The edition is NEVER mutated — status lives only in Redis, surfaced via
// /api/nighthawk/play-status for the UI badge layer.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { fetchIndexSnapshots, fetchStockSnapshots } from "@/lib/providers/polygon";
import {
  computePlayVerdict,
  type PlayConfirmStatus,
  type PlayStatus,
} from "@/lib/nighthawk/morning-confirm-verdict";
import { notifyOpsDiscord } from "@/lib/spx-play-notify";
import { makeRedis } from "@/lib/make-redis";
import { requireDatabaseInProduction, fetchLatestNighthawkEdition, fetchNighthawkEditionByDate } from "@/lib/db";
import { rowToNightHawkEdition } from "@/lib/nighthawk/edition-builder";
import { todayEt, isTradingDayEt } from "@/lib/nighthawk/session";
import { inEtWindow } from "@/lib/nighthawk/et-window";
import type { PlaybookPlay } from "@/lib/nighthawk/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;


const CRON_KEY = "nighthawk-morning-confirm";
const REDIS_KEY = (date: string) => `nh:play-status:${date}`;
const REDIS_TTL_S = 60 * 60 * 24; // 24h


export type MorningConfirmResult = {
  edition_for: string;
  checked_at: string;
  spx_premarket: number | null;
  prior_close: number | null;
  overnight_gap_pts: number | null;
  regime: string | null;
  gex_bias: string | null;
  call_wall: number | null;
  put_wall: number | null;
  plays: PlayStatus[];
  summary: { confirmed: number; degraded: number; invalidated: number; unverified: number };
};

function inMorningWindow(force: boolean): boolean {
  if (force) return true;
  // 9:10–9:45 ET window — catches the 9:15 fire with ±5 min slack.
  return inEtWindow({ targetHour: 9, targetMinute: 10, catchupMin: 35 });
}

// Fetch pre-market SPX snapshot from Polygon (rate-limited indices batch).
async function fetchSpxPremarket(): Promise<number | null> {
  try {
    const snaps = await fetchIndexSnapshots(["I:SPX"]);
    const spx = snaps["I:SPX"];
    return spx?.price ?? null;
  } catch {
    return null;
  }
}

// Fetch platform intel snapshot (regime, anomalies, brief).
async function fetchPlatformIntel(baseUrl: string): Promise<{
  regime: string | null;
  anomalies: Array<{ direction?: string; [key: string]: unknown }>;
  gex_bias: string | null;
  call_wall: number | null;
  put_wall: number | null;
  prior_close: number | null;
}> {
  try {
    // /api/platform/intel is premium-or-cron gated — authenticate this internal call with the
    // cron secret so the morning-confirm job keeps getting the regime/anomaly/brief context.
    const res = await fetch(`${baseUrl}/api/platform/intel`, {
      cache: "no-store",
      headers: process.env.CRON_SECRET
        ? { Authorization: `Bearer ${process.env.CRON_SECRET}` }
        : undefined,
    });
    if (!res.ok) return { regime: null, anomalies: [], gex_bias: null, call_wall: null, put_wall: null, prior_close: null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await res.json() as any;
    return {
      regime: data?.regime?.composite ?? data?.intelligence?.currentRegime ?? null,
      anomalies: Array.isArray(data?.anomalies) ? data.anomalies : [],
      gex_bias: data?.lastBrief?.gexBias ?? null,
      call_wall: typeof data?.lastBrief?.callWall === "number" ? data.lastBrief.callWall : null,
      put_wall: typeof data?.lastBrief?.putWall === "number" ? data.lastBrief.putWall : null,
      // prior_close not in the intel payload — we'll derive from the edition's dossier or spx bar
      prior_close: null,
    };
  } catch {
    return { regime: null, anomalies: [], gex_bias: null, call_wall: null, put_wall: null, prior_close: null };
  }
}

// Fetch prior SPX close from Polygon daily bars.
async function fetchSpxPriorClose(): Promise<number | null> {
  const apiKey = process.env.POLYGON_API_KEY;
  const base = process.env.POLYGON_API_BASE?.replace(/\/$/, "") ?? "https://api.polygon.io";
  if (!apiKey) return null;
  try {
    // Fetch last 2 daily bars — the penultimate close is "prior close".
    const today = todayEt();
    const from = new Date(today);
    from.setDate(from.getDate() - 5); // go back 5 cal days to capture at least 2 trading days
    const fromStr = from.toISOString().slice(0, 10);
    const res = await fetch(
      `${base}/v2/aggs/ticker/I:SPX/range/1/day/${fromStr}/${today}?adjusted=true&sort=asc&limit=5&apiKey=${apiKey}`,
      { cache: "no-store" }
    );
    if (!res.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await res.json() as any;
    const bars = data?.results ?? [];
    // PRIOR close = the last bar dated strictly BEFORE today in ET. The old `at(-2)`
    // assumed the final bar was "today's partial" — but this runs at ~9:15 ET, BEFORE
    // the open, when no bar for today exists yet, so at(-2) was the day-BEFORE-
    // yesterday and the "overnight gap" absorbed a whole extra session's move
    // (enough to false-trip the 20-pt INVALIDATE on a benign morning). Mirrors the
    // etYmdFromMs fix in spx-session.ts.
    const etDate = (ms: number) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ms));
    const prior = [...bars].reverse().find(
      (b: { t?: number; c?: number }) => b?.t != null && etDate(b.t) < today
    );
    return prior?.c ?? null;
  } catch {
    return null;
  }
}


function renderMarkdown(result: MorningConfirmResult): string {
  const { edition_for, checked_at, spx_premarket, prior_close, overnight_gap_pts, regime, plays, summary } = result;
  const gap = overnight_gap_pts !== null
    ? `${overnight_gap_pts > 0 ? "+" : ""}${overnight_gap_pts.toFixed(1)} pts`
    : "unknown";
  const lines = [
    `# Night Hawk Morning Confirmation — ${edition_for}`,
    ``,
    `**Checked at:** ${checked_at}`,
    `**SPX Pre-market:** ${spx_premarket ?? "N/A"}`,
    `**Prior Close:** ${prior_close ?? "N/A"}`,
    `**Overnight Gap:** ${gap}`,
    `**Regime:** ${regime ?? "unknown"}`,
    ``,
    `## Summary`,
    ``,
    `| Status | Count |`,
    `|--------|-------|`,
    `| CONFIRMED | ${summary.confirmed} |`,
    `| DEGRADED | ${summary.degraded} |`,
    `| INVALIDATED | ${summary.invalidated} |`,
    ``,
    `## Play Verdicts`,
    ``,
  ];
  for (const p of plays) {
    const badge =
      p.status === "CONFIRMED" ? "✓" : p.status === "DEGRADED" ? "~" : p.status === "UNVERIFIED" ? "?" : "✗";
    lines.push(`### ${badge} #${p.rank} ${p.ticker} (${p.direction}) — ${p.status}`);
    lines.push(`${p.reason}`);
    lines.push(``);
  }
  return lines.join("\n");
}

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!inMorningWindow(force)) {
    const payload = { ok: false, skipped: true, reason: "Outside 9:10–9:45 ET window — use ?force=1 to override" };
    await logCronRun(CRON_KEY, started, payload);
    return NextResponse.json(payload);
  }

  const today = todayEt();
  // Holiday guard: the Railway schedule is weekday-based and inEtWindow only knows
  // Sat/Sun, so without this the cron fires on NYSE holidays (e.g. Fri 2026-07-03),
  // falls back to the NEXT session's edition (Monday's, published the prior evening),
  // computes an "overnight gap" from a closed market, and can spuriously INVALIDATE
  // Monday's plays + page ops — with the bogus verdicts sitting in Redis all weekend.
  if (!force && !isTradingDayEt(today)) {
    const payload = { ok: false, skipped: true, reason: `Market holiday (${today}) — no session to confirm` };
    await logCronRun(CRON_KEY, started, payload);
    return NextResponse.json(payload);
  }
  // Night Hawk edition_for is typically the NEXT trading day from yesterday's run, but
  // for morning confirm we want the edition that covers today's plays.
  // Attempt: fetch exact edition for today, fallback to latest.
  const editionDateParam = req.nextUrl.searchParams.get("date") ?? today;

  try {
    // ── Phase 1: fetch the edition ──────────────────────────────────────────
    let editionRow = await fetchNighthawkEditionByDate(editionDateParam);
    if (!editionRow) {
      // Also try fetching the latest (covers the case where edition_for = next trading day)
      editionRow = await fetchLatestNighthawkEdition();
    }

    if (!editionRow) {
      const payload = { ok: false, skipped: true, reason: "No Night Hawk edition found to validate" };
      await logCronRun(CRON_KEY, started, payload);
      return NextResponse.json(payload);
    }

    const edition = rowToNightHawkEdition(editionRow);
    const plays: PlaybookPlay[] = edition.plays ?? [];
    const editionFor = edition.edition_for ?? editionDateParam;

    // Session-match guard: verdicts are written under nh:play-status:${editionFor},
    // so confirming an edition for a DIFFERENT session than today pollutes that
    // session's key with today's (irrelevant) pre-market read. The fetchLatest
    // fallback above can legitimately return a FUTURE edition (e.g. Monday's,
    // published Thursday evening when Friday is a holiday) — skip it; Monday's own
    // 9:15 run is the one that should judge Monday's plays. ?force (admin/manual,
    // optionally with an explicit ?date=) still overrides for testing.
    if (!force && editionFor !== today) {
      const payload = {
        ok: false,
        skipped: true,
        reason: `Edition targets ${editionFor}, not today (${today}) — nothing to confirm this session`,
      };
      await logCronRun(CRON_KEY, started, payload);
      return NextResponse.json(payload);
    }

    if (!plays.length) {
      const payload = { ok: false, skipped: true, reason: `Edition ${editionFor} has no plays to validate` };
      await logCronRun(CRON_KEY, started, payload);
      return NextResponse.json(payload);
    }

    // ── Phase 2: fetch context in parallel ──────────────────────────────────
    // Determine the base URL for internal API calls (self-calls).
    const host = req.headers.get("host") ?? "localhost:3000";
    const proto = host.startsWith("localhost") ? "http" : "https";
    const baseUrl = `${proto}://${host}`;

    const [intel, spxPremarket, priorClose, stockSnaps] = await Promise.all([
      fetchPlatformIntel(baseUrl),
      fetchSpxPremarket(),
      fetchSpxPriorClose(),
      // The plays' OWN pre-market prices — one batched Polygon snapshot call. The
      // audit's core confirm gap: only the SPX index was checked, so a stock that
      // gapped through its own stop still confirmed.
      fetchStockSnapshots(plays.map((p) => p.ticker)).catch(
        () => ({}) as Record<string, { price: number } | null>
      ),
    ]);

    // Extract edition's stored GEX walls from the market_recap block if present.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recap = edition.market_recap as any;
    const editionCallWall: number | null = typeof recap?.call_wall === "number" ? recap.call_wall : null;
    const editionPutWall: number | null = typeof recap?.put_wall === "number" ? recap.put_wall : null;

    const gapPts =
      spxPremarket !== null && priorClose !== null
        ? spxPremarket - priorClose
        : null;

    // GLOBAL ABSTAIN (audit HIGH): when EVERY data source is unreachable — no gap, no
    // intel, no walls, no anomalies, no per-stock snapshot — writing verdicts would
    // manufacture a full slate of green badges from nothing. Withhold instead: no
    // Redis write, and the cron log carries the reason (cron-health shows warning).
    const anySnapshot = plays.some((p) => (stockSnaps[p.ticker.toUpperCase()]?.price ?? 0) > 0);
    const anyContext =
      gapPts !== null ||
      intel.regime !== null ||
      intel.anomalies.length > 0 ||
      intel.call_wall !== null ||
      intel.put_wall !== null ||
      anySnapshot;
    if (!anyContext) {
      const payload = {
        ok: false,
        skipped: true,
        reason: "Insufficient pre-market data (intel + Polygon unreachable) — verdicts withheld rather than fabricated",
      };
      await logCronRun(CRON_KEY, started, payload);
      return NextResponse.json(payload);
    }

    // ── Phase 3: per-play verdicts ──────────────────────────────────────────
    const playStatuses: PlayStatus[] = plays.map((play) =>
      computePlayVerdict(play, {
        gapPts,
        regime: intel.regime,
        anomalies: intel.anomalies,
        callWall: intel.call_wall,
        putWall: intel.put_wall,
        editionCallWall,
        editionPutWall,
        stockPremarket: stockSnaps[play.ticker.toUpperCase()]?.price ?? null,
      })
    );

    const summary = {
      confirmed: playStatuses.filter((p) => p.status === "CONFIRMED").length,
      degraded: playStatuses.filter((p) => p.status === "DEGRADED").length,
      invalidated: playStatuses.filter((p) => p.status === "INVALIDATED").length,
      unverified: playStatuses.filter((p) => p.status === "UNVERIFIED").length,
    };

    const result: MorningConfirmResult = {
      edition_for: editionFor,
      checked_at: new Date().toISOString(),
      spx_premarket: spxPremarket,
      prior_close: priorClose,
      overnight_gap_pts: gapPts,
      regime: intel.regime,
      gex_bias: intel.gex_bias,
      call_wall: intel.call_wall,
      put_wall: intel.put_wall,
      plays: playStatuses,
      summary,
    };

    // ── Phase 4: write to Redis ─────────────────────────────────────────────
    try {
      const redisUrl = process.env.REDIS_URL ?? "";
      if (redisUrl) {
        const redis = await makeRedis("nighthawk-morning-confirm", redisUrl, { maxRetriesPerRequest: 1 });
        await redis.set(REDIS_KEY(editionFor), JSON.stringify(result), "EX", REDIS_TTL_S);
        await redis.quit();
      }
    } catch (redisErr) {
      // Non-fatal: log but don't fail the cron — the JSON response still carries the result.
      console.error("[nighthawk-morning-confirm] Redis write failed:", redisErr);
    }

    // ── Phase 5: write markdown (best-effort) ──────────────────────────────
    try {
      const docsDir = path.join(process.cwd(), "docs", "nighthawk");
      await fs.mkdir(docsDir, { recursive: true });
      const mdPath = path.join(docsDir, `morning-confirm-${editionFor}.md`);
      await fs.writeFile(mdPath, renderMarkdown(result), "utf-8");
    } catch {
      // Ephemeral FS on Railway — skip silently.
    }

    // ── Phase 6: Discord ops alert on invalidations ─────────────────────────
    const invalidated = playStatuses.filter((p) => p.status === "INVALIDATED");
    if (invalidated.length > 0) {
      await notifyOpsDiscord({
        severity: "warning",
        title: `Night Hawk: ${invalidated.length} play(s) INVALIDATED pre-open (${editionFor})`,
        body: invalidated
          .map((p) => `• #${p.rank} ${p.ticker} (${p.direction}): ${p.reason}`)
          .join("\n"),
      }).catch(() => undefined);
    }

    const payload = { ok: true, edition_for: editionFor, ...summary, duration_ms: Date.now() - started };
    await logCronRun(CRON_KEY, started, payload);
    return NextResponse.json({ ...payload, plays: playStatuses });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[nighthawk-morning-confirm] fatal:", error);
    await notifyOpsDiscord({
      severity: "critical",
      title: `Night Hawk morning-confirm FAILED (${editionDateParam})`,
      body: error,
    }).catch(() => undefined);
    const payload = { ok: false, error };
    await logCronRun(CRON_KEY, started, payload);
    return NextResponse.json(payload, { status: 500 });
  }
}

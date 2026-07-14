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
//   5. PERSISTS each verdict + the numbers it saw onto the play's outcome row
//      (nighthawk_play_outcomes.morning_verdict, first-write-wins) and, for
//      INVALIDATED, engages the one-way PULLED latch (PR-N4 — see
//      morning-verdict-persist.ts; before this, verdicts lived only in the 24h
//      Redis blob and an INVALIDATED play stayed tradeable all day: AMD 7/07).
//   6. Writes the status blob to Redis at nh:play-status:{YYYYMMDD} (TTL 24h) —
//      kept alongside the DB write; the UI badge layer reads it today.
//   7. Writes docs/nighthawk/morning-confirm-{YYYYMMDD}.md (best-effort, ephemeral FS).
//   8. Ops-alerts on Discord if any play is INVALIDATED.
//
// AUTH: Bearer CRON_SECRET (isCronAuthorized). force-dynamic. maxDuration 60s.
//
// The edition ROW (nighthawk_editions.plays) is still never mutated — the pull latch
// lives on the outcome row and is merged onto the member payload at read time
// (/api/market/nighthawk/edition), so the published record stays intact while the
// actionable surface presents the play as PULLED with its reason.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { fetchIndexSnapshots, fetchStockSnapshots } from "@/lib/providers/polygon";
import {
  computePlayVerdict,
  worsenPlayStatus,
  type PlayConfirmStatus,
  type PlayStatus,
} from "@/features/nighthawk/lib/morning-confirm-verdict";
// PR-N6/N7 — the binding overnight axes: re-evaluate the pinned THESIS (thesis-drift) and
// run the pinned pre-declared INVALIDATORS against the morning state. Both are ONE-WAY (can
// only degrade/invalidate); the composed `status` folds them in via worsenPlayStatus.
import { detectThesisDrift, overnightAxisStatus } from "@/features/nighthawk/lib/thesis-drift";
import {
  evaluateInvalidators,
  firedInvalidators,
  type MorningState,
} from "@/features/nighthawk/lib/invalidators";
import { fetchPendingNighthawkOutcomes } from "@/lib/db";
import { persistNighthawkMorningVerdicts } from "@/features/nighthawk/lib/morning-verdict-persist";
import { notifyOpsDiscord } from "@/features/spx/lib/spx-play-notify";
import { makeRedis } from "@/lib/make-redis";
import { todayEt as etYmdOf } from "@/lib/et-date";
import { requireDatabaseInProduction, fetchLatestNighthawkEdition, fetchNighthawkEditionByDate } from "@/lib/db";
import { rowToNightHawkEdition } from "@/features/nighthawk/lib/edition-builder";
import { todayEt, isTradingDayEt } from "@/features/nighthawk/lib/session";
import { inEtWindow } from "@/features/nighthawk/lib/et-window";
import type { PlaybookPlay } from "@/features/nighthawk/lib/types";

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
    const etDate = (ms: number) => etYmdOf(new Date(ms));
    const prior = [...bars].reverse().find(
      (b: { t?: number; c?: number }) => b?.t != null && etDate(b.t) < today
    );
    return prior?.c ?? null;
  } catch {
    return null;
  }
}


// SPX-index tickers whose morning walls the platform-intel SPX brief legitimately supplies.
// A stock (or SPY, which trades ~1/10 of SPX) must NOT borrow SPX-scale walls — for those,
// the morning wall stays null so the wall-migration invalidator self-skips (UNKNOWN) rather
// than misfiring on a cross-instrument comparison.
const SPX_INDEX_TICKERS = new Set(["SPX", "SPXW"]);

/**
 * PR-N6/N7 — fold the two ONE-WAY overnight axes onto a play's base PRICE verdict:
 *   - thesis-drift (N6): re-evaluate each pinned cortex evidence source's premise;
 *   - pinned invalidators (N7): run the pre-declared falsifiers against the morning state.
 * Both can only worsen the grade (worsenPlayStatus). The evidence for any downgrade rides
 * in the additive PlayStatus fields (thesisDrift / thesisVerdict / invalidatorsFired).
 * Fail-soft: a play with no pinned context (pre-N5/N7, or a fetch miss) returns `base`
 * unchanged — the axes never manufacture a downgrade from missing evidence.
 */
function applyOvernightAxes(
  play: PlaybookPlay,
  base: PlayStatus,
  ctx: {
    stockPremarket: number | null;
    spxPremarket: number | null;
    intel: { regime: string | null; call_wall: number | null; put_wall: number | null };
    publishContext: Record<string, unknown> | null;
    checkedAt: string;
  }
): PlayStatus {
  if (!ctx.publishContext) return base;

  const ticker = play.ticker.toUpperCase();
  const isSpxIndex = SPX_INDEX_TICKERS.has(ticker);
  // Morning spot: the play's OWN pre-market (or the SPX index pre-market for an SPX play).
  const spot = isSpxIndex ? ctx.spxPremarket : ctx.stockPremarket;

  const morningState: MorningState = {
    ticker,
    asOf: ctx.checkedAt,
    spot: spot != null && spot > 0 ? spot : null,
    // The morning cron does not re-fetch a per-ticker gamma-flip; the flip falsifier is
    // pinned as a LEVEL, so flip drift needs only morning spot (below), not this field.
    gammaFlip: null,
    // Index walls only (see SPX_INDEX_TICKERS); a stock's morning wall is not re-fetched.
    callWall: isSpxIndex ? ctx.intel.call_wall : null,
    putWall: isSpxIndex ? ctx.intel.put_wall : null,
    regime: ctx.intel.regime,
    // Dark-pool bias is not re-fetched at morning — null keeps that falsifier honestly
    // UNKNOWN (never fires) rather than fabricating a "held" from no read.
    darkPoolBias: null,
  };

  const thesis = detectThesisDrift(ctx.publishContext as Parameters<typeof detectThesisDrift>[0], morningState);
  const evals = evaluateInvalidators((ctx.publishContext as Record<string, unknown>).invalidators, morningState);
  const fired = firedInvalidators(evals);
  const axis = overnightAxisStatus(thesis.thesisVerdict, evals);

  const status = worsenPlayStatus(base.status, axis.status);
  const worsened = status !== base.status;
  const axisReasons = [
    ...(thesis.thesisVerdict !== "HELD" ? [thesis.reason] : []),
    ...axis.reasons,
  ];
  // Only surface axis reasons in the member-facing string when they actually changed the
  // grade (the full evidence is always in thesisDrift/invalidatorsFired regardless).
  let reason = base.reason;
  if (worsened && axisReasons.length) {
    const priceHadContent = base.reason && base.reason !== "All checks passed";
    reason = priceHadContent
      ? `${base.reason}; overnight: ${axisReasons.join("; ")}`
      : `Overnight axis: ${axisReasons.join("; ")}`;
  }

  return {
    ...base,
    status,
    reason,
    thesisDrift: thesis.perSource,
    thesisVerdict: thesis.thesisVerdict,
    invalidatorsFired: fired.map((e) => ({
      id: e.invalidator.id,
      severity: e.invalidator.severity,
      detail: e.detail,
    })),
  };
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
      // Write an honest empty blob so the member-facing play-status route can say
      // "this session's edition published no plays" instead of the misleading
      // "Morning confirmation not yet run" it served all day (audit finding from
      // the live 2026-07-02 zero-play edition). Best-effort — skip result stands
      // regardless.
      try {
        const redisUrl = process.env.REDIS_URL ?? "";
        if (redisUrl) {
          const redis = await makeRedis("nh-morning-confirm", redisUrl, { maxRetriesPerRequest: 1 });
          const emptyResult: MorningConfirmResult = {
            edition_for: editionFor,
            checked_at: new Date().toISOString(),
            spx_premarket: null,
            prior_close: null,
            overnight_gap_pts: null,
            regime: null,
            gex_bias: null,
            call_wall: null,
            put_wall: null,
            plays: [],
            summary: { confirmed: 0, degraded: 0, invalidated: 0, unverified: 0 },
          };
          await redis.set(REDIS_KEY(editionFor), JSON.stringify(emptyResult), "EX", REDIS_TTL_S);
          redis.disconnect();
        }
      } catch {
        /* best-effort */
      }
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

    // ── Phase 2.5: load the pinned publish contexts (PR-N6/N7) ───────────────
    // The overnight axes re-check what the builder PINNED at publish (cortex_overnight +
    // invalidators, both immutable). Fetch this morning's freshly-published (pending)
    // outcome rows and key their publish_context by ticker. Fail-soft: an empty/failed
    // fetch simply means the axes have nothing to re-check (no downgrade) — never a crash.
    const publishContextByTicker = new Map<string, Record<string, unknown>>();
    try {
      const pendingRows = await fetchPendingNighthawkOutcomes(2);
      for (const row of pendingRows) {
        if (row.edition_for !== editionFor) continue;
        if (row.publish_context) publishContextByTicker.set(row.ticker.toUpperCase(), row.publish_context);
      }
    } catch (err) {
      console.warn("[nighthawk-morning-confirm] publish_context fetch failed (overnight axes skipped):", err);
    }

    // ── Phase 3: per-play verdicts ──────────────────────────────────────────
    // Base PRICE verdict (unchanged logic), then compose the overnight axes ONE-WAY on top.
    const playStatuses: PlayStatus[] = plays.map((play) => {
      const base = computePlayVerdict(play, {
        gapPts,
        regime: intel.regime,
        anomalies: intel.anomalies,
        callWall: intel.call_wall,
        putWall: intel.put_wall,
        editionCallWall,
        editionPutWall,
        stockPremarket: stockSnaps[play.ticker.toUpperCase()]?.price ?? null,
      });
      return applyOvernightAxes(play, base, {
        stockPremarket: stockSnaps[play.ticker.toUpperCase()]?.price ?? null,
        spxPremarket,
        intel,
        publishContext: publishContextByTicker.get(play.ticker.toUpperCase()) ?? null,
        checkedAt: new Date().toISOString(),
      });
    });

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

    // ── Phase 3.5: persist verdicts durably + engage the INVALIDATED pull latch ──
    // PR-N4: onto the plays' outcome rows (morning_verdict JSONB, first-write-wins;
    // INVALIDATED ⇒ one-way pulled). Fail-soft by contract — the helper never throws;
    // a DB failure costs the durable copy for this run (reported in the cron payload
    // below), never the Redis blob or the cron itself. DEGRADED persists label-only.
    const verdictPersist = await persistNighthawkMorningVerdicts({
      editionFor,
      checkedAt: result.checked_at,
      playStatuses,
      plays,
      market: {
        gapPts,
        spxPremarket,
        spxPriorClose: priorClose,
        regime: intel.regime,
        stockPremarketByTicker: Object.fromEntries(
          plays.map((p) => [p.ticker.toUpperCase(), stockSnaps[p.ticker.toUpperCase()]?.price ?? null])
        ),
      },
    });
    if (!verdictPersist.ok || verdictPersist.missing_rows > 0) {
      console.warn(
        `[nighthawk-morning-confirm] verdict persistence degraded — persisted=${verdictPersist.persisted} ` +
          `already=${verdictPersist.already_recorded} missing_rows=${verdictPersist.missing_rows} ` +
          `errors=${verdictPersist.errors.join("; ") || "none"}`
      );
    }

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

    const payload = {
      ok: true,
      edition_for: editionFor,
      ...summary,
      // PR-N4: the durable-verdict ledger for this run — cron-health meta shows whether
      // verdicts actually persisted (and whether any play had no outcome row to pin to).
      verdicts_persisted: verdictPersist.persisted,
      verdicts_already_recorded: verdictPersist.already_recorded,
      verdicts_missing_rows: verdictPersist.missing_rows,
      plays_pulled: verdictPersist.pulled,
      verdict_persist_errors: verdictPersist.errors,
      duration_ms: Date.now() - started,
    };
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

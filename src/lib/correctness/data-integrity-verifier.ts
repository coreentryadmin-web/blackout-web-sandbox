import "server-only";

import {
  type CheckResult,
  type MetricScore,
  type TickerScore,
  rollUpMetricStatus,
  worstStatus,
} from "@/lib/correctness/types";
import { dbConfigured, dbQuery, fetchLatestNighthawkEdition, fetchNighthawkEditionByDate } from "@/lib/db";
import { getGexPositioning } from "@/lib/providers/gex-positioning";
import { sharedCacheGetWithTtl } from "@/lib/shared-cache";
import { buildCronHealthSnapshot } from "@/lib/admin-cron-health";
import { isWeekdayEt } from "@/lib/nighthawk/session";
import { etMinutes, etClock } from "@/lib/spx-play-session-time";

// ---------------------------------------------------------------------------
// DATA-LAYER + PIPELINE-INTEGRITY verifier — the "are the numbers actually being
// WRITTEN and FLOWING to the website?" surface of the data-correctness auditor.
//
// Every OTHER verifier on this scorecard asks "is the served number CORRECT?". This
// one sits one level below them and asks "is the data LAYER healthy end-to-end?" —
// source → Postgres/Redis → API → website. A correct formula over a STALE/EMPTY
// table or an EXPIRED cache still ships a wrong page; this surface catches that.
//
// FOUR layers, all MARKET-HOURS AWARE (expected after-hours/weekend quiet is NOT a flag):
//   1. POSTGRES per critical table — latest-row freshness, row-count sanity (not
//      unexpectedly empty), null/garbage rate on key numeric columns. FLAG stale/
//      empty/garbage DURING the window only.
//   2. REDIS per critical key/namespace — key present, TTL within the expected window
//      (not expired / stale-as-live), value parses + is sane. FLAG missing/expired/corrupt.
//   3. PIPELINE-HOP RECONCILIATION — for key paths confirm the hops AGREE: the
//      gex-positioning cache vs the DB-backed SPX desk spot; the served edition-by-date
//      read vs the latest-edition read (same row two ways). Reconcile where cheap; else
//      note consistency-only.
//   4. WRITER-CRON HEALTH — from cron_job_runs / admin-cron-health, confirm the critical
//      WRITERS that populate PG/Redis (flow-ingest, uw-cache-refresh, nights-watch-warm,
//      heatmap-warm, the nighthawk crons) ran recently + succeeded. A dead writer = stale
//      downstream data, so this FLAGs an overdue writer DURING its window.
//
// RATE DISCIPLINE (reference_blackout_api_scaling — the cache-reader rule):
//   • Postgres: lightweight AGGREGATE reads only (COUNT / MAX(ts) / AVG over a small
//     recent window) — no row dumps, no per-row fan-out.
//   • Redis: read through the SAME public cache-reader functions the app uses
//     (getGexPositioning → the gex-heatmap:{ticker} cache; sharedCacheGetWithTtl for raw
//     namespaces). NO raw ioredis client is opened here, NO credential is read/printed,
//     and NO new uncapped provider fan-out is introduced.
//   • Writer health reuses buildCronHealthSnapshot (a DB reader already on this path).
// READ-ONLY everywhere; this never writes a row or a key.
//
// HONESTY: a PASS here means "the layer is present + fresh + sane", which is a STRONGER,
// independent claim than the per-surface consistency checks (it is a real second view of
// the pipeline), so freshness/presence/writer checks that hold are reported PASS. Cross-
// hop reconciliations with no independent oracle stay consistency-only. Nothing here is a
// false green: a missing source SKIPS (closed market / DB not configured), never passes.
// ---------------------------------------------------------------------------

const TICKER = "DATALAYER";

/** Disable the whole surface (mirrors the other CORRECTNESS_* switches). */
function enabled(): boolean {
  return process.env.CORRECTNESS_DATA_INTEGRITY !== "0";
}
/** Disable just the Redis layer (e.g. a deploy with REDIS_URL intentionally unset). */
function redisLayerEnabled(): boolean {
  return process.env.CORRECTNESS_DATA_INTEGRITY_REDIS !== "0" && Boolean(process.env.REDIS_URL?.trim());
}

/**
 * RTH gate (DST-aware ET, weekdays) mirroring admin-cron-health.inMarketHoursEt: 9:30 AM–4:00 PM ET
 * Mon–Fri. Used to gate Postgres-writer freshness FLAGs — a market-hours writer (flow-ingest, the
 * warmers) legitimately stops off-window, so an old latest-row off-window is NOT a flag.
 */
function inMarketHoursEt(now = new Date()): boolean {
  if (!isWeekdayEt()) return false;
  const mins = etMinutes(now);
  return mins >= etClock(9, 30) && mins <= etClock(16, 0);
}

type Ctx = { now: number; marketOpen: boolean; rth: boolean };

function mk(
  layer: CheckResult["layer"],
  metric: string,
  outcome: CheckResult["outcome"],
  detail: string,
  extra: Partial<CheckResult> = {}
): CheckResult {
  return {
    id: `${TICKER}:${metric}:${layer}:${extra.id ?? Math.abs(hashStr(detail)).toString(36)}`,
    layer,
    metric,
    outcome,
    detail,
    ...extra,
  };
}
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function groupMetrics(checks: CheckResult[]): MetricScore[] {
  const byMetric = new Map<string, CheckResult[]>();
  for (const c of checks) {
    const arr = byMetric.get(c.metric) ?? [];
    arr.push(c);
    byMetric.set(c.metric, arr);
  }
  const scores: MetricScore[] = [];
  for (const [metric, mchecks] of byMetric.entries()) {
    const { status, independentlyConfirmed } = rollUpMetricStatus(mchecks);
    scores.push({ ticker: TICKER, metric, status, independentlyConfirmed, checks: mchecks });
  }
  return scores;
}

function ageMin(thenMs: number, now: number): number {
  return (now - thenMs) / 60_000;
}

// ───────────────────────────────────────────────────────────────────────────
// LAYER 1 — Postgres per critical table.
//
// One small aggregate row per table: COUNT in a recent window + MAX(latest ts) +
// (where it matters) the null/zero rate on a key numeric column. Each table carries
// its OWN window-awareness — a market-hours writer (flow_alerts) is only freshness-
// flagged during RTH; a cadence writer (editions) uses its own cadence.
// ───────────────────────────────────────────────────────────────────────────

/** One DB aggregate probe (best-effort — a thrown/absent table degrades to a skip, never a flag). */
async function dbProbe<T extends Record<string, unknown>>(
  sql: string,
  values: unknown[] = []
): Promise<T | null> {
  try {
    const res = await dbQuery<T>(sql, values);
    return res.rows[0] ?? null;
  } catch {
    return null;
  }
}

async function checkPostgres(ctx: Ctx): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];
  if (!dbConfigured()) {
    return [
      mk("freshness", "pg", "skipped", "DATABASE_URL not configured — Postgres data-layer checks not assertable.", {
        id: "pg-unconfigured",
      }),
    ];
  }

  // ── flow_alerts — the live tape. Market-hours writer (flow-ingest ~2 min). ──
  {
    const row = await dbProbe<{ rows_60m: string; latest_ms: string | null; null_prem: string; total: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE COALESCE(created_at, inserted_at) >= NOW() - INTERVAL '60 minutes')::int AS rows_60m,
         (EXTRACT(EPOCH FROM MAX(COALESCE(created_at, inserted_at))) * 1000)::bigint AS latest_ms,
         COUNT(*) FILTER (WHERE COALESCE(total_premium, 0) <= 0)::int AS null_prem,
         COUNT(*)::int AS total
       FROM flow_alerts
       WHERE COALESCE(created_at, inserted_at) >= NOW() - INTERVAL '24 hours'`
    );
    if (!row) {
      checks.push(mk("freshness", "pg_flow_alerts", "skipped", "flow_alerts probe failed/absent — skipped.", { id: "pg-flow-probe" }));
    } else {
      const latestMs = row.latest_ms != null ? Number(row.latest_ms) : NaN;
      const rows60m = Number(row.rows_60m);
      const total24h = Number(row.total);
      // Freshness — only assert DURING RTH (the writer correctly idles off-window).
      if (ctx.rth) {
        const aMin = Number.isFinite(latestMs) ? ageMin(latestMs, ctx.now) : Infinity;
        const fresh = Number.isFinite(latestMs) && aMin <= 20; // flow-ingest stale_after_min = 15; 20 = real stall
        checks.push(
          mk(
            "freshness",
            "pg_flow_alerts",
            fresh ? "pass" : "flag",
            fresh
              ? `flow_alerts latest row is ${aMin.toFixed(1)}m old during RTH (≤ 20m); ${rows60m} rows in the last 60m — tape is being written.`
              : `flow_alerts latest row is ${Number.isFinite(aMin) ? `${aMin.toFixed(0)}m` : "absent"} old during RTH — the flow-ingest writer is not landing rows (stale downstream tape).`,
            { id: "pg-flow-fresh", actual: Number.isFinite(aMin) ? Number(aMin.toFixed(1)) : null, tolerance: 20 }
          )
        );
        // Row-count sanity — RTH with zero rows in 60m is an empty-table symptom.
        checks.push(
          mk(
            "sanity-bound",
            "pg_flow_alerts",
            rows60m > 0 ? "pass" : "flag",
            rows60m > 0
              ? `flow_alerts has ${rows60m} rows in the last 60m during RTH (not unexpectedly empty).`
              : `flow_alerts has ZERO rows in the last 60m during RTH — unexpectedly empty (ingest dead or upstream dry).`,
            { id: "pg-flow-rowcount", actual: rows60m, expected: ">0" }
          )
        );
      } else {
        checks.push(
          mk("freshness", "pg_flow_alerts", "skipped", "Market closed / off-RTH — flow_alerts freshness not asserted (writer legitimately idle).", {
            id: "pg-flow-fresh",
          })
        );
      }
      // Garbage rate on total_premium — window-agnostic structural check over the 24h sample.
      if (total24h >= 20) {
        const nullPrem = Number(row.null_prem);
        const rate = nullPrem / total24h;
        const ok = rate < 0.9; // a tape that is ~all null/0-premium is a parse/write break
        checks.push(
          mk(
            "sanity-bound",
            "pg_flow_alerts",
            ok ? "pass" : "flag",
            ok
              ? `total_premium is populated on ${(100 * (1 - rate)).toFixed(0)}% of the last ${total24h} rows (not all-null/0).`
              : `total_premium is ≤0/null on ${(100 * rate).toFixed(0)}% of the last ${total24h} rows — a premium parse/write break (numbers display as $0).`,
            { id: "pg-flow-garbage", actual: Number(rate.toFixed(3)), tolerance: 0.9 }
          )
        );
      }
    }
  }

  // ── cron_job_runs — every cron tick logs here; recent rows ⇒ the cron plane is alive. ──
  {
    const row = await dbProbe<{ latest_ms: string | null; rows_60m: string }>(
      `SELECT (EXTRACT(EPOCH FROM MAX(started_at)) * 1000)::bigint AS latest_ms,
              COUNT(*) FILTER (WHERE started_at >= NOW() - INTERVAL '60 minutes')::int AS rows_60m
       FROM cron_job_runs`
    );
    if (!row) {
      checks.push(mk("freshness", "pg_cron_runs", "skipped", "cron_job_runs probe failed/absent — skipped.", { id: "pg-cron-probe" }));
    } else {
      const latestMs = row.latest_ms != null ? Number(row.latest_ms) : NaN;
      // RTH: a fleet of market-hours crons tick every few minutes, so the freshest run should be recent.
      if (ctx.rth) {
        const aMin = Number.isFinite(latestMs) ? ageMin(latestMs, ctx.now) : Infinity;
        const fresh = Number.isFinite(latestMs) && aMin <= 30;
        checks.push(
          mk(
            "freshness",
            "pg_cron_runs",
            fresh ? "pass" : "flag",
            fresh
              ? `cron_job_runs newest row is ${aMin.toFixed(1)}m old during RTH (≤ 30m); ${Number(row.rows_60m)} runs logged in 60m — the cron plane is writing.`
              : `cron_job_runs newest row is ${Number.isFinite(aMin) ? `${aMin.toFixed(0)}m` : "absent"} old during RTH — NO cron is logging (the whole cron plane may be down → every PG/Redis writer is stale).`,
            { id: "pg-cron-fresh", actual: Number.isFinite(aMin) ? Number(aMin.toFixed(1)) : null, tolerance: 30 }
          )
        );
      } else {
        checks.push(
          mk("freshness", "pg_cron_runs", "skipped", "Off-RTH — cron_job_runs freshness not asserted (most crons are market-hours-only).", {
            id: "pg-cron-fresh",
          })
        );
      }
    }
  }

  // ── nighthawk_editions — cadence writer (one per weekday evening). Stale = days, not minutes. ──
  {
    const row = await dbProbe<{ latest_ms: string | null; total: string }>(
      `SELECT (EXTRACT(EPOCH FROM MAX(published_at)) * 1000)::bigint AS latest_ms,
              COUNT(*)::int AS total
       FROM nighthawk_editions`
    );
    if (!row) {
      checks.push(mk("freshness", "pg_editions", "skipped", "nighthawk_editions probe failed/absent — skipped.", { id: "pg-ed-probe" }));
    } else {
      const total = Number(row.total);
      const latestMs = row.latest_ms != null ? Number(row.latest_ms) : NaN;
      if (total === 0) {
        // Empty editions table is the documented "empty editions" failure class (MEMORY: nighthawk).
        checks.push(
          mk("sanity-bound", "pg_editions", "consistency-only", "nighthawk_editions is empty — no edition has ever published (pre-launch, or the publish writer never landed). Not freshness-flagged (no cadence baseline yet).", {
            id: "pg-ed-empty",
          })
        );
      } else {
        const aHours = Number.isFinite(latestMs) ? (ctx.now - latestMs) / 3_600_000 : Infinity;
        // Cadence: editions publish weekday evenings. >96h (4 days) with no new edition spans a full
        // long-weekend + a missed night → a stuck publish pipeline. Window-aware: weekends are quiet.
        const STALE_HOURS = 96;
        const stale = !Number.isFinite(aHours) || aHours > STALE_HOURS;
        checks.push(
          mk(
            "freshness",
            "pg_editions",
            stale ? "flag" : "pass",
            stale
              ? `Latest nighthawk_edition published ${Number.isFinite(aHours) ? `${aHours.toFixed(0)}h` : "never"} ago (> ${STALE_HOURS}h) — the edition publish pipeline appears stuck (the page would show a stale/old edition).`
              : `Latest nighthawk_edition published ${aHours.toFixed(0)}h ago (within the ${STALE_HOURS}h cadence ceiling); ${total} editions total.`,
            { id: "pg-ed-fresh", actual: Number.isFinite(aHours) ? Number(aHours.toFixed(0)) : null, tolerance: STALE_HOURS }
          )
        );
      }
    }
  }

  // ── nighthawk_play_outcomes — the outcomes ledger that backs the track record numbers. ──
  {
    const row = await dbProbe<{ total: string; bad_outcome: string }>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE outcome NOT IN ('target','stop','open','ambiguous','pending'))::int AS bad_outcome
       FROM nighthawk_play_outcomes`
    );
    if (row && Number(row.total) > 0) {
      const bad = Number(row.bad_outcome);
      checks.push(
        mk(
          "sanity-bound",
          "pg_nh_outcomes",
          bad === 0 ? "pass" : "flag",
          bad === 0
            ? `nighthawk_play_outcomes: all ${Number(row.total)} rows carry an in-vocabulary outcome enum (clean ledger backing the track record).`
            : `nighthawk_play_outcomes has ${bad} row(s) with an out-of-vocabulary outcome — garbage in the ledger that backs hit-rate.`,
          { id: "pg-nh-outcome-vocab", actual: bad, expected: 0 }
        )
      );
    } else {
      checks.push(
        mk("sanity-bound", "pg_nh_outcomes", "skipped", "nighthawk_play_outcomes empty/absent — no outcomes ledger to sanity-check yet.", {
          id: "pg-nh-outcomes-empty",
        })
      );
    }
  }

  // ── user_positions — Night's Watch saved positions. Empty is LEGITIMATE (pre-users), so this is a
  //    structural garbage check only (never a freshness/empty FLAG). ──
  {
    const row = await dbProbe<{ total: string; bad: string }>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE NOT (contracts > 0) OR NOT (entry_premium >= 0) OR strike IS NULL)::int AS bad
       FROM user_positions`
    );
    if (row && Number(row.total) > 0) {
      const bad = Number(row.bad);
      checks.push(
        mk(
          "sanity-bound",
          "pg_user_positions",
          bad === 0 ? "pass" : "flag",
          bad === 0
            ? `user_positions: all ${Number(row.total)} rows have positive contracts, non-negative entry_premium, a strike (clean position math inputs).`
            : `user_positions has ${bad} row(s) with non-positive contracts / negative entry_premium / null strike — corrupt inputs to the P&L math.`,
          { id: "pg-up-garbage", actual: bad, expected: 0 }
        )
      );
    } else {
      checks.push(
        mk("sanity-bound", "pg_user_positions", "skipped", "user_positions empty/absent — no saved positions to sanity-check (legitimate pre-users).", {
          id: "pg-up-empty",
        })
      );
    }
  }

  return checks;
}

// ───────────────────────────────────────────────────────────────────────────
// LAYER 2 — Redis per critical key/namespace.
//
// Read through the SAME public cache-readers the app uses (no raw ioredis client):
//   • getGexPositioning(t) — the canonical reader over the gex-heatmap:{t} cache (in-mem
//     + Redis). A non-null result with a parseable, in-window `asof` and spot>0 proves the
//     key is present + the value parses + is sane + fresh (the warmer is writing it).
//   • sharedCacheGetWithTtl — raw TTL probe for a representative warmed namespace, to
//     assert the stored TTL is within the expected window (not expired / stale-as-live).
// ───────────────────────────────────────────────────────────────────────────

async function checkRedis(ctx: Ctx): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];
  if (!redisLayerEnabled()) {
    return [
      mk("freshness", "redis", "skipped", "REDIS_URL not set or Redis layer disabled (CORRECTNESS_DATA_INTEGRITY_REDIS=0) — cache-layer checks not assertable (caches fall back to in-memory).", {
        id: "redis-unconfigured",
      }),
    ];
  }

  // ── gex-heatmap cache via getGexPositioning (the cron-warmed GEX matrix the website reads). ──
  // heatmap-warm refreshes SPX every ~30s during RTH; the matrix TTL is ~20s–2min.
  for (const t of ["SPX", "SPY"]) {
    let pos: Awaited<ReturnType<typeof getGexPositioning>> = null;
    try {
      pos = await getGexPositioning(t);
    } catch {
      pos = null;
    }
    if (!pos) {
      // Cold cache. During RTH for SPX this is a real cache miss (the warmer should keep it hot);
      // off-RTH or for a non-warmed root it's legitimately cold → skip.
      if (ctx.rth && t === "SPX") {
        checks.push(
          mk(
            "freshness",
            "redis_gex",
            "flag",
            `getGexPositioning("${t}") returned NO matrix during RTH — the gex-heatmap cache is cold (heatmap-warm not writing Redis → Heat Maps / desk / NW read stale or empty).`,
            { id: `redis-gex-cold-${t}` }
          )
        );
      } else {
        checks.push(
          mk("freshness", "redis_gex", "skipped", `getGexPositioning("${t}") cold ${ctx.rth ? "(non-primary root)" : "(market closed)"} — not asserted.`, {
            id: `redis-gex-cold-${t}`,
          })
        );
      }
      continue;
    }
    // Value parses + is sane (the reader already parsed JSON; assert the structural invariants).
    const sane = pos.spot > 0 && Number.isFinite(pos.net_gex) && Number.isFinite(pos.spot);
    checks.push(
      mk(
        "sanity-bound",
        "redis_gex",
        sane ? "pass" : "flag",
        sane
          ? `gex-heatmap:${t} cache value parses + is sane (spot ${pos.spot}, finite net GEX) — the cached matrix the website reads is well-formed.`
          : `gex-heatmap:${t} cache value is CORRUPT (spot ${pos.spot} / non-finite net GEX) — the website would render garbage from this key.`,
        { id: `redis-gex-sane-${t}`, actual: pos.spot }
      )
    );
    // TTL / freshness — the matrix `asof` must be within the warm window DURING RTH.
    if (ctx.rth) {
      const asofMs = new Date(pos.asof).getTime();
      const aMin = Number.isFinite(asofMs) ? ageMin(asofMs, ctx.now) : Infinity;
      const fresh = Number.isFinite(asofMs) && aMin <= 15; // data-integrity-checks uses the same 15m RTH band
      checks.push(
        mk(
          "freshness",
          "redis_gex",
          fresh ? "pass" : "flag",
          fresh
            ? `gex-heatmap:${t} matrix asof is ${aMin.toFixed(1)}m old during RTH (≤ 15m) — the cache is being refreshed, not served stale-as-live.`
            : `gex-heatmap:${t} matrix asof is ${Number.isFinite(aMin) ? `${aMin.toFixed(0)}m` : "unparseable"} old during RTH — an EXPIRED/stuck cache served as live (heatmap-warm stalled).`,
          { id: `redis-gex-fresh-${t}`, actual: Number.isFinite(aMin) ? Number(aMin.toFixed(1)) : null, tolerance: 15 }
        )
      );
    } else {
      checks.push(
        mk("freshness", "redis_gex", "skipped", `gex-heatmap:${t} freshness not asserted off-RTH (warmer idle, last value legitimately old).`, {
          id: `redis-gex-fresh-${t}`,
        })
      );
    }
  }

  // ── Raw TTL probe on the gex-heatmap namespace — confirm the STORED TTL is positive + bounded.
  // sharedCacheGetWithTtl returns the remaining Redis TTL; a value present with TTL>0 proves the key
  // exists in Redis (not just the in-memory fallback) and is not stuck without an expiry. The
  // gex-heatmap entries are written via sharedCacheSet under `blackout:gex-heatmap:{t}`.
  {
    let probe: Awaited<ReturnType<typeof sharedCacheGetWithTtl<{ at: number }>>> = null;
    try {
      probe = await sharedCacheGetWithTtl<{ at: number }>("gex-heatmap:SPX");
    } catch {
      probe = null;
    }
    if (!probe) {
      checks.push(
        mk("freshness", "redis_ttl", ctx.rth ? "consistency-only" : "skipped", `Raw TTL probe on gex-heatmap:SPX returned nothing (Redis miss → in-memory-only or cold). ${ctx.rth ? "Covered by the getGexPositioning checks above." : "Off-RTH — not asserted."}`, {
          id: "redis-ttl-spx",
        })
      );
    } else {
      const ttl = probe.remainingTtlSec;
      // Expected window: a positive TTL that isn't absurdly long (the GEX entry is short-TTL ~≤ a few
      // minutes). -1 (no expiry) on a cache that should expire is itself a smell (stale-as-live risk).
      const ok = ttl > 0 && ttl <= 600;
      checks.push(
        mk(
          "freshness",
          "redis_ttl",
          ok ? "pass" : "flag",
          ok
            ? `gex-heatmap:SPX Redis key present with a bounded TTL (${ttl}s remaining ≤ 600s) — written to Redis with a real expiry (not a no-expiry stuck key).`
            : `gex-heatmap:SPX Redis TTL is ${ttl}s (expected 1–600s) — ${ttl < 0 ? "NO expiry set (stale-as-live risk)" : "TTL far outside the expected short window"}.`,
          { id: "redis-ttl-spx", actual: ttl, tolerance: 600 }
        )
      );
    }
  }

  return checks;
}

// ───────────────────────────────────────────────────────────────────────────
// LAYER 3 — Pipeline-hop reconciliation ("is the data reaching the website?").
//
// Confirm the HOPS agree across the path. Cheap reconciliations get a real comparison;
// anything needing a second oracle is recorded consistency-only.
// ───────────────────────────────────────────────────────────────────────────

async function checkPipelineHops(ctx: Ctx): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];

  // ── HOP A: gex-positioning cache (Redis) vs the DB/compute-backed SPX desk spot. ──
  // The desk loads through its own lanes; the heatmap matrix is the Redis-warmed path. If both are
  // live they must report the same SPX spot within tick jitter — a divergence means one hop is serving
  // a different (stale) value to the website than the other. (Cross-hop CONSISTENCY, single underlying
  // → consistency-only, not independently confirmed.)
  if (ctx.marketOpen) {
    let deskSpot: number | null = null;
    let gexSpot: number | null = null;
    try {
      const { loadMergedSpxDesk } = await import("@/lib/spx-desk-loader");
      const { merged } = await loadMergedSpxDesk();
      deskSpot = merged?.available && merged.price > 0 ? merged.price : null;
    } catch {
      deskSpot = null;
    }
    try {
      const pos = await getGexPositioning("SPX");
      gexSpot = pos && pos.spot > 0 ? pos.spot : null;
    } catch {
      gexSpot = null;
    }
    if (deskSpot != null && gexSpot != null) {
      const mid = (deskSpot + gexSpot) / 2;
      const pct = mid > 0 ? (Math.abs(deskSpot - gexSpot) / mid) * 100 : 0;
      const ok = pct <= 0.5; // same band data-integrity-checks uses for cross-tool spot
      checks.push(
        mk(
          "cross-tool",
          "hop_spot",
          ok ? "consistency-only" : "flag",
          ok
            ? `Pipeline hop reconciles: SPX desk spot ${deskSpot.toFixed(2)} == gex-positioning cache spot ${gexSpot.toFixed(2)} (${pct.toFixed(2)}% apart ≤ 0.5%) — both hops feed the website the same number.`
            : `Pipeline hop DIVERGES: SPX desk spot ${deskSpot.toFixed(2)} vs gex-positioning cache spot ${gexSpot.toFixed(2)} — ${pct.toFixed(2)}% apart (one hop is serving a stale/wrong value to the website).`,
          { id: "hop-spot-spx", expected: Number(deskSpot.toFixed(2)), actual: Number(gexSpot.toFixed(2)), tolerance: 0.5 }
        )
      );
    } else {
      checks.push(
        mk("cross-tool", "hop_spot", "skipped", `SPX spot hop not reconcilable this run (desk ${deskSpot != null ? "ok" : "cold"}, gex-cache ${gexSpot != null ? "ok" : "cold"}).`, {
          id: "hop-spot-spx",
        })
      );
    }
  } else {
    checks.push(mk("cross-tool", "hop_spot", "skipped", "Market closed — SPX spot pipeline-hop reconciliation not asserted.", { id: "hop-spot-spx" }));
  }

  // ── HOP B: latest-edition read vs served edition-by-date read (the website's edition path). ──
  // The Night Hawk page serves an edition via fetchNighthawkEditionByDate(edition_for); the latest is
  // fetchLatestNighthawkEdition. The SAME row read two ways must agree on its identity + payload size —
  // a mismatch means the by-date served path (what the website calls) can't reproduce the row the DB
  // actually holds (a DATE-cast/normalization break — the #77 "FOR INVALID DATE" class).
  {
    let latest = null as Awaited<ReturnType<typeof fetchLatestNighthawkEdition>>;
    try {
      latest = await fetchLatestNighthawkEdition();
    } catch {
      latest = null;
    }
    if (!latest) {
      checks.push(mk("cross-tool", "hop_edition", "skipped", "No published edition — edition pipeline-hop reconciliation not applicable.", { id: "hop-edition" }));
    } else {
      let served = null as Awaited<ReturnType<typeof fetchNighthawkEditionByDate>>;
      try {
        served = await fetchNighthawkEditionByDate(latest.edition_for);
      } catch {
        served = null;
      }
      if (!served) {
        checks.push(
          mk(
            "cross-tool",
            "hop_edition",
            "flag",
            `Latest edition is ${latest.edition_for} but the served by-date read (fetchNighthawkEditionByDate) returned NOTHING for that exact date — the website's edition path can't reproduce the row the DB holds (DATE-cast/normalization break).`,
            { id: "hop-edition", expected: latest.edition_for, actual: "null" }
          )
        );
      } else {
        const idMatch = served.edition_for === latest.edition_for;
        const playsMatch = (served.plays?.length ?? 0) === (latest.plays?.length ?? 0);
        const ok = idMatch && playsMatch;
        checks.push(
          mk(
            "cross-tool",
            "hop_edition",
            ok ? "consistency-only" : "flag",
            ok
              ? `Edition hop reconciles: latest (${latest.edition_for}, ${latest.plays?.length ?? 0} plays) == served-by-date read — the website serves the same edition row the DB holds.`
              : `Edition hop MISMATCH: latest ${latest.edition_for}/${latest.plays?.length ?? 0} plays vs served ${served.edition_for}/${served.plays?.length ?? 0} plays — the served path returns a different/incomplete row.`,
            { id: "hop-edition", expected: `${latest.edition_for}/${latest.plays?.length ?? 0}`, actual: `${served.edition_for}/${served.plays?.length ?? 0}` }
          )
        );
      }
    }
  }

  return checks;
}

// ───────────────────────────────────────────────────────────────────────────
// LAYER 4 — Writer-cron health (a dead WRITER ⇒ stale downstream PG/Redis data).
//
// Reuses buildCronHealthSnapshot (already a DB reader on this path; market-hours-aware +
// off-window suppression baked in). We FLAG only the CRITICAL writers that populate the
// data layer, and only on the loud states: a failed last run, or stale WHILE the market
// is open (the #90 silent-death case the snapshot already classifies as market_hours_stale).
// ───────────────────────────────────────────────────────────────────────────

/** The crons whose job is to WRITE the data layer (PG rows / Redis caches the website reads). */
const CRITICAL_WRITERS = new Set([
  "flow-ingest", // → flow_alerts (PG) + live feed
  "uw-cache-refresh", // → uw_cache:* (Redis)
  "nights-watch-warm", // → shared option-chain cache (Redis)
  "heatmap-warm", // → gex-heatmap:* (Redis)
  "nighthawk-playbook", // → nighthawk_editions (PG)
  "nighthawk-outcomes", // → nighthawk_play_outcomes (PG)
]);

async function checkWriters(_ctx: Ctx): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];
  if (!dbConfigured()) {
    return [mk("freshness", "writers", "skipped", "DATABASE_URL not configured — cron_job_runs writer-health not assertable.", { id: "writers-unconfigured" })];
  }

  let snapshot: Awaited<ReturnType<typeof buildCronHealthSnapshot>> | null = null;
  try {
    snapshot = await buildCronHealthSnapshot();
  } catch {
    snapshot = null;
  }
  if (!snapshot) {
    return [mk("freshness", "writers", "skipped", "Cron health snapshot unavailable this run — writer health not assertable.", { id: "writers-snapshot-failed" })];
  }

  if (snapshot.logged_runs_total === 0) {
    checks.push(
      mk(
        "freshness",
        "writers",
        "consistency-only",
        `No cron runs logged at all${snapshot.diagnostics_note ? ` — ${snapshot.diagnostics_note}` : ""}. Writer freshness can't be asserted (no baseline yet); not flagged (likely fresh deploy / unconfigured CRON_SECRET).`,
        { id: "writers-no-runs" }
      )
    );
    return checks;
  }

  for (const job of snapshot.jobs) {
    if (!CRITICAL_WRITERS.has(job.key)) continue;
    const metric = `writer_${job.key.replace(/-/g, "_")}`;

    // GROUND-TRUTH GUARD (live finding 2026-06-26): flag on the writer's actual TARGET freshness, not a
    // stale cron_job_runs HANDSHAKE row. The fire-and-forget nighthawk cron (#77 hardening D) can leave
    // an old `failed` handshake row in cron_job_runs from the pre-fire-and-forget await/timeout code,
    // even though tonight's edition PUBLISHED fine. buildCronHealthSnapshot already reconciles
    // nighthawk-playbook's status against the published nighthawk_job, but assert the target directly
    // here too so this check is correct independent of that module: if the writer's authoritative
    // target shows a fresh successful write, a `failed` handshake row is NOT a data-integrity failure.
    const targetFreshDespiteFailedHandshake = (() => {
      const nh = (job.meta?.nighthawk_job ?? null) as
        | { status?: string; published_at?: string | null; updated_at?: string | null }
        | null;
      if (!nh || nh.status !== "published") return false;
      const ts = nh.published_at ?? nh.updated_at ?? null;
      if (!ts) return false;
      const ageMin = (Date.now() - new Date(ts).getTime()) / 60_000;
      // Fresh within the writer's own staleness window — a recently published edition means the PG
      // target is current regardless of the handshake log.
      return Number.isFinite(ageMin) && ageMin <= job.effective_stale_min;
    })();

    // Loud states: failed last run, OR market-hours-stale (the snapshot's #90 in-RTH silent-death flag).
    if (job.status === "failed" && targetFreshDespiteFailedHandshake) {
      // Handshake row says failed but the writer's target published fresh — a stale-log artifact, not a
      // data outage. Record it as consistency-only so the scorecard stays accurate and loud-but-real.
      checks.push(
        mk(
          "freshness",
          metric,
          "consistency-only",
          `Writer "${job.name}" has a stale 'failed' cron handshake row, but its target is FRESH (${job.status_label}) — the edition published on schedule. Treated as a logging artifact (fire-and-forget cron), not a data-integrity failure.`,
          { id: `writer-${job.key}`, actual: "published-fresh" }
        )
      );
    } else if (job.status === "failed") {
      checks.push(
        mk(
          "freshness",
          metric,
          "flag",
          `Critical writer "${job.name}" last run FAILED (${job.status_label}) — it is not populating its PG/Redis target, so the downstream data is going stale.`,
          { id: `writer-${job.key}`, actual: "failed" }
        )
      );
    } else if (job.market_hours_stale) {
      checks.push(
        mk(
          "freshness",
          metric,
          "flag",
          `Critical writer "${job.name}" is STALE during RTH (${job.status_label}, ${job.age_min ?? "?"}m old) — a live-data writer has silently died; its PG/Redis target is no longer refreshed.`,
          { id: `writer-${job.key}`, actual: job.age_min ?? null, tolerance: job.effective_stale_min }
        )
      );
    } else if (job.status === "stale") {
      // Stale OUTSIDE its window (or a non-market-hours writer past cadence) — note but don't scream.
      checks.push(
        mk(
          "freshness",
          metric,
          "consistency-only",
          `Writer "${job.name}" is stale (${job.status_label}) but off its active window — its target is expected-quiet right now (not a live-data outage).`,
          { id: `writer-${job.key}` }
        )
      );
    } else if (job.status === "unknown") {
      checks.push(
        mk("freshness", metric, "skipped", `Writer "${job.name}" has no runs logged yet — health not assertable (likely fresh deploy).`, {
          id: `writer-${job.key}`,
        })
      );
    } else {
      // healthy / warning → the writer is alive and populating its target.
      checks.push(
        mk(
          "freshness",
          metric,
          "pass",
          `Critical writer "${job.name}" is alive (${job.status_label}${job.age_min != null ? `, last run ${job.age_min}m ago` : ""}) — its PG/Redis target is being populated.`,
          { id: `writer-${job.key}`, actual: job.age_min ?? null }
        )
      );
    }
  }

  // If none of the critical writers were present in the registry snapshot, say so honestly.
  if (checks.length === 0) {
    checks.push(mk("freshness", "writers", "skipped", "No critical writer crons present in the snapshot — nothing to assert.", { id: "writers-none" }));
  }

  return checks;
}

/**
 * Verify the DATA LAYER + PIPELINE INTEGRITY (Postgres + Redis + hop reconciliation + writer health).
 * Returns a TickerScore under the synthetic "DATALAYER" ticker on the shared scorecard schema. Never
 * throws — each layer is internally defensive and degrades a failure to a skip, never a false flag.
 */
export async function verifyDataIntegrity(marketOpen: boolean): Promise<TickerScore> {
  if (!enabled()) {
    const skip = mk("freshness", "data_integrity", "skipped", "Data-integrity surface disabled (CORRECTNESS_DATA_INTEGRITY=0).", { id: "disabled" });
    return { ticker: TICKER, status: "skipped", metrics: groupMetrics([skip]) };
  }

  const ctx: Ctx = { now: Date.now(), marketOpen, rth: inMarketHoursEt() };

  const checks: CheckResult[] = [];
  // Each layer is independently defensive; collect all so one layer can't abort the others.
  for (const layer of [checkPostgres, checkRedis, checkPipelineHops, checkWriters]) {
    try {
      checks.push(...(await layer(ctx)));
    } catch (err) {
      checks.push(
        mk("invariant", "data_integrity", "skipped", `A data-integrity layer threw: ${err instanceof Error ? err.message : String(err)} — skipped, not flagged.`, {
          id: `layer-threw-${layer.name}`,
        })
      );
    }
  }

  const metrics = groupMetrics(checks);
  return { ticker: TICKER, status: worstStatus(metrics.map((m) => m.status)), metrics };
}

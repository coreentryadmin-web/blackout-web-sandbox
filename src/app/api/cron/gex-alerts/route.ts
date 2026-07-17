// Cron: evaluate the BlackOut Heat Maps for MAJOR market-regime gamma events and (when activated)
// broadcast them as web-push ALERTS. This is the heatmap-owned web-push evaluator.
//
// INERT BY DEFAULT — ships safe. It does NOTHING (returns `{ ok: true, inert: true }`) unless BOTH:
//   1) `process.env.GEX_ALERTS_PUSH` is "1"/"true" (the activation flag), AND
//   2) `vapidConfigured()` (VAPID keys are set — same gate the push scaffold uses).
// So no push is ever sent until the platform deliberately turns it on (see the follow-ups in
// HEATMAP_DATA_CONTRACT.md → "Alerts"). The optional `web-push` package + the `push_subscriptions`
// DB are enforced one layer deeper inside `sendWebPush` (it stays inert without them).
//
// CACHE-READER: for each watchlist ticker it reads the SHARED cached GEX matrix via
// `fetchGexHeatmap(ticker)` and consumes the server-computed `events[]` it already produced (a pure
// diff of the current sample vs the prior history snapshot — NO new upstream chain fetch here, and
// the events are NOT recomputed). Dedup is a cheap Redis read/write via sharedCacheGet/Set.
//
// DEDUP: a given regime cross alerts ONCE per ET-date (keyed `gex-alert-sent:{ticker}:{type}:{etDate}`,
// and bucketed by level where a level is present), not on every 5-minute cron tick.
//
// SCHEDULE (infra-owned — DO NOT edit EventBridge schedule in blackout-infra from here): run ~every 5 minutes during market
// hours on trading days. Per the project's cron convention the schedule REGISTRATION needs a
// per-service `EventBridge rule (blackout-infra/cron-jobs.json)` + a `scripts/hit-cron.mjs` entry hitting `/api/cron/gex-alerts`
// with `Authorization: Bearer ${CRON_SECRET}` (the Bearer pattern this route authenticates with).
// Registering that schedule is infra-owned and intentionally NOT done here. The route also works
// on-demand via a manual Bearer call, so it is useful before the schedule lands.

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { fetchGexHeatmap, type GexEvent } from "@/lib/providers/polygon-options-gex";
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import { sendWebPush, vapidConfigured } from "@/lib/push/send-web-push";
import { logCronRun } from "@/lib/cron-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** TTL on a dedup key — ~1 day so a cross alerts ONCE per ET-date, then is free to fire next day. */
const ALERT_DEDUP_TTL_SEC = 24 * 60 * 60;

/**
 * MAJOR market-regime tickers only. These are broadcast-worthy "market gamma regime" alerts — the
 * whole-market posture every subscriber cares about — NOT single-name noise. (Per-ticker per-user
 * subscriptions are a documented platform follow-up; until then alerts go to all subscribers.)
 */
const REGIME_WATCHLIST = ["SPY", "SPX", "QQQ"] as const;

/**
 * Regime-level event types that warrant a broadcast push. `wall_broken` is only regime-worthy for
 * the broad index proxies (SPY/SPX) — a single equity wall breaking is too noisy to broadcast.
 */
const REGIME_EVENT_TYPES = new Set<GexEvent["type"]>([
  "flip_crossed",
  "regime_flipped",
  "net_gex_sign_flipped",
]);
const WALL_BROKEN_TICKERS = new Set<string>(["SPY", "SPX"]);

/** Human label for an event type, used as the push title suffix. */
function eventLabel(type: GexEvent["type"]): string {
  switch (type) {
    case "flip_crossed":
      return "gamma flip crossed";
    case "wall_broken":
      return "wall broken";
    case "regime_flipped":
      return "regime flipped";
    case "net_gex_sign_flipped":
      return "net GEX sign flipped";
    default:
      return "gamma alert";
  }
}

/** Current ET calendar date (YYYY-MM-DD) for per-day dedup keys. */
function etDate(): string {
  // en-CA yields ISO-style YYYY-MM-DD; America/New_York covers the trading session.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Is this event regime-worthy for this ticker? */
function isRegimeEvent(ticker: string, ev: GexEvent): boolean {
  if (REGIME_EVENT_TYPES.has(ev.type)) return true;
  if (ev.type === "wall_broken" && WALL_BROKEN_TICKERS.has(ticker)) return true;
  return false;
}

/**
 * Dedup key for an event. Includes a LEVEL bucket where a level is present so a flip that drifts to
 * a new strike can re-alert, while a flip pinned at one level won't re-fire all day. Levels are
 * rounded to whole points to absorb micro-jitter in the interpolated flip strike.
 */
function dedupKey(ticker: string, ev: GexEvent, day: string): string {
  const lvl = ev.level != null && Number.isFinite(ev.level) ? `:${Math.round(ev.level)}` : "";
  return `gex-alert-sent:${ticker}:${ev.type}:${day}${lvl}`;
}

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // INERT-by-default gate: ship safe. Do nothing unless explicitly activated AND VAPID is set.
  const activated =
    (process.env.GEX_ALERTS_PUSH === "1" || process.env.GEX_ALERTS_PUSH === "true") &&
    vapidConfigured();
  if (!activated) {
    await logCronRun("gex-alerts", started, { ok: true, skipped: true, reason: "inert (GEX_ALERTS_PUSH + VAPID)" });
    return NextResponse.json({ ok: true, inert: true });
  }

  const day = etDate();
  const evaluated: string[] = [];
  const alerted: Array<{ ticker: string; type: GexEvent["type"]; sent: number }> = [];

  // Best-effort PER TICKER: one ticker's failure (rejected fetch, null matrix) never aborts the rest,
  // and a single bad event never aborts the ticker. Cache-reader only — no new upstream here.
  for (const ticker of REGIME_WATCHLIST) {
    try {
      const heatmap = await fetchGexHeatmap(ticker);
      evaluated.push(ticker);
      // `events` is omitted on cold history (<2 snapshots) and [] when nothing crossed — both no-op.
      const events = heatmap?.events ?? [];
      if (!events.length) continue;

      for (const ev of events) {
        if (!isRegimeEvent(ticker, ev)) continue;

        const key = dedupKey(ticker, ev, day);
        try {
          // Dedup: already alerted for this ticker:type:date(:level) today → skip (don't re-fire).
          const already = await sharedCacheGet<{ at: string }>(key);
          if (already) continue;

          const result = await sendWebPush(
            {
              title: `${ticker} ${eventLabel(ev.type)}`,
              body: ev.message,
              url: `/heatmap?ticker=${ticker}`,
            },
            {} // broadcast to all subscribers (per-ticker user prefs are a documented follow-up)
          );

          // Record the send so this cross won't re-alert on the next 5-min tick. Mark even when
          // `sent === 0` (no subscribers yet) — the cross HAS been evaluated for today.
          await sharedCacheSet(key, { at: ev.at }, ALERT_DEDUP_TTL_SEC);
          alerted.push({ ticker, type: ev.type, sent: result.sent });
        } catch {
          // A single event's dedup/send failure must not abort the remaining events/tickers.
        }
      }
    } catch {
      // Per-ticker isolation — never throw out of the loop.
    }
  }

  await logCronRun("gex-alerts", started, {
    ok: true,
    evaluated_count: evaluated.length,
    alerted_count: alerted.length,
    alerted,
  });
  return NextResponse.json({ ok: true, evaluated, alerted, inert: false });
}

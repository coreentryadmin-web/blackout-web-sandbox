// Durable Postgres log of BlackOut Thermal's GEX regime/flip/wall-crossing events
// (task #136) — the durable-history analogue of task #108's spx_engine_snapshots
// and task #147's zerodte_scan_rejections, applied to computeGexEvents()'
// (./polygon-options-gex.ts) intraday regime-transition stream.
//
// GAP THIS CLOSES: computeGexEvents() already detects flip/wall/regime crossings
// on every fresh GEX matrix compute (cache miss) — a pure diff of the current
// sample vs. the latest positioning-history snapshot — but until now that array
// only ever lived in two EPHEMERAL places: the shared, TTL-capped
// `gex-heatmap:{ticker}` matrix cache (heatmap.events, gone once the cache
// entry expires/refreshes) and the `gex-history:{ticker}` ring itself (capped at
// GEX_HISTORY_MAX ~24 samples / ~2h, GEX_HISTORY_TTL_SEC ~3h). /api/cron/
// gex-alerts/route.ts reads the SAME events array to fire live push alerts, but
// only ever persists a Redis DEDUP key on fire (`gex-alert-sent:{ticker}:
// {type}:{etDate}[:level]`) — proof a push WAS sent, never the event's own
// before/after values — and only for its own 3-ticker REGIME_WATCHLIST
// (SPY/SPX/QQQ) plus the subset of event types it treats as broadcast-worthy.
// So "at time T, SPY's gamma flip crossed" or "how many times has NVDA's call
// wall broken today" was unanswerable after the fact for ANY ticker, and
// unanswerable at ALL once the ring/cache/dedup keys rotated even for the 3
// watchlist names.
//
// ONE DERIVATION, NOT TWO: this module never recomputes an event. Every call
// site passes in the EXACT GexEvent[] array computeGexEvents() already produced
// — the same array /api/cron/gex-alerts reads off heatmap.events. No new
// detection logic, no new threshold, no new alert-firing condition; this is
// purely an additional, independent PERSISTENCE of output that already exists.
//
// THROTTLING: computeGexEvents() is a raw diff (current sample vs. the latest
// ring entry) — a real crossing can appear in that diff on EVERY fresh matrix
// compute until the ring's own ~5-min sample throttle (appendGexHistory, same
// file) finally advances the baseline past it, exactly the reason gex-alerts
// needs its OWN Redis dedup to avoid re-pushing the same cross repeatedly. This
// module needs the identical protection for durable writes, via a state-
// transition cursor — but DELIBERATELY INDEPENDENT of gex-alerts' dedup:
// different storage (Postgres platform_meta vs. Redis), different key
// namespace, and different throttle semantics (this persists EVERY DISTINCT
// transition all session long — "how many times has the wall moved today"
// requires that — vs. gex-alerts' once-per-ET-date-per-type dedup). Neither
// path reads or writes the other's keys, so a durable-history write can never
// suppress a live push and a live-push dedup can never suppress a durable row —
// verified in gex-regime-events.test.ts.
import { dbConfigured, getMeta, setMeta, insertGexRegimeEvent, fetchGexRegimeEventRows } from "@/lib/db";
import { todayEtYmd } from "./spx-session";

const GEX_REGIME_EVENT_CURSOR_KEY = "gex_regime_event_cursor";

/**
 * Narrow, duck-typed input — deliberately NOT importing GexEvent from
 * ./polygon-options-gex. Keeps this lightweight module (only @/lib/db +
 * ./spx-session) decoupled from that file's much larger type surface/import
 * graph, the same reasoning src/lib/zerodte/rejections.ts gives for not
 * importing ./board's types directly. Every field here is one computeGexEvents()
 * already puts on every GexEvent (plus the additive from_value/to_value pair —
 * see polygon-options-gex.ts's GexEvent doc comment).
 */
export type GexRegimeEventInput = {
  type: "flip_crossed" | "wall_broken" | "regime_flipped" | "net_gex_sign_flipped";
  severity: "info" | "warn";
  message: string;
  level?: number | null;
  direction?: string | null;
  from_value?: number | null;
  to_value?: number | null;
  at: string;
};

type CursorEntry = { date: string; key: string };

/**
 * State-transition signature for the per-(ticker, event slot) throttle —
 * rounded level (same whole-point rounding gex-alerts' own dedupKey uses, so
 * micro-jitter in an interpolated flip/wall strike doesn't look like a new
 * state) + direction. Deliberately excludes message/severity/from_value/
 * to_value — display/context fields that don't represent a NEW state, same
 * reasoning signalKey()/engineSnapshotStateKey() give for excluding
 * score/thesis/headline in the SPX precedents.
 */
function eventStateKey(ev: Pick<GexRegimeEventInput, "level" | "direction">): string {
  const lvl = ev.level != null && Number.isFinite(ev.level) ? Math.round(ev.level) : null;
  return JSON.stringify({ level: lvl, direction: ev.direction ?? null });
}

/**
 * Cursor slot — type+direction, not the bare type, so (for example) a call-wall
 * break and a put-wall break landing in the SAME diff get independent throttle
 * slots instead of colliding on the shared "wall_broken" type.
 */
function cursorSlot(ticker: string, ev: Pick<GexRegimeEventInput, "type" | "direction">): string {
  return `${ticker}|${ev.type}:${ev.direction ?? ""}`;
}

/**
 * Loads the cursor map, pruned to TODAY's date — mirrors
 * src/lib/zerodte/rejections.ts's loadRejectionCursor exactly: an entry from a
 * prior session date is dropped (not carried forward), so a new day's first
 * occurrence of a transition always logs rather than being silently suppressed
 * by yesterday's leftover state.
 */
async function loadCursor(today: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const raw = await getMeta(GEX_REGIME_EVENT_CURSOR_KEY);
  if (!raw) return map;
  try {
    const parsed = JSON.parse(raw) as Record<string, CursorEntry>;
    for (const [slot, entry] of Object.entries(parsed)) {
      if (entry && entry.date === today && typeof entry.key === "string") {
        map.set(slot, entry.key);
      }
    }
  } catch {
    // Corrupt/legacy value — treat as empty; the next save overwrites it cleanly.
  }
  return map;
}

async function saveCursor(today: string, map: Map<string, string>): Promise<void> {
  const obj: Record<string, CursorEntry> = {};
  for (const [slot, key] of map.entries()) obj[slot] = { date: today, key };
  await setMeta(GEX_REGIME_EVENT_CURSOR_KEY, JSON.stringify(obj));
}

/**
 * Persist this sample's regime-transition events — throttled to one row per
 * (ticker, event type+direction) DISTINCT state, not one row per matrix
 * compute. Called from fetchGexHeatmap (./polygon-options-gex.ts) immediately
 * after computeGexEvents() produces `events`, fire-and-forget (never awaited by
 * the matrix build — see that file's call site) so a slow/unavailable Postgres
 * can never add latency to the live heatmap response. Best-effort: never throws
 * into the caller.
 */
export async function persistGexRegimeEvents(
  ticker: string,
  events: GexRegimeEventInput[]
): Promise<number> {
  if (!dbConfigured() || events.length === 0) return 0;
  const today = todayEtYmd();
  const cursor = await loadCursor(today);

  const toWrite: GexRegimeEventInput[] = [];
  for (const ev of events) {
    const slot = cursorSlot(ticker, ev);
    const key = eventStateKey(ev);
    if (cursor.get(slot) === key) continue;
    cursor.set(slot, key);
    toWrite.push(ev);
  }
  if (toWrite.length === 0) return 0;

  // Sequential, not batched — a single sample's event count is bounded (at most
  // one per computeGexEvents() push site, currently ≤4), so a multi-row round
  // trip isn't worth the dynamic-SQL complexity (mirrors
  // insertZeroDteScanRejection's own one-row-at-a-time idiom).
  for (const ev of toWrite) {
    await insertGexRegimeEvent({
      session_date: today,
      ticker,
      event_type: ev.type,
      severity: ev.severity,
      message: ev.message,
      level: ev.level ?? null,
      direction: ev.direction ?? null,
      from_value: ev.from_value ?? null,
      to_value: ev.to_value ?? null,
      detected_at: ev.at,
    });
  }
  await saveCursor(today, cursor);
  return toWrite.length;
}

export type GexRegimeEventRow = {
  id: number;
  observed_at: string;
  session_date: string;
  ticker: string;
  event_type: string;
  severity: string;
  message: string;
  level: number | null;
  direction: string | null;
  from_value: number | null;
  to_value: number | null;
  detected_at: string | null;
};

/**
 * Read path shared by the Largo tool below (and any future admin surface):
 * "when did SPY's flip last cross" / "how many times has NVDA's wall moved
 * today." Empty array (not a throw) when the DB isn't configured.
 */
export async function fetchGexRegimeEvents(opts?: {
  ticker?: string;
  limit?: number;
}): Promise<GexRegimeEventRow[]> {
  if (!dbConfigured()) return [];
  return fetchGexRegimeEventRows(opts);
}

/**
 * Largo tool payload (get_gex_regime_events, run-tool.ts) — same `available`
 * envelope idiom zeroDteRejectionsForLargo() uses for the analogous
 * near-miss/history log.
 */
export async function gexRegimeEventsForLargo(
  ticker?: string,
  limit = 20
): Promise<Record<string, unknown>> {
  const rows = await fetchGexRegimeEvents({ ticker, limit });
  if (rows.length === 0) {
    return {
      available: false,
      note: ticker
        ? `no GEX regime-transition history found for ${ticker.toUpperCase()} today`
        : "no GEX regime-transition events logged yet this session",
    };
  }
  return {
    available: true,
    source:
      "BlackOut Thermal regime-transition log (gex_regime_events) — durable history of flip/wall/regime crossings, independent of the live gex-alerts push dedup",
    ticker: ticker ? ticker.toUpperCase() : null,
    events: rows.map((r) => ({
      ticker: r.ticker,
      observed_at: r.observed_at,
      detected_at: r.detected_at,
      event_type: r.event_type,
      severity: r.severity,
      message: r.message,
      level: r.level,
      direction: r.direction,
      from_value: r.from_value,
      to_value: r.to_value,
    })),
  };
}

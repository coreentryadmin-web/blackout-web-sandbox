import { dbQuery, dbConfigured } from "@/lib/db";
import { todayEtYmd } from "@/lib/providers/spx-session";

// BIE ecosystem-context query layer, v1 — "what does the rest of BlackOut
// currently know about this ticker." Every instrument already writes its own
// state into shared Postgres (zerodte_setup_log, nighthawk_play_outcomes,
// alert_audit_log); the gap was never the data, it was that nothing let one
// instrument ask what another one already found. This is that query layer.
//
// Deliberately additive, never a hard dependency: a caller that doesn't get a
// useful answer here should proceed exactly as it did before this existed —
// same fail-open-to-empty pattern as every other BIE probe. This is NOT a
// message bus and does not make any instrument depend on another one being up;
// it only reads rows that already exist.

export type EcosystemZeroDteTake = {
  session_date: string;
  direction: string;
  score: number;
  conviction: string | null;
  status: string | null;
  first_flagged_at: string;
};

export type EcosystemNightHawkTake = {
  edition_for: string;
  direction: string;
  conviction: string;
  outcome: string;
  score: number | null;
};

export type EcosystemAuditEntry = {
  alert_type: string;
  fired_at: string;
  confidence_label: string | null;
  trigger_reason: string | null;
  outcome: string | null;
};

/**
 * Recent HELIX flow on this ticker, reported neutrally as call/put premium
 * totals rather than a single "bullish/bearish" label. flow_alerts has no
 * direction column, and this codebase has an explicit prior rule (see the
 * "TRUTH MANDATE" comment in parseUwFlowAlert, unusual-whales.ts) against
 * ever defaulting an unparseable option side to a fabricated bias — an
 * UNKNOWN-side print stays in unknown_premium, never folded into either side.
 */
export type EcosystemFlowSummary = {
  window_hours: number;
  print_count: number;
  call_premium: number;
  put_premium: number;
  unknown_premium: number;
};

/**
 * Pattern-detected flow anomalies on this ticker (CONCENTRATION,
 * COORDINATED_SWEEP, PREMIUM_SPIKE, PUT_SURGE) from flow_anomalies — written
 * every 30min by the market-regime-detector cron, which already dedups by
 * (anomaly_type, ticker) within a 15-minute window at write time. Distinct
 * signal from recent_flow: that's a raw premium aggregate, this is "the
 * regime detector specifically flagged a pattern here." Already read by
 * Night Hawk's own platform-intel snapshot and the member-facing
 * /api/market/anomalies feed — this is a THIRD consumer, not a new writer.
 */
export type EcosystemAnomaly = {
  anomaly_type: string;
  detected_at: string;
  detail: string;
  severity: string;
  direction: string | null;
};

export type EcosystemContext = {
  ticker: string;
  zerodte_today: EcosystemZeroDteTake | null;
  nighthawk_recent: EcosystemNightHawkTake | null;
  recent_audit_entries: EcosystemAuditEntry[];
  recent_flow: EcosystemFlowSummary | null;
  recent_anomalies: EcosystemAnomaly[];
};

function emptyContext(ticker: string): EcosystemContext {
  return {
    ticker: ticker.toUpperCase(),
    zerodte_today: null,
    nighthawk_recent: null,
    recent_audit_entries: [],
    recent_flow: null,
    recent_anomalies: [],
  };
}

const FLOW_SUMMARY_WINDOW_HOURS = 6;
const ANOMALY_WINDOW_HOURS = 24;

/**
 * Assembles a single ticker's cross-instrument snapshot from tables that
 * already exist: today's 0DTE Command take (if any), the most recent
 * PUBLISHED Night Hawk take from nighthawk_play_outcomes (a play rejected at
 * the trade-geometry gate is never written to that table — see
 * buildNighthawkRejectedAuditRow's doc comment in play-outcomes.ts — so a
 * rejection shows up only in recent_audit_entries below, as an
 * "nighthawk_rejected" alert_type, never here), the last 10
 * alert_audit_log entries (the unified Stage 4 trail, which already spans all
 * three write-paths), a same-day HELIX flow summary straight from
 * flow_alerts — not just the $1M+ whale tier that reaches alert_audit_log, the
 * full tape for this one ticker — and any pattern-detected flow anomalies
 * (flow_anomalies, written by the market-regime-detector cron). Fails open to
 * an all-empty context on any error — a lookup failure here must never block
 * the caller's own logic.
 */
export async function fetchEcosystemContext(ticker: string): Promise<EcosystemContext> {
  if (!dbConfigured() || !ticker.trim()) return emptyContext(ticker);
  const upper = ticker.toUpperCase().trim();

  try {
    const [zerodteRes, nighthawkRes, auditRes, flowRes, anomalyRes] = await Promise.all([
      dbQuery<{
        session_date: string;
        direction: string;
        score: number;
        conviction: string | null;
        status: string | null;
        first_flagged_at: string;
      }>(
        `SELECT session_date, direction, score, conviction, status, first_flagged_at
         FROM zerodte_setup_log
         WHERE ticker = $1 AND session_date = $2`,
        [upper, todayEtYmd()]
      ),
      dbQuery<{
        edition_for: string;
        direction: string;
        conviction: string;
        outcome: string;
        score: number | null;
      }>(
        `SELECT edition_for, direction, conviction, outcome, score
         FROM nighthawk_play_outcomes
         WHERE ticker = $1
         ORDER BY edition_for DESC
         LIMIT 1`,
        [upper]
      ),
      dbQuery<{
        alert_type: string;
        fired_at: string;
        confidence_label: string | null;
        trigger_reason: string | null;
        outcome: string | null;
      }>(
        `SELECT alert_type, fired_at, confidence_label, trigger_reason, outcome
         FROM alert_audit_log
         WHERE ticker = $1
         ORDER BY fired_at DESC
         LIMIT 10`,
        [upper]
      ),
      dbQuery<{ print_count: number; call_premium: number; put_premium: number; unknown_premium: number }>(
        `SELECT
           COUNT(*)::int AS print_count,
           COALESCE(SUM(total_premium) FILTER (WHERE option_type = 'CALL'), 0)::numeric AS call_premium,
           COALESCE(SUM(total_premium) FILTER (WHERE option_type = 'PUT'), 0)::numeric AS put_premium,
           COALESCE(SUM(total_premium) FILTER (WHERE option_type NOT IN ('CALL', 'PUT')), 0)::numeric AS unknown_premium
         FROM flow_alerts
         WHERE ticker = $1 AND created_at >= NOW() - ($2 || ' hours')::interval`,
        [upper, FLOW_SUMMARY_WINDOW_HOURS]
      ),
      dbQuery<{ anomaly_type: string; detected_at: string; detail: string; severity: string; direction: string | null }>(
        `SELECT anomaly_type, detected_at, detail, severity, direction
         FROM flow_anomalies
         WHERE ticker = $1 AND detected_at >= NOW() - ($2 || ' hours')::interval
         ORDER BY detected_at DESC
         LIMIT 5`,
        [upper, ANOMALY_WINDOW_HOURS]
      ),
    ]);

    const z = zerodteRes.rows[0];
    const n = nighthawkRes.rows[0];
    const f = flowRes.rows[0];

    return {
      ticker: upper,
      zerodte_today: z
        ? {
            session_date: String(z.session_date),
            direction: z.direction,
            score: Number(z.score),
            conviction: z.conviction,
            status: z.status,
            first_flagged_at: String(z.first_flagged_at),
          }
        : null,
      nighthawk_recent: n
        ? {
            edition_for: String(n.edition_for),
            direction: n.direction,
            conviction: n.conviction,
            outcome: n.outcome,
            score: n.score != null ? Number(n.score) : null,
          }
        : null,
      recent_audit_entries: auditRes.rows.map((r) => ({
        alert_type: r.alert_type,
        fired_at: String(r.fired_at),
        confidence_label: r.confidence_label,
        trigger_reason: r.trigger_reason,
        outcome: r.outcome,
      })),
      recent_flow:
        f && f.print_count > 0
          ? {
              window_hours: FLOW_SUMMARY_WINDOW_HOURS,
              print_count: Number(f.print_count),
              call_premium: Number(f.call_premium),
              put_premium: Number(f.put_premium),
              unknown_premium: Number(f.unknown_premium),
            }
          : null,
      recent_anomalies: anomalyRes.rows.map((a) => ({
        anomaly_type: a.anomaly_type,
        detected_at: String(a.detected_at),
        detail: a.detail,
        severity: a.severity,
        direction: a.direction,
      })),
    };
  } catch {
    return emptyContext(ticker);
  }
}

// --- Batched Night Hawk echo for a ticker list (board-annotation use case) --

export type EcosystemNighthawkEchoRow = {
  ticker: string;
  edition_for: string;
  direction: string;
  conviction: string;
  outcome: string;
  score: number | null;
};

/** Pure: raw DISTINCT-ON rows -> ticker -> most-recent-take map. Split out from
 *  the query so the shape logic is unit-testable without a DB connection. */
export function mapNighthawkEchoRows(rows: EcosystemNighthawkEchoRow[]): Map<string, EcosystemNightHawkTake> {
  const out = new Map<string, EcosystemNightHawkTake>();
  for (const r of rows) {
    out.set(r.ticker.toUpperCase(), {
      edition_for: String(r.edition_for),
      direction: r.direction,
      conviction: r.conviction,
      outcome: r.outcome,
      score: r.score != null ? Number(r.score) : null,
    });
  }
  return out;
}

/**
 * One batched query for a whole ticker list — the board-annotation use case
 * (e.g. "does the 0DTE ledger have any names Night Hawk already picked?").
 * Deliberately a single ANY($1) query instead of one fetchEcosystemContext()
 * call per ticker: a board can carry a couple dozen ledger rows and this runs
 * on every poll, so N sequential/parallel per-ticker round trips would scale
 * query count with ledger size for no benefit — one query returns the same
 * answer for every ticker at once. Fails open to an empty map: a caller must
 * render exactly as it did before this existed if the lookup fails.
 */
export async function fetchNighthawkEchoForTickers(tickers: string[]): Promise<Map<string, EcosystemNightHawkTake>> {
  const upperTickers = [...new Set(tickers.map((t) => t.toUpperCase().trim()).filter(Boolean))];
  if (!dbConfigured() || upperTickers.length === 0) return new Map();

  try {
    const res = await dbQuery<EcosystemNighthawkEchoRow>(
      `SELECT DISTINCT ON (ticker) ticker, edition_for, direction, conviction, outcome, score
       FROM nighthawk_play_outcomes
       WHERE ticker = ANY($1::text[])
       ORDER BY ticker, edition_for DESC`,
      [upperTickers]
    );
    return mapNighthawkEchoRows(res.rows);
  } catch {
    return new Map();
  }
}

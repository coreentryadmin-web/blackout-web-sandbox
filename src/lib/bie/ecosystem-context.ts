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

export type EcosystemContext = {
  ticker: string;
  zerodte_today: EcosystemZeroDteTake | null;
  nighthawk_recent: EcosystemNightHawkTake | null;
  recent_audit_entries: EcosystemAuditEntry[];
};

function emptyContext(ticker: string): EcosystemContext {
  return { ticker: ticker.toUpperCase(), zerodte_today: null, nighthawk_recent: null, recent_audit_entries: [] };
}

/**
 * Assembles a single ticker's cross-instrument snapshot from tables that
 * already exist: today's 0DTE Command take (if any), the most recent Night
 * Hawk take (published or rejected outcome, whichever is newest), and the
 * last 10 alert_audit_log entries (the unified Stage 4 trail, which already
 * spans all three write-paths). Fails open to an all-empty context on any
 * error — a lookup failure here must never block the caller's own logic.
 */
export async function fetchEcosystemContext(ticker: string): Promise<EcosystemContext> {
  if (!dbConfigured() || !ticker.trim()) return emptyContext(ticker);
  const upper = ticker.toUpperCase().trim();

  try {
    const [zerodteRes, nighthawkRes, auditRes] = await Promise.all([
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
    ]);

    const z = zerodteRes.rows[0];
    const n = nighthawkRes.rows[0];

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

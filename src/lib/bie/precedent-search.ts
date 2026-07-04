// BLACKOUT Intelligence Engine — semantic precedent search over alert_audit_log.
//
// The gap this closes: BIE's L2 knowledge layer (embeddings + cosine search)
// has existed since Phase 2, but until now it only ever indexed prose — docs,
// findings, editions. It never touched the platform's own structured trading
// history in alert_audit_log, so "has a setup like this happened before, and
// what happened" was a question nothing on the platform could answer; a member
// or Largo could only filter alert_audit_log by exact ticker/date, never ask
// "find me the alerts that most resemble this situation."
//
// This module turns each RESOLVED alert into one short natural-language
// description (deterministic — no LLM writes it) and embeds it into the same
// bie_knowledge store under kind "precedent". Retrieval is then just another
// searchKnowledge() call scoped to that kind. Strictly read-only and additive:
// no write-path here ever touches alert_audit_log itself, scoring, or gating —
// it only describes rows that already exist and answers questions about them.

import { fetchResolvedAlertAuditRows, type AlertAuditTrailRow } from "@/lib/db";
import { storeKnowledge, searchKnowledge, DEFAULT_MIN_SIMILARITY, type RetrievedChunk } from "./knowledge";

const ALERT_TYPE_LABEL: Record<string, string> = {
  zerodte: "0DTE Command",
  nighthawk: "Night Hawk",
  nighthawk_rejected: "Night Hawk (rejected at the publish gate)",
};

/**
 * Pure: one alert_audit_log row -> one short, natural-language precedent
 * description. Deliberately template-based, not LLM-generated — every word
 * traces directly to a column on the row, so this can never fabricate a
 * detail the row didn't actually have. Split out from the ingestion loop so
 * the exact wording is unit-testable without a DB connection.
 */
export function describeAuditRow(row: AlertAuditTrailRow): string {
  const kind = ALERT_TYPE_LABEL[row.alert_type] ?? row.alert_type;
  const direction = row.direction ? row.direction : "no stated direction";
  const conviction = row.confidence_label ? `, ${row.confidence_label} conviction` : "";
  const score = row.confidence_score != null ? ` (score ${row.confidence_score})` : "";
  const reason = row.trigger_reason ? ` — fired because ${row.trigger_reason}` : "";
  const outcome = row.outcome ? `Outcome: ${row.outcome}.` : "Outcome: not yet graded.";
  return `${kind} alert on ${row.ticker}, ${direction}${conviction}${score}${reason}. ${outcome}`;
}

/**
 * Ingest every resolved alert from the last `days` days as a precedent chunk.
 * Idempotent like every other ingestion in this codebase: storeKnowledge
 * hash-dedups on (kind, source, chunk), so re-running this nightly over the
 * same rows costs nothing once a row's description text stops changing (i.e.
 * once it's graded — this only reads terminal outcomes in the first place, so
 * each alert's description is written at most once in the normal case).
 * Fails open to {stored: 0} — a lookup/embedding failure here must never
 * block the rest of the nightly ingestion.
 */
export async function ingestAlertPrecedents(days = 60): Promise<{ stored: number }> {
  try {
    const rows = await fetchResolvedAlertAuditRows(days);
    let stored = 0;
    for (const row of rows) {
      stored += await storeKnowledge("precedent", `alert_audit:${row.id}`, describeAuditRow(row));
    }
    return { stored };
  } catch {
    return { stored: 0 };
  }
}

/**
 * "Has this happened before, what happened" — cosine search scoped to
 * kind="precedent" only, so results never mix in doc/finding prose. `query`
 * should describe the CURRENT situation in the same register the descriptions
 * above use (e.g. "NVDA 0DTE long setup, high conviction, aggression spike")
 * — Largo's tool-calling model composes this, not the member directly.
 */
export async function findSimilarPrecedents(query: string, k = 5): Promise<RetrievedChunk[]> {
  return searchKnowledge(query, k, DEFAULT_MIN_SIMILARITY, "precedent");
}

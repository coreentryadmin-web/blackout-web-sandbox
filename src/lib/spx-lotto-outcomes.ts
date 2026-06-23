import { dbConfigured, fetchLottoPlaysForDate, insertLottoPlay, updateLottoPlay } from "@/lib/db";
import type { LottoRecord } from "@/lib/spx-lotto-store";
import { todayEtYmd } from "@/lib/providers/spx-session";

const memoryIds = new Map<string, number>();
// Tracks the ET session-date for which memoryIds was last rehydrated from the DB.
// Scoping the guard per-date (instead of a process-global boolean) lets a new
// session re-rehydrate after a date roll, while staying idempotent within a session.
let rehydratedForDate: string | null = null;

function rowKey(rec: LottoRecord): string {
  return `${rec.session_date}:${rec.pick_count}`;
}

/**
 * Rehydrate memoryIds from the DB for today's picks.
 * Called at the start of logLottoPhase when memoryIds is empty (e.g. after a server restart)
 * so in-flight picks can continue to log BUY/SELL/outcome phases correctly.
 */
async function rehydrateMemoryIds(): Promise<void> {
  if (!dbConfigured()) return;
  const today = todayEtYmd();
  const rows = await fetchLottoPlaysForDate(today);
  for (const row of rows) {
    const key = `${row.session_date}:${row.pick_index}`;
    if (!memoryIds.has(key)) {
      memoryIds.set(key, row.id);
    }
  }
  rehydratedForDate = today;
}

export async function logLottoWatch(rec: LottoRecord): Promise<void> {
  if (!dbConfigured()) return;
  const key = rowKey(rec);
  if (memoryIds.has(key)) return;
  const id = await insertLottoPlay({
    session_date: rec.session_date,
    pick_index: rec.pick_count,
    is_reversal: rec.is_reversal,
    phase: rec.phase,
    direction: rec.direction,
    strike: rec.strike,
    contract_label: rec.contract_label,
    entry_zone: rec.entry_zone,
    target_price: rec.target_price,
    target_pts: rec.target_pts,
    invalidation_level: rec.invalidation_level,
    catalyst_summary: rec.catalyst_summary,
    catalysts: rec.catalysts,
    confidence: rec.confidence,
    headline: rec.headline,
    thesis: rec.thesis,
    picked_at: rec.picked_at,
  });
  if (id != null) memoryIds.set(key, id);
}

export async function logLottoPhase(
  rec: LottoRecord,
  patch: {
    phase: string;
    entry_price?: number | null;
    buy_at?: string | null;
    // NOTE: lotto outcomes use "win"/"stop" vocabulary; main plays use "win"/"loss".
    // These map to the same `outcome` column — consumer code should be aware of the distinction.
    outcome?: string | null;
    exit_price?: number | null;
    closed_at?: string | null;
  }
): Promise<void> {
  if (!dbConfigured()) return;
  const key = rowKey(rec);
  let id = memoryIds.get(key);
  // Rehydrate from DB if memoryIds is empty (e.g. server restarted mid-session).
  // Guard is scoped to the current ET session-date so a new session re-rehydrates
  // after a date roll, while repeated calls within the same date stay idempotent.
  if (id == null && rehydratedForDate !== todayEtYmd()) {
    await rehydrateMemoryIds();
    id = memoryIds.get(key);
  }
  if (id == null) {
    await logLottoWatch(rec);
    id = memoryIds.get(key);
  }
  if (id == null) return;
  await updateLottoPlay(id, patch);
}

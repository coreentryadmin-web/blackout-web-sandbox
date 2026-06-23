import { PLATFORM_META_KEYS } from "@/lib/platform-meta-keys";
import { dbConfigured, getMeta, setMeta } from "@/lib/db";
import type { SpxPlayDirection } from "@/lib/spx-signals";
import { todayEt } from "@/lib/et-date";

export type LottoPhase = "SCAN" | "WATCH" | "BUY" | "HOLD" | "SELL" | "INVALID" | "NONE";

export type LottoRecord = {
  session_date: string;
  phase: LottoPhase;
  direction: SpxPlayDirection;
  strike: number;
  contract_label: string;
  premium_estimate: string | null;
  spread_pct: number | null;
  entry_zone: number;
  entry_trigger: string;
  target_price: number;
  target_pts: number;
  invalidation_level: number;
  invalidation_note: string;
  catalyst_summary: string;
  catalysts: string[];
  confidence: number;
  headline: string;
  thesis: string;
  status_message: string;
  open_anchor_price: number | null;
  entry_price: number | null;
  peak_pnl_pts: number | null;
  picked_at: string;
  buy_at: string | null;
  pick_count: number;
  is_reversal: boolean;
  catalyst_snapshot: Record<string, unknown>;
};

const LOTTO_KEY = PLATFORM_META_KEYS.lottoTodayState;
const memoryLotto: { record: LottoRecord | null } = { record: null };

export async function loadLottoRecord(): Promise<LottoRecord | null> {
  const today = todayEt();
  // Drop yesterday's cached record outright.
  if (memoryLotto.record && memoryLotto.record.session_date !== today) {
    memoryLotto.record = null;
  }

  // DB is the source of truth. When DB is unconfigured, the in-memory copy is
  // all we have, so serve the same-day cache.
  if (!dbConfigured()) {
    return memoryLotto.record?.session_date === today ? memoryLotto.record : null;
  }

  // Same-day cache hit: still re-read the (cheap) DB meta key so a write from
  // another instance/manual update can never be masked by this process's cache.
  // If the re-read fails, fall back to the cached copy rather than going dark.
  let raw: string | null;
  try {
    raw = await getMeta(LOTTO_KEY);
  } catch (err) {
    console.error("[spx-lotto-store] loadLottoRecord: getMeta failed, serving cache:", err);
    return memoryLotto.record?.session_date === today ? memoryLotto.record : null;
  }

  if (!raw) {
    // DB row gone (cleared/settled by the writer) — drop a stale same-day cache too.
    if (memoryLotto.record?.session_date === today) memoryLotto.record = null;
    return null;
  }
  try {
    const rec = JSON.parse(raw) as LottoRecord;
    if (rec.session_date !== today) {
      await setMeta(LOTTO_KEY, "");
      memoryLotto.record = null;
      return null;
    }
    memoryLotto.record = rec;
    return rec;
  } catch {
    return null;
  }
}

export async function saveLottoRecord(rec: LottoRecord): Promise<void> {
  const today = todayEt();
  if (rec.session_date !== today) {
    console.warn(
      `[spx-lotto-store] saveLottoRecord: stale session_date ${rec.session_date} (today=${today}) — skipping save`
    );
    return;
  }
  memoryLotto.record = rec;
  if (!dbConfigured()) return;
  await setMeta(LOTTO_KEY, JSON.stringify(rec));
}

export async function clearLottoRecord(): Promise<void> {
  memoryLotto.record = null;
  if (!dbConfigured()) return;
  await setMeta(LOTTO_KEY, "");
}

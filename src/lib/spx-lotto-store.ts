import { PLATFORM_META_KEYS } from "@/lib/platform-meta-keys";
import { dbConfigured, getMeta, setMeta } from "@/lib/db";
import type { SpxPlayDirection } from "@/lib/spx-signals";

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

function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

export async function loadLottoRecord(): Promise<LottoRecord | null> {
  const today = todayEt();
  if (memoryLotto.record?.session_date === today) return memoryLotto.record;
  if (memoryLotto.record && memoryLotto.record.session_date !== today) {
    memoryLotto.record = null;
  }

  if (!dbConfigured()) return memoryLotto.record;

  const raw = await getMeta(LOTTO_KEY);
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw) as LottoRecord;
    if (rec.session_date !== today) {
      await setMeta(LOTTO_KEY, "");
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

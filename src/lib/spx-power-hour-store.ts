import { PLATFORM_META_KEYS } from "@/lib/platform-meta-keys";
import { dbConfigured, getMeta, setMeta } from "@/lib/db";
import type { SpxPlayDirection } from "@/lib/spx-signals";

export type PowerHourPhase = "NONE" | "WATCH" | "HOLD" | "SELL";

export type PowerHourRecord = {
  session_date: string;
  phase: PowerHourPhase;
  direction: SpxPlayDirection;
  anchor_price: number;
  entry_price: number | null;
  strike: number;
  contract_label: string;
  premium_estimate: string | null;
  spread_pct: number | null;
  target_pts: number;
  target_price: number | null;
  stop_pts: number;
  stop_price: number | null;
  peak_pnl_pts: number;
  confidence: number;
  headline: string;
  thesis: string;
  started_at: string;
  entered_at: string | null;
};

const KEY = PLATFORM_META_KEYS.powerHourState;
const mem: { record: PowerHourRecord | null } = { record: null };

function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

export async function loadPowerHourRecord(): Promise<PowerHourRecord | null> {
  if (mem.record) {
    if (mem.record.session_date !== todayEt()) {
      mem.record = null;
      return null;
    }
    return mem.record;
  }
  if (!dbConfigured()) return null;
  const raw = await getMeta(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PowerHourRecord;
    if (parsed.session_date !== todayEt()) return null;
    mem.record = parsed;
    return parsed;
  } catch {
    return null;
  }
}

export async function savePowerHourRecord(rec: PowerHourRecord): Promise<void> {
  if (rec.session_date !== todayEt()) return;
  mem.record = rec;
  if (!dbConfigured()) return;
  await setMeta(KEY, JSON.stringify(rec));
}

export async function clearPowerHourRecord(): Promise<void> {
  mem.record = null;
  if (!dbConfigured()) return;
  await setMeta(KEY, "");
}

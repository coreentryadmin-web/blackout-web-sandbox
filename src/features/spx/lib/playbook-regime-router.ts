/**
 * SPX Slayer — Regime Router (shadow + live-gate filter).
 *
 * Maps `desk.regime` (+ opening-drive session clock) to eligible playbook sets per
 * `docs/spx/PLAYBOOK-FULL-SPEC-v2.md` §2 eligibility matrix.
 *
 * Fail-open on unknown/empty regime so shadow telemetry still records matches
 * when EMA regime is unavailable — never silently drop all playbooks.
 */
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import { PLAYBOOK_REGISTRY, type PlaybookId } from "@/features/spx/lib/playbook-registry";
import { etClock, etMinutes } from "@/features/spx/lib/spx-play-session-time";

export type PlaybookRegimeBucket =
  | "trend_bull"
  | "trend_bear"
  | "recovery"
  | "weak"
  | "neutral"
  | "opening_drive"
  | "unknown";

const OPENING_DRIVE = new Set<PlaybookRegimeBucket>(["opening_drive"]);
const TREND_BULL = new Set<PlaybookRegimeBucket>(["trend_bull"]);
const TREND_BEAR = new Set<PlaybookRegimeBucket>(["trend_bear"]);
const RECOVERY = new Set<PlaybookRegimeBucket>(["recovery"]);
const WEAK = new Set<PlaybookRegimeBucket>(["weak"]);
const NEUTRAL = new Set<PlaybookRegimeBucket>(["neutral"]);
const UNKNOWN = new Set<PlaybookRegimeBucket>(["unknown"]);

const ALL_BUCKETS: ReadonlySet<PlaybookRegimeBucket> = new Set([
  "opening_drive",
  "trend_bull",
  "trend_bear",
  "recovery",
  "weak",
  "neutral",
  "unknown",
]);

function union(...sets: ReadonlySet<PlaybookRegimeBucket>[]): ReadonlySet<PlaybookRegimeBucket> {
  const out = new Set<PlaybookRegimeBucket>();
  for (const s of sets) for (const b of s) out.add(b);
  return out;
}

const ELIGIBILITY: Record<PlaybookId, ReadonlySet<PlaybookRegimeBucket>> = {
  "PB-01": union(TREND_BULL, RECOVERY, NEUTRAL, OPENING_DRIVE, UNKNOWN),
  "PB-02": union(TREND_BEAR, WEAK, NEUTRAL, UNKNOWN),
  "PB-03": ALL_BUCKETS,
  "PB-04": union(TREND_BULL, TREND_BEAR, RECOVERY, WEAK, NEUTRAL, UNKNOWN),
  "PB-05": union(TREND_BULL, TREND_BEAR, RECOVERY, WEAK, UNKNOWN),
  "PB-06": union(OPENING_DRIVE, TREND_BULL, TREND_BEAR, RECOVERY, WEAK, UNKNOWN),
  "PB-07": union(TREND_BULL, TREND_BEAR, RECOVERY, WEAK, NEUTRAL, UNKNOWN),
  "PB-08": union(TREND_BULL, TREND_BEAR, RECOVERY, WEAK, NEUTRAL, UNKNOWN),
  "PB-09": ALL_BUCKETS,
  "PB-10": union(TREND_BULL, TREND_BEAR, UNKNOWN),
  "PB-11": union(NEUTRAL, UNKNOWN),
  "PB-12": ALL_BUCKETS,
  "PB-13": union(OPENING_DRIVE, UNKNOWN),
  "PB-14": union(OPENING_DRIVE, TREND_BULL, TREND_BEAR, RECOVERY, WEAK, NEUTRAL, UNKNOWN),
};

export function classifyPlaybookRegime(
  desk: SpxDeskPayload,
  now: number = Date.now()
): PlaybookRegimeBucket {
  const etMins = etMinutes(new Date(now));
  const openDriveStart = etClock(9, 30);
  const openDriveEnd = etClock(10, 30);
  if (etMins >= openDriveStart && etMins < openDriveEnd) {
    return "opening_drive";
  }

  const raw = String(desk.regime ?? "unknown").toLowerCase().trim();
  if (raw === "bullish") return "trend_bull";
  if (raw === "bearish") return "trend_bear";
  if (raw === "recovering") return "recovery";
  if (raw === "weak") return "weak";
  if (raw === "neutral" || raw === "chop" || raw.includes("chop")) return "neutral";
  return "unknown";
}

export function eligiblePlaybookIds(
  desk: SpxDeskPayload,
  now: number = Date.now()
): PlaybookId[] {
  const bucket = classifyPlaybookRegime(desk, now);
  return PLAYBOOK_REGISTRY.filter((pb) => ELIGIBILITY[pb.id].has(bucket)).map((pb) => pb.id);
}

export function isPlaybookEligible(
  id: PlaybookId,
  desk: SpxDeskPayload,
  now: number = Date.now()
): boolean {
  return eligiblePlaybookIds(desk, now).includes(id);
}

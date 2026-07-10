/**
 * SPX Slayer — Regime Router (shadow + live-gate filter).
 *
 * Maps `desk.regime` (+ opening-drive session clock) to the eligible Phase-1
 * playbook set. Design doc Section 4: "Playbook Registry filters to eligible
 * playbooks for this regime" before the matcher scores preconditions.
 *
 * Fail-open on unknown/empty regime so shadow telemetry still records matches
 * when EMA regime is unavailable — never silently drop all playbooks.
 */
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import { PLAYBOOK_REGISTRY, type PlaybookId } from "@/features/spx/lib/playbook-registry";
import { etClock, etMinutes } from "@/features/spx/lib/spx-play-session-time";

/** Normalized regime buckets used for eligibility. */
export type PlaybookRegimeBucket =
  | "trend_bull"
  | "trend_bear"
  | "recovery"
  | "weak"
  | "neutral"
  | "opening_drive"
  | "unknown";

const PB01_OK: ReadonlySet<PlaybookRegimeBucket> = new Set([
  "trend_bull",
  "recovery",
  "neutral",
  "opening_drive",
  "unknown",
]);
const PB02_OK: ReadonlySet<PlaybookRegimeBucket> = new Set([
  "trend_bear",
  "weak",
  "neutral",
  "unknown",
]);
/** ORB is session-clock gated; regime filter stays permissive. */
const PB03_OK: ReadonlySet<PlaybookRegimeBucket> = new Set([
  "trend_bull",
  "trend_bear",
  "recovery",
  "weak",
  "neutral",
  "opening_drive",
  "unknown",
]);

/** Pin fade works in any non-opening context — the REAL pin check (gamma_regime
 *  mean_revert + between walls) lives in the matcher preconditions. */
const PB04_OK: ReadonlySet<PlaybookRegimeBucket> = new Set([
  "trend_bull",
  "trend_bear",
  "recovery",
  "weak",
  "neutral",
  "unknown",
]);
/** Power hour momentum is window-gated (15:00–15:55 ET) in the matcher. */
const PB08_OK: ReadonlySet<PlaybookRegimeBucket> = new Set([
  "trend_bull",
  "trend_bear",
  "recovery",
  "weak",
  "neutral",
  "unknown",
]);

const ELIGIBILITY: Record<PlaybookId, ReadonlySet<PlaybookRegimeBucket>> = {
  "PB-01": PB01_OK,
  "PB-02": PB02_OK,
  "PB-03": PB03_OK,
  "PB-04": PB04_OK,
  "PB-08": PB08_OK,
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

/** Registry-order eligible playbook ids for this desk tick. */
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

import type { PlaybookPlay } from "./types";
import {
  fetchPendingNighthawkOutcomes,
  pruneNighthawkPlayOutcomesForEdition,
  upsertNighthawkPlayOutcomes,
  updateNighthawkPlayOutcome,
  type NighthawkPlayOutcomeRow,
} from "@/lib/db";

// Per-edition distributed lock for outcome sync.
// Prevents concurrent force-rebuilds from racing on the same upsert and
// overwriting each other's rows. One Promise chain per editionFor key.
const _syncLocks = new Map<string, Promise<void>>();
import { fetchStockDailyBars } from "@/lib/providers/polygon";
import { polygonConfigured } from "@/lib/providers/config";

export type ParsedPlayLevels = {
  entry_range_low: number | null;
  entry_range_high: number | null;
  target: number | null;
  stop: number | null;
};

function parseDecimal(text: unknown): number | null {
  if (text == null) return null;
  const m = String(text).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

export function parsePlayLevels(play: PlaybookPlay): ParsedPlayLevels {
  const entryText = String(play.entry_range ?? "");
  const normalized = entryText.replace(/[–—]/g, "-");
  const entryParts = normalized
    .split("-")
    .map((p) => parseDecimal(p))
    .filter((n): n is number => n != null);

  let entry_range_low: number | null = null;
  let entry_range_high: number | null = null;
  if (entryParts.length >= 2) {
    entry_range_low = Math.min(entryParts[0]!, entryParts[1]!);
    entry_range_high = Math.max(entryParts[0]!, entryParts[1]!);
  } else if (entryParts.length === 1) {
    entry_range_low = entryParts[0]!;
    entry_range_high = entryParts[0]!;
  }

  return {
    entry_range_low,
    entry_range_high,
    target: parseDecimal(play.target),
    stop: parseDecimal(play.stop),
  };
}

export async function syncNighthawkPlayOutcomes(
  editionFor: string,
  plays: PlaybookPlay[],
  sectors: Record<string, string | null | undefined> = {}
): Promise<void> {
  const rows = plays.map((play) => {
    const ticker = String(play.ticker ?? "").toUpperCase();
    const levels = parsePlayLevels(play);
    const direction = String(play.direction ?? "LONG").toUpperCase().includes("SHORT") ? "SHORT" : "LONG";
    return {
      edition_for: editionFor,
      ticker,
      direction: direction as "LONG" | "SHORT",
      conviction: String(play.conviction ?? "B").toUpperCase(),
      entry_range_low: levels.entry_range_low,
      entry_range_high: levels.entry_range_high,
      target: levels.target,
      stop: levels.stop,
      score: Number(play.score ?? 0),
      sector: sectors[ticker] ?? null,
    };
  });

  // Serialize concurrent syncs for the same edition to prevent the second
  // force-rebuild from racing the first and overwriting atomically-merged fields.
  const prior = _syncLocks.get(editionFor) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => { release = resolve; });
  _syncLocks.set(editionFor, prior.then(() => next));

  try {
    await prior;
    // upsertNighthawkPlayOutcomes must use INSERT … ON CONFLICT DO UPDATE SET
    // so that each row is merged atomically in the DB rather than blindly overwritten.
    await upsertNighthawkPlayOutcomes(rows);
    await pruneNighthawkPlayOutcomesForEdition(editionFor, rows.map((row) => row.ticker));
  } finally {
    release();
    // Clean up the lock entry once all chains for this edition have resolved.
    if (_syncLocks.get(editionFor) === prior.then(() => next)) {
      _syncLocks.delete(editionFor);
    }
  }
}

export function outcomeSessionDate(row: Pick<NighthawkPlayOutcomeRow, "edition_for">): string {
  return row.edition_for;
}

export function resolveOutcome(row: NighthawkPlayOutcomeRow): {
  hit_target: boolean;
  hit_stop: boolean;
  outcome: "target" | "stop" | "open" | "ambiguous" | "pending";
  // True when a stop level is defined but intraday high/low data is unavailable,
  // making it impossible to determine whether the stop was hit. These plays must
  // be excluded from win/loss tallies and reported separately so operators know
  // the effective sample size rather than silently inflating the win rate.
  stop_data_unavailable: boolean;
} {
  const close = row.next_day_close;
  const high = row.session_high;
  const low = row.session_low;
  const open = row.next_day_open;
  const target = row.target;
  const stop = row.stop;

  if (close == null) {
    return { hit_target: false, hit_stop: false, outcome: "pending", stop_data_unavailable: false };
  }

  const isLong = row.direction === "LONG";
  const hasIntraday = high != null && low != null;
  // When a stop is defined but only close data is available we cannot determine
  // whether the stop was hit intraday. Flag the play so callers can exclude it
  // from win-rate calculations rather than counting it as a non-stop outcome.
  const stop_data_unavailable = stop != null && !hasIntraday;
  let hit_target = false;
  let hit_stop = false;

  if (target != null) {
    hit_target = hasIntraday
      ? isLong
        ? high! >= target
        : low! <= target
      : isLong
        ? close >= target
        : close <= target;
  }
  if (stop != null && hasIntraday) {
    hit_stop = isLong ? low! <= stop : high! >= stop;
  }

  let outcome: "target" | "stop" | "open" | "ambiguous" | "pending" = "open";
  if (hit_target && hit_stop) {
    if (open != null && target != null && (isLong ? open >= target : open <= target)) {
      outcome = "target";
    } else if (open != null && stop != null && (isLong ? open <= stop : open >= stop)) {
      outcome = "stop";
    } else {
      outcome = "ambiguous";
    }
  } else if (hit_stop) {
    outcome = "stop";
  } else if (hit_target) {
    outcome = "target";
  }

  return { hit_target, hit_stop, outcome, stop_data_unavailable };
}

export async function resolvePendingNighthawkOutcomes(opts?: {
  lookbackDays?: number;
}): Promise<{ resolved: number; skipped: number; errors: string[] }> {
  if (!polygonConfigured()) {
    return { resolved: 0, skipped: 0, errors: ["Polygon not configured"] };
  }

  const lookbackDays = opts?.lookbackDays ?? 7;
  const pending = await fetchPendingNighthawkOutcomes(lookbackDays);
  let resolved = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of pending) {
    try {
      const sessionDate = outcomeSessionDate(row);
      const bars = await fetchStockDailyBars(row.ticker, sessionDate, sessionDate, "1");
      const bar = bars[0];
      if (!bar) {
        skipped += 1;
        continue;
      }

      const next_day_open = bar.o;
      const next_day_close = bar.c;
      const session_high = bar.h;
      const session_low = bar.l;

      const verdict = resolveOutcome({
        ...row,
        next_day_open,
        next_day_close,
        session_high,
        session_low,
      });

      await updateNighthawkPlayOutcome(row.id, {
        next_day_open,
        next_day_close,
        session_high,
        session_low,
        hit_target: verdict.hit_target,
        hit_stop: verdict.hit_stop,
        outcome: verdict.outcome,
      });
      resolved += 1;
    } catch (err) {
      errors.push(`${row.ticker}@${row.edition_for}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { resolved, skipped, errors };
}

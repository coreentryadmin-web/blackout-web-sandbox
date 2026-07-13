// Context-at-entry capture (decision doc C-2, docs/audit/NIGHTHAWK-0DTE-DECISION.md §2).
// The strongest factor split in the 7/13 forensics — day-open VIX 15-17 → 69% WR vs
// 17-20 → 25% WR — was derivable only DAY-LEVEL from Polygon after the fact, because
// no play surface persists any market context per play. This module captures that
// context AT COMMIT TIME so every future calibration can cut per-play instead of
// re-deriving a proxy: day-open VIX, the SPY session bias (the same marketBias() read
// the intraday edge layer scores with), the name's dealer gamma regime when the
// dossier carried one, the final score as committed, and the ET commit timestamp.
//
// Split the same way the rest of this directory is: buildZeroDteEntryContext() is a
// PURE function (unit-tested with fixtures, no providers); fetchZeroDteSessionContext()
// does the fetching, cached + soft-deadlined so it can never stall or fail a scan —
// context capture is best-effort by design (a null context must never block a commit;
// the ledger row is still the system of record for the play itself).

import { todayEt } from "@/features/nighthawk/lib/session";
import { fetchAggBars } from "@/lib/providers/polygon-largo";
import { withServerCache } from "@/lib/server-cache";
import { computeIntradayRead, marketBias, type MarketBias } from "./intraday";

/** Await `p` for at most `ms`, else null — same semantics as scan.ts's within();
 *  duplicated (7 lines) rather than imported because scan.ts imports THIS module
 *  for the write path, and importing back would create a require cycle. */
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      }
    );
  });
}

/** Session-level half of the context — identical for every play committed in the
 *  same window, so it is fetched once (cached) per scan, not once per row. */
export type ZeroDteSessionContext = {
  /** Official day-open of I:VIX (Polygon daily bar). Null when the bar is missing
   *  (holiday, provider outage) — never guessed from a stale close. */
  vix_open: number | null;
  /** SPY session bias from the SAME marketBias() read the edge layer scores with —
   *  "flat" is the mixed/no-lean state. Null when SPY minute bars were unreadable. */
  spy_bias: MarketBias | null;
};

/** The persisted per-row context blob (zerodte_setup_log.entry_context /
 *  spx_play_outcomes.entry_context). Additive by design: consumers must treat every
 *  field as optional — rows older than this column carry NULL forever. */
export type ZeroDteEntryContext = {
  vix_open: number | null;
  spy_bias: MarketBias | null;
  /** Dealer gamma regime for the NAME at commit (dossier positioning) — null when
   *  the dossier had none (or, for SPX Slayer rows, until the engine threads its
   *  own desk regime through; see the store's call site). */
  gamma_regime: string | null;
  /** The score exactly as committed. The row's `score` column is refreshed on every
   *  later scan tick and `score_max` only ratchets up, so without this the
   *  commit-time score is unrecoverable — and it is the number every score-band
   *  gate/calibration actually acted on. */
  score: number | null;
  /** Human-readable ET commit stamp (e.g. "2026-07-13 09:55 ET"). first_flagged_at
   *  already stores the exact TIMESTAMPTZ; this is the self-contained ET rendering
   *  so a context blob read in isolation still answers "when, desk time?". */
  committed_at_et: string;
};

/** "YYYY-MM-DD HH:mm ET" for an epoch-ms instant. en-CA date + en-GB 24h time give
 *  stable ISO-ish parts without manual timezone math. */
export function formatEtStamp(epochMs: number): string {
  const d = new Date(epochMs);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `${day} ${time} ET`;
}

/** Pure assembly of the persisted blob — session half + the play's own fields.
 *  Numbers are rounded HERE (data layer), per the repo's malformed-float rule. */
export function buildZeroDteEntryContext(
  play: { score: number | null; gamma_regime: string | null },
  session: ZeroDteSessionContext | null,
  nowMs: number
): ZeroDteEntryContext {
  const vix = session?.vix_open;
  return {
    vix_open: vix != null && Number.isFinite(vix) ? Math.round(vix * 100) / 100 : null,
    spy_bias: session?.spy_bias ?? null,
    gamma_regime: play.gamma_regime ?? null,
    score: play.score != null && Number.isFinite(play.score) ? Math.round(play.score) : null,
    committed_at_et: formatEtStamp(nowMs),
  };
}

const SESSION_CTX_TTL_MS = 3 * 60 * 1000; // same cadence as the intraday read cache
const SESSION_CTX_WAIT_MS = 2_500; // soft deadline — a slow provider degrades to null

/**
 * Fetch the session half of the context, cached per (session, 3-min window) across
 * all replicas. VIX day-open is a daily-bar `o` (fixed at 9:30 ET, so the 3-min TTL
 * only matters for the SPY bias half). Best-effort throughout: any failure → null,
 * never a throw into the scan.
 */
export async function fetchZeroDteSessionContext(): Promise<ZeroDteSessionContext | null> {
  const today = todayEt();
  return within(
    withServerCache<ZeroDteSessionContext>(`zerodte:entryctx:${today}`, SESSION_CTX_TTL_MS, async () => {
      const [vixBars, spyBars] = await Promise.all([
        fetchAggBars("I:VIX", 1, "day", today, today).catch(() => []),
        fetchAggBars("SPY", 1, "minute", today, today, "1000").catch(() => []),
      ]);
      const vixOpen = vixBars.length ? vixBars[0]!.o : null;
      const spyRead = computeIntradayRead(
        spyBars
          .filter((b) => b.t != null && Number.isFinite(b.t))
          .map((b) => ({ t: b.t as number, h: b.h, l: b.l, c: b.c, v: b.v }))
      );
      return {
        vix_open: vixOpen != null && Number.isFinite(vixOpen) ? vixOpen : null,
        spy_bias: marketBias(spyRead),
      };
    }),
    SESSION_CTX_WAIT_MS
  );
}

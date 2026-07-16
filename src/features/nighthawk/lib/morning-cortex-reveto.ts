// PR-N6: Cortex morning re-veto — a "fresh-veto" path that catches plays whose
// context changed overnight. The evening Cortex compose ran at publish time; this
// re-compose runs at 9:15 ET with live pre-market context. If the Cortex now vetoes
// a play that passed at publish, the play is pulled (one-way latch, same as
// INVALIDATED). Pure over its inputs so the logic is testable without IO.
//
// The Cortex IO (fetchCortexInputs) is invoked by the cron caller, not here — this
// module only processes the resulting CortexVerdict objects against play statuses.

import type { PlayStatus } from "./morning-confirm-verdict";
import type { CortexVerdict } from "@/lib/nighthawk/cortex/types";

export type CortexRevetoResult = {
  /** Plays whose statuses were upgraded to INVALIDATED by a fresh Cortex veto. */
  vetoed: Array<{ ticker: string; vetoReasons: string[] }>;
  /** Plays where the Cortex ran but returned no vetoes. */
  cleared: string[];
  /** Plays skipped (already INVALIDATED, or Cortex errored). */
  skipped: string[];
};

/**
 * Merge fresh Cortex verdicts into the mechanical play statuses. For each play:
 *  - Already INVALIDATED → skip (the mechanical check already caught it)
 *  - Cortex has vetoes → upgrade to INVALIDATED with the veto reasons
 *  - No vetoes → leave the mechanical status unchanged
 *
 * Returns a NEW array (never mutates the input) and the reveto result for logging.
 */
export function applyCortexMorningReveto(
  playStatuses: PlayStatus[],
  cortexVerdicts: Map<string, CortexVerdict | null>,
): { statuses: PlayStatus[]; result: CortexRevetoResult } {
  const result: CortexRevetoResult = { vetoed: [], cleared: [], skipped: [] };

  const statuses = playStatuses.map((ps) => {
    if (ps.status === "INVALIDATED") {
      result.skipped.push(ps.ticker);
      return ps;
    }

    const verdict = cortexVerdicts.get(ps.ticker.toUpperCase());
    if (!verdict) {
      result.skipped.push(ps.ticker);
      return ps;
    }

    if (verdict.vetoes.length > 0) {
      const vetoReasons = verdict.vetoes.map(
        (v) => `[${v.source}] ${v.detail}`,
      );
      result.vetoed.push({ ticker: ps.ticker, vetoReasons });
      return {
        ...ps,
        status: "INVALIDATED" as const,
        reason: [
          ps.reason !== "All checks passed" ? ps.reason : null,
          `Cortex fresh-veto: ${vetoReasons.join("; ")}`,
        ]
          .filter(Boolean)
          .join("; "),
      };
    }

    result.cleared.push(ps.ticker);
    return ps;
  });

  return { statuses, result };
}

// PR-N4: the read-time PULLED overlay for the member edition payload.
//
// An INVALIDATED morning-confirm verdict latches `pulled` on the play's outcome row
// (morning-verdict-persist.ts / recordNighthawkMorningVerdict). The published edition row
// itself is never mutated — this module merges the latch onto the payload the member
// actually receives, so a pulled play is EXCLUDED from the actionable surface by being
// PRESENTED as pulled (badge + reason + de-emphasized levels), never deleted or hidden.
// Pulled plays staying visible as pulled is the honesty: the record of what was published
// stays intact, and the member sees exactly why the desk pulled it (same honest-labeling
// spirit as the 0DTE WATCH badge).
//
// Dependency-free leaf (no db/provider imports) so it stays client-bundle-safe and the
// merge semantics are unit-testable with plain fixtures.

import type { NightHawkEdition, PlaybookPlay } from "./types";
import type { NighthawkPulledPlay } from "@/lib/db";

/**
 * Stamp `pulled`/`pulled_reason` onto the matching plays of an edition payload.
 * Pure and non-destructive: returns a new edition object with new play objects for the
 * pulled tickers; every play stays in the list at its published rank. Unknown pulled
 * tickers (row exists but the play left the payload) are ignored — the outcome row is
 * the durable record, the overlay only annotates what is being served.
 */
export function applyNighthawkPullOverlay(
  edition: NightHawkEdition,
  pulledRows: NighthawkPulledPlay[]
): NightHawkEdition {
  if (!pulledRows.length || !edition.plays?.length) return edition;
  const byTicker = new Map(pulledRows.map((r) => [r.ticker.toUpperCase(), r]));
  let touched = false;
  const plays: PlaybookPlay[] = edition.plays.map((play) => {
    const row = byTicker.get(String(play.ticker ?? "").toUpperCase());
    if (!row) return play;
    touched = true;
    return {
      ...play,
      pulled: true,
      pulled_reason:
        row.pulled_reason ?? "Pulled pre-open by the morning confirmation check",
    };
  });
  return touched ? { ...edition, plays } : edition;
}

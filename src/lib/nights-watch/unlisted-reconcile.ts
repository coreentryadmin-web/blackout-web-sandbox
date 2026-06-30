import { closeOpenPositionById, listAllOpenUserPositions } from "@/lib/db";
import { buildOcc } from "@/lib/ws/options-socket";

/**
 * Auto-close open positions the upstream snapshot explicitly reports as unlisted / not found.
 * Prevents phantom strikes from polluting Night's Watch and failing data-correctness audits.
 */
export async function autoCloseUnlistedOpenPositions(
  unfound: Array<{ occ: string; reason: string }>
): Promise<number> {
  if (!unfound.length) return 0;
  const unlisted = new Set(
    unfound
      .filter((u) => /not.?found|unlisted|contract-not-found/i.test(u.reason))
      .map((u) => u.occ)
  );
  if (!unlisted.size) return 0;

  const open = await listAllOpenUserPositions();
  let closed = 0;
  for (const p of open) {
    const occ = buildOcc(p.ticker, p.expiry, p.option_type, p.strike);
    if (!occ || !unlisted.has(occ)) continue;
    const ok = await closeOpenPositionById(p.id, "Auto-closed: contract not listed upstream (unlisted strike)");
    if (ok) closed += 1;
  }
  return closed;
}

import "server-only";

import { getGexPositioning } from "@/lib/providers/gex-positioning";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { normalizeVectorTicker } from "./vector-ticker";
import { loadCurrentChainContracts } from "./vector-gex-reconstruct-server";
import { deriveExpectedMoveInputs } from "./vector-expected-move-atm";
import { computeExpectedMove, type ExpectedMove } from "./vector-expected-move";
import type { VectorDteHorizon } from "./vector-dte-horizon";

/**
 * Horizon-scoped options-implied expected move for a ticker — the server shell behind the Vector
 * expected-move read (task #15). Reuses the SAME live spot + Redis-cached banded chain the per-expiry
 * GEX walls / max-pain already fetch (`loadCurrentChainContracts`), derives a REAL ATM IV + front-
 * expiry DTE (`deriveExpectedMoveInputs`), then runs the pure `computeExpectedMove`.
 *
 * Best-effort: returns null on any failure (no spot, empty chain, no usable IV, thrown fetch) — a
 * live overlay must degrade to "no cone" rather than error or blank the chart. Never fabricates a
 * vol: if the chain carries no real ATM IV for the horizon, there is simply no band.
 */
export async function getVectorExpectedMove(
  ticker: string,
  horizon: VectorDteHorizon
): Promise<(ExpectedMove & { expiry: string }) | null> {
  const t = normalizeVectorTicker(ticker);
  try {
    const pos = await getGexPositioning(t);
    const spot = pos?.spot;
    if (!(spot && spot > 0)) return null;

    const contracts = await loadCurrentChainContracts(t, spot);
    if (!contracts.length) return null;

    const inputs = deriveExpectedMoveInputs(contracts, spot, horizon, todayEtYmd());
    if (!inputs) return null;

    const em = computeExpectedMove({ spot: inputs.spot, atmIv: inputs.atmIv, dteDays: inputs.dteDays });
    if (!em) return null;
    return { ...em, expiry: inputs.expiry };
  } catch {
    return null; // live overlay: fall back to no cone, never throw
  }
}

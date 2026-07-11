import type { ChainContract } from "@/lib/providers/polygon-options-gex";
import type { ReconstructContract, SpotSample } from "./vector-gex-reconstruct";

/**
 * Pure mapping layer between the raw Polygon options-chain snapshot / underlying
 * minute bars and the BSM reconstruction engine (`vector-gex-reconstruct.ts`).
 *
 * Split out from the network orchestrator (`vector-gex-reconstruct-server.ts`) so
 * the shape-normalization — the part with real edge cases (missing greeks, zero
 * OI, malformed expiries, ms-vs-sec timestamps, downsampling) — is pure and unit
 * tested without touching the provider layer. The `ChainContract` import is
 * TYPE-ONLY, so this file pulls in no runtime provider/network code.
 */

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalize a Polygon chain snapshot into reconstruction contracts, dropping any
 * row that can't contribute honest gamma: no strike, malformed expiry, unknown
 * type, or zero/absent OI or IV (a contract with no OI or no IV carries no real
 * dealer gamma — including it would only add noise, never a wall). No fabrication:
 * every kept field is the provider's own value.
 */
export function chainToReconstructContracts(
  contracts: readonly ChainContract[]
): ReconstructContract[] {
  const out: ReconstructContract[] = [];
  for (const c of contracts) {
    const strike = Number(c.details?.strike_price);
    const expiry = String(c.details?.expiration_date ?? "").slice(0, 10);
    const ct = String(c.details?.contract_type ?? "").toLowerCase();
    const type = ct === "call" ? "call" : ct === "put" ? "put" : null;
    const oi = Number(c.open_interest ?? 0);
    const iv = Number(c.implied_volatility ?? 0);
    if (!(strike > 0) || !YMD_RE.test(expiry) || !type) continue;
    if (!(oi > 0) || !(iv > 0)) continue;
    out.push({ strike, expiry, openInterest: oi, iv, type });
  }
  return out;
}

/** Minimal shape of a Polygon aggregate bar the reconstruction needs (t = epoch ms, c = close). */
export type AggBarLike = { t?: number; c?: number };

/**
 * Downsample intraday minute bars into an evenly-bucketed spot path for the rail.
 *
 * - Buckets by `everySec` (default 5min — matches the universe recorder cadence so
 *   a reconstructed rail is visually indistinguishable from a live-recorded one).
 * - `t` is Polygon epoch-MILLISECONDS; the reconstruction rail (and WallHistorySample)
 *   is epoch-SECONDS, so we convert. Bucket time = floor(sec / everySec) * everySec,
 *   which is exactly how the live sample bucketer snaps times → same grid, no drift.
 * - Last bar in a bucket wins (bars arrive ascending → the bucket's closing spot),
 *   the honest representative price for that interval.
 * - Hard `cap` via striding so a full-day 1-min pull can't produce an unbounded rail.
 */
export function barsToSpotSamples(
  bars: readonly AggBarLike[],
  everySec = 300,
  cap = 128
): SpotSample[] {
  const step = everySec > 0 ? everySec : 300;
  const byBucket = new Map<number, SpotSample>();
  for (const b of bars) {
    const t = Number(b.t);
    const c = Number(b.c);
    if (!Number.isFinite(t) || !(c > 0)) continue;
    const sec = Math.floor(t / 1000);
    const bucket = Math.floor(sec / step) * step;
    byBucket.set(bucket, { time: bucket, spot: c }); // asc bars → last write = bucket close
  }
  let out = [...byBucket.values()].sort((a, b) => a.time - b.time);
  if (cap > 0 && out.length > cap) {
    const stride = Math.ceil(out.length / cap);
    // Keep every `stride`-th sample plus the final one so the rail still ends at
    // the true session close rather than being clipped mid-afternoon.
    out = out.filter((_, i) => i % stride === 0 || i === out.length - 1);
  }
  return out;
}

/**
 * Strike band (inclusive lo/hi) that covers the whole traveled spot range plus a
 * pad, so the chain fetch pulls exactly the strikes where walls can matter for the
 * session and nothing further out. Returns null when no usable spot is present.
 */
export function reconstructStrikeBand(
  spots: readonly SpotSample[],
  padPct = 0.06
): { lo: number; hi: number } | null {
  const prices = spots.map((s) => s.spot).filter((p) => Number.isFinite(p) && p > 0);
  if (!prices.length) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const pad = Number.isFinite(padPct) && padPct > 0 ? padPct : 0.06;
  return { lo: Math.floor(min * (1 - pad)), hi: Math.ceil(max * (1 + pad)) };
}

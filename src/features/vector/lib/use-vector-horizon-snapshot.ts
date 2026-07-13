"use client";

import { useEffect, useRef, useState } from "react";
import type { GexWalls } from "@/lib/providers/gex-wall-levels";
import type { VectorDteHorizon } from "./vector-dte-horizon";
import type { GexLadder } from "./vector-gex-ladder";
import type { ExpectedMove } from "./vector-expected-move";
import {
  nextHorizonSnapshot,
  type HorizonPart,
  type VectorHorizonSnapshot,
} from "./vector-horizon-snapshot";

/** Matches the chart-walls 15s cadence — the slowest surface used to poll at this rate; now ALL
 *  narrated surfaces move together on it. */
export const HORIZON_SNAPSHOT_REFRESH_MS = 15_000;

async function part<T>(url: string, parse: (json: unknown) => T | null): Promise<HorizonPart<T>> {
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, value: null };
    return { ok: true, value: parse(await res.json()) };
  } catch {
    return { ok: false, value: null };
  }
}

/**
 * The ONE fetch cycle behind every narrated/displayed Vector level (see
 * vector-horizon-snapshot.ts for why). Per (ticker, horizon): pulls walls+flip, ladder rows,
 * max-pain and expected-move TOGETHER (Promise.all), stamps them with a single asOf, and swaps
 * the result in atomically via nextHorizonSnapshot. Refreshes every 15s during a live session;
 * one cycle only when the market is closed (the numbers are static). A late response for a
 * PREVIOUS (ticker, horizon) can never land: the cycle re-checks the live key before swapping —
 * the same staleness-guard class every Vector fetch uses.
 */
export function useVectorHorizonSnapshot(
  ticker: string,
  horizon: VectorDteHorizon,
  liveSession: boolean
): VectorHorizonSnapshot | null {
  const [snapshot, setSnapshot] = useState<VectorHorizonSnapshot | null>(null);
  const keyRef = useRef("");

  useEffect(() => {
    const key = `${ticker}::${horizon}`;
    keyRef.current = key;
    let cancelled = false;

    const cycle = async () => {
      const q = `ticker=${encodeURIComponent(ticker)}&dte=${encodeURIComponent(horizon)}`;
      // All four endpoints round at the data layer (repo policy) and accept ?dte= for EVERY
      // horizon including "all" — verified against each route before wiring.
      const [walls, ladder, maxPain, expectedMove] = await Promise.all([
        part(`/api/market/vector/walls?${q}`, (j) => {
          const d = j as { walls?: GexWalls | null; flip?: number | null };
          return { walls: d.walls ?? null, flip: d.flip ?? null };
        }),
        part(`/api/market/vector/gex-ladder?${q}`, (j) => {
          const d = j as { ladder?: GexLadder | null; spot?: number | null };
          return { ladder: d.ladder ?? null, spot: d.spot ?? null };
        }),
        part(`/api/market/vector/max-pain?${q}`, (j) => {
          const d = j as { maxPain?: number | null };
          return d.maxPain ?? null;
        }),
        part(`/api/market/vector/expected-move?${q}`, (j) => {
          const d = j as { expectedMove?: ExpectedMove | null };
          return d.expectedMove ?? null;
        }),
      ]);
      if (cancelled || keyRef.current !== key) return; // selection moved on mid-flight
      const asOf = Date.now();
      setSnapshot((prev) =>
        nextHorizonSnapshot(prev, ticker, horizon, { walls, ladder, maxPain, expectedMove }, asOf)
      );
    };

    void cycle();
    const id = liveSession ? setInterval(() => void cycle(), HORIZON_SNAPSHOT_REFRESH_MS) : null;
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
  }, [ticker, horizon, liveSession]);

  return snapshot;
}

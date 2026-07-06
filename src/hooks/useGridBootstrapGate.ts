"use client";

import useSWR from "swr";
import type { GridBootstrapPayload } from "@/lib/providers/grid";

const BOOTSTRAP_URL = "/api/grid/bootstrap";

async function fetchBootstrap(url: string): Promise<GridBootstrapPayload> {
  const res = await fetch(url, { cache: "no-store", credentials: "same-origin" });
  if (!res.ok) throw new Error(`grid/bootstrap ${res.status}`);
  return res.json() as Promise<GridBootstrapPayload>;
}

/**
 * Collapse Grid first paint into one bootstrap round-trip — panel SWR keys stay null
 * until bootstrap settles so we don't fan out 8+ parallel Redis reads alongside bootstrap.
 */
export function useGridBootstrapGate() {
  const { data, isLoading, error } = useSWR(BOOTSTRAP_URL, fetchBootstrap, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  });
  const ready = !isLoading;
  const seeded = Boolean(data?.panels);
  const failed = ready && Boolean(error) && !seeded;

  return {
    ready,
    /** SWR key for a panel route — null until bootstrap attempt finishes. */
    panelKey: (path: string) => (ready ? path : null),
    bootstrapSeeded: seeded,
    /** When bootstrap failed, panels fall back to direct fetches. */
    revalidateOnMount: failed || !seeded,
  };
}

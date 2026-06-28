"use client";

import useSWR from "swr";
import { clsx } from "clsx";

type IndexSnap = {
  price?: number | null;
  change_pct?: number | null;
  name?: string;
} | null;

type IndicesResponse = {
  source?: string;
  as_of?: string;
  spx?: IndexSnap;
  vix?: IndexSnap;
  error?: string;
};

const fetcher = () =>
  fetch("/api/market/indices", { cache: "no-store", credentials: "same-origin" })
    .then((r) => (r.ok ? (r.json() as Promise<IndicesResponse>) : null))
    .catch(() => null);

function fmtNum(n: number | null | undefined, decimals = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function IndexChip({
  label,
  price,
  changePct,
}: {
  label: string;
  price: number | null | undefined;
  changePct: number | null | undefined;
}) {
  const isUp = (changePct ?? 0) >= 0;
  return (
    <span className="index-ribbon-chip">
      <span className="index-ribbon-label">{label}</span>
      <span className="index-ribbon-price">{fmtNum(price)}</span>
      <span
        className={clsx(
          "index-ribbon-chg",
          isUp ? "text-emerald-400" : "text-[#ff5c78]"
        )}
      >
        {fmtPct(changePct)}
      </span>
    </span>
  );
}

/**
 * IndexRibbon — compact top bar showing live SPX + VIX quotes from /api/market/indices.
 * Sits below the Nav in the site layout. Polls every 30s (the route itself is cache-reader).
 * Hidden when data is unavailable (market closed / Polygon unconfigured) so it takes no
 * space and doesn't show placeholder dashes when offline.
 */
export function IndexRibbon() {
  const { data } = useSWR<IndicesResponse | null>("index-ribbon", fetcher, {
    refreshInterval: 30_000,
    revalidateOnFocus: false,
  });

  // Don't render until we have a successful response — avoids a flash of "—" on mount.
  if (!data || data.error || (!data.spx && !data.vix)) return null;

  return (
    <div className="index-ribbon" aria-label="Index quotes">
      {data.spx && (
        <IndexChip
          label="SPX"
          price={data.spx.price}
          changePct={data.spx.change_pct}
        />
      )}
      {data.vix && (
        <IndexChip
          label="VIX"
          price={data.vix.price}
          changePct={data.vix.change_pct}
        />
      )}
    </div>
  );
}

"use client";

import useSWR from "swr";
import { clsx } from "clsx";
import { FreshnessChip } from "@/components/ui/FreshnessChip";

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
      <span className="index-ribbon-price t-num">{fmtNum(price)}</span>
      <span
        className={clsx(
          "index-ribbon-chg t-num inline-flex items-center gap-0.5",
          isUp ? "text-bull" : "text-bear-text"
        )}
      >
        <span aria-hidden>{isUp ? "↑" : "↓"}</span>
        {fmtPct(changePct)}
      </span>
    </span>
  );
}

/**
 * Market strip — SPX + VIX with honest freshness from API as_of timestamp.
 */
export function IndexRibbon() {
  const { data } = useSWR<IndicesResponse | null>("index-ribbon", fetcher, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  });

  if (!data || data.error || (!data.spx && !data.vix)) return null;

  const asOf = data.as_of ? new Date(data.as_of) : null;
  const ageMs = asOf ? Date.now() - asOf.getTime() : null;
  const status =
    ageMs == null ? "syncing" : ageMs > 120_000 ? "stale" : "live";

  return (
    <div className="index-ribbon" aria-label="Market indices">
      <div className="index-ribbon-quotes">
        {data.spx && (
          <IndexChip label="SPX" price={data.spx.price} changePct={data.spx.change_pct} />
        )}
        {data.vix && (
          <IndexChip label="VIX" price={data.vix.price} changePct={data.vix.change_pct} />
        )}
      </div>
      <FreshnessChip status={status} asOf={asOf} className="index-ribbon-freshness" />
    </div>
  );
}

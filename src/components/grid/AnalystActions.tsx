"use client";

import useSWR from "swr";
import { clsx } from "clsx";
import { GridCard } from "./GridCard";
import { useGridTicker } from "@/lib/grid/grid-ticker-context";
import { useGridBootstrapGate } from "@/hooks/useGridBootstrapGate";
import type { GridAnalystAction } from "@/lib/providers/grid";

type AnalystsResponse = { available: boolean; as_of?: string; actions?: GridAnalystAction[]; ticker?: string };

async function fetchAnalysts(url: string): Promise<AnalystsResponse> {
  const res = await fetch(url, { cache: "no-store", credentials: "same-origin" });
  if (!res.ok) throw new Error(`grid/analysts ${res.status}`);
  return res.json();
}

const ACTION_TONE: Record<GridAnalystAction["action"], "emerald" | "bear" | "sky" | "gold"> = {
  upgrade: "emerald",
  downgrade: "bear",
  initiate: "gold",
  maintain: "sky",
  target: "sky",
  other: "sky",
};

const ACTION_LABEL: Record<GridAnalystAction["action"], string> = {
  upgrade: "UPGRADE",
  downgrade: "DOWNGRADE",
  initiate: "INITIATE",
  maintain: "MAINTAIN",
  target: "PT",
  other: "NOTE",
};

function timeAgo(published: string): string {
  if (!published) return "";
  const ms = Date.now() - new Date(published).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}

/**
 * Panel 4 — Analyst Actions ("analysts talks"). Cache-reader: reads /api/grid/analysts, the
 * `grid:analysts` Redis snapshot the `grid-warm` cron writes from the market-wide Benzinga analyst
 * channel (ratings / price target / upgrades / downgrades / analyst color) via fetchBenzingaNews.
 * Rows colored by action — upgrade emerald, downgrade bear.
 */
export function AnalystActions() {
  const { ticker, isFiltered } = useGridTicker();
  const { panelKey, revalidateOnMount } = useGridBootstrapGate();
  const url = `/api/grid/analysts${ticker ? `?ticker=${ticker}` : ""}`;
  const { data, error } = useSWR<AnalystsResponse>(panelKey(url), fetchAnalysts, {
    refreshInterval: isFiltered ? 30_000 : 120_000,
    revalidateOnMount,
  });

  const actions = data?.actions ?? [];
  const live = !error && (data?.available ?? false);

  return (
    <GridCard
      title="Analyst Actions"
      kicker="ANALYSTS"
      accent="emerald"
      live={live}
      span={1}
      footer={<span className="grid-foot-note">Benzinga · ratings · targets · up/downgrades</span>}
    >
      {isFiltered && ticker && (
        <p className="grid-ticker-badge">Showing {ticker} analyst coverage</p>
      )}
      {actions.length === 0 ? (
        <p className="grid-empty">
          {data
            ? isFiltered && ticker
              ? `No analyst actions for ${ticker}`
              : "No fresh analyst actions"
            : error
            ? "Analyst wire offline"
            : "Reading the wire…"}
        </p>
      ) : (
        <ul className="grid-analyst-list overflow-y-auto max-h-[280px]">
          {actions.map((a) => {
            const tone = ACTION_TONE[a.action];
            const ago = timeAgo(a.published);
            return (
              <li key={a.id} className="grid-analyst-row">
                <div className="grid-analyst-top">
                  <span className={clsx("grid-analyst-tag", `pulse-tone-${tone}`)}>
                    {ACTION_LABEL[a.action]}
                  </span>
                  {a.tickers.length > 0 && (
                    <span className="grid-analyst-tickers">{a.tickers.slice(0, 3).join(" · ")}</span>
                  )}
                  {ago && <span className="grid-analyst-ago">{ago}</span>}
                </div>
                {a.url ? (
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="grid-analyst-title grid-analyst-title-link"
                  >
                    {a.title}
                  </a>
                ) : (
                  <p className="grid-analyst-title">{a.title}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </GridCard>
  );
}

"use client";

import useSWR from "swr";
import { clsx } from "clsx";
import { GridCard } from "./GridCard";
import { BenzingaNewsRail } from "@/components/desk/BenzingaNewsRail";
import { useGridTicker } from "@/lib/grid/grid-ticker-context";
import type { NewsArticle } from "@/lib/api";

type NewsRes = { source?: string; articles?: NewsArticle[]; ticker?: string; error?: string };

const fetcher = (url: string) =>
  fetch(url, { cache: "no-store", credentials: "same-origin" })
    .then((r) => r.json()) as Promise<NewsRes>;

function formatTime(published: string): string {
  if (!published) return "";
  try {
    return new Date(published).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

function TickerNewsCard({ article }: { article: NewsArticle }) {
  const time = formatTime(article.published);
  const tickers = article.tickers?.slice(0, 4) ?? [];
  const body = (
    <article className="news-rail-card">
      <div className="flex items-center justify-between gap-2 mb-2">
        {time && <span className="font-mono text-[10px] text-bull">{time}</span>}
        <span className="font-mono text-[10px] tracking-widest uppercase text-cyan-400">Benzinga</span>
      </div>
      {tickers.length > 0 && (
        <p className="font-mono text-[10px] text-purple-light mb-2 truncate">{tickers.join(" · ")}</p>
      )}
      <p className="text-sm text-white leading-snug line-clamp-4">{article.title}</p>
    </article>
  );
  if (article.url) {
    return (
      <a href={article.url} target="_blank" rel="noopener noreferrer" className="block hover:opacity-90">
        {body}
      </a>
    );
  }
  return body;
}

/**
 * Panel 2 — Unified News Feed.
 *
 * Market-wide mode: reuses BenzingaNewsRail (self-contained SWR).
 * Ticker mode: fetches /api/market/news?ticker=TSLA, filters server-side, renders
 * a compact article list with the same card treatment. Refresh 30s in ticker mode.
 */
export function GridNewsPanel() {
  const { ticker, isFiltered } = useGridTicker();
  const url = ticker ? `/api/market/news?ticker=${ticker}` : null;
  const { data, error } = useSWR<NewsRes>(url, fetcher, {
    refreshInterval: 30_000,
  });

  return (
    <GridCard
      title="Unified News"
      kicker="NEWS"
      accent="sky"
      live={isFiltered ? !error && (data?.articles?.length ?? 0) > 0 : true}
      span={2}
    >
      {isFiltered && ticker ? (
        <>
          {data?.articles && data.articles.length > 0 && (
            <p className="grid-ticker-badge">Showing {ticker} news</p>
          )}
          <div className="news-rail-viewport">
            {!data && !error ? (
              <p className="font-mono text-[10px] text-cyan-400 p-4 text-center">
                Searching {ticker} headlines…
              </p>
            ) : error ? (
              <p className="font-mono text-[10px] text-[#ff5c78] p-4 text-center">News feed offline</p>
            ) : (data?.articles?.length ?? 0) === 0 ? (
              <p className="font-mono text-[10px] text-cyan-400 p-4 text-center">
                No news found for {ticker}
              </p>
            ) : (
              <div className="news-rail-track" style={{ animationPlayState: "paused" }}>
                {data!.articles!.slice(0, 15).map((article, i) => (
                  <TickerNewsCard key={`${article.id}-${i}`} article={article} />
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="grid-news-mount">
          <BenzingaNewsRail />
        </div>
      )}
    </GridCard>
  );
}

"use client";

import useSWR from "swr";
import { fetchMarketNews, type NewsArticle } from "@/lib/api";
import { clsx } from "clsx";

function formatTime(published: string): string {
  if (!published) return "";
  try {
    return new Date(published).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function NewsCard({ article }: { article: NewsArticle }) {
  const time = formatTime(article.published);
  const tickers = article.tickers.slice(0, 4);

  const body = (
    <article className="news-rail-card">
      <div className="flex items-center justify-between gap-2 mb-2">
        {time && <span className="font-mono text-[10px] text-bull">{time}</span>}
        <span className="font-mono text-[8px] tracking-widest uppercase text-cyan-400">Benzinga</span>
      </div>
      {tickers.length > 0 && (
        <p className="font-mono text-[10px] text-purple-light mb-2 truncate">
          {tickers.join(" · ")}
        </p>
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

/** Vertical Benzinga feed — right rail, slow scroll */
export function BenzingaNewsRail() {
  const { data, error } = useSWR("benzinga-news", fetchMarketNews, {
    refreshInterval: 45_000,
  });

  const articles = data?.articles ?? [];
  const live = !error && articles.length > 0;
  const loop = [...articles, ...articles];

  return (
    <aside className="news-rail">
      <div className="news-rail-header">
        <span className={clsx("badge-live-dot", live && "animate-pulse")} />
        <span className="font-mono text-[9px] tracking-[0.4em] uppercase text-bull">
          Benzinga Live
        </span>
      </div>

      <div className="news-rail-viewport">
        {!live ? (
          <p className="font-mono text-[10px] text-cyan-400 p-4 text-center">
            {data ? "News standby" : "Loading headlines…"}
          </p>
        ) : (
          <div className="news-rail-track">
            {loop.map((article, i) => (
              <NewsCard key={`${article.id}-${i}`} article={article} />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

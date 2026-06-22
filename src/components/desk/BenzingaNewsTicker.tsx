"use client";

import useSWR from "swr";
import { fetchMarketNews, type NewsArticle } from "@/lib/api";
import { clsx } from "clsx";

function formatTime(published: string): string {
  if (!published) return "";
  try {
    const d = new Date(published);
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

function NewsItem({ article }: { article: NewsArticle }) {
  const time = formatTime(article.published);
  const tickers = article.tickers.slice(0, 3);

  const inner = (
    <>
      {time && <span className="text-bull/90 shrink-0">{time}</span>}
      {tickers.length > 0 && (
        <span className="text-purple-light shrink-0 font-semibold">
          {tickers.join(" · ")}
        </span>
      )}
      <span className="text-sky-100 truncate">{article.title}</span>
    </>
  );

  if (article.url) {
    return (
      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        className="news-ticker-item hover:text-white transition-colors"
      >
        {inner}
      </a>
    );
  }

  return <span className="news-ticker-item">{inner}</span>;
}

export function BenzingaNewsTicker() {
  const { data, error } = useSWR("benzinga-news", fetchMarketNews, {
    refreshInterval: 60_000,
  });

  const articles = data?.articles ?? [];
  const live = !error && articles.length > 0;

  if (!live && !data) {
    return (
      <div className="news-ticker-wrap">
        <div className="news-ticker-label">
          <span className="badge-live-dot" />
          Benzinga
        </div>
        <p className="font-mono text-[10px] text-cyan-400 px-4 py-3 animate-pulse">
          Loading headlines…
        </p>
      </div>
    );
  }

  if (!live) {
    return (
      <div className="news-ticker-wrap">
        <div className="news-ticker-label">
          <span className="badge-live-dot opacity-40" />
          Benzinga
        </div>
        <p className="font-mono text-[10px] text-cyan-400 px-4 py-3">
          News standby — set POLYGON_API_KEY on Railway
        </p>
      </div>
    );
  }

  const loop = [...articles, ...articles];

  return (
    <div className="news-ticker-wrap">
      <div className="news-ticker-label">
        <span className={clsx("badge-live-dot", live && "animate-pulse")} />
        <span className="font-mono text-[9px] tracking-[0.35em] uppercase text-bull">
          Benzinga Live
        </span>
      </div>
      <div className="news-ticker-viewport overflow-hidden">
        <div className="news-ticker-track marquee-left">
          {loop.map((article, i) => (
            <NewsItem key={`${article.id}-${i}`} article={article} />
          ))}
        </div>
      </div>
    </div>
  );
}

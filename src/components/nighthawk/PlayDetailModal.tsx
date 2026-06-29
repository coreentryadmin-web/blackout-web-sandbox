"use client";

import { useMemo } from "react";
import { clsx } from "clsx";
import { Modal } from "@/components/ui";
import useSWR from "swr";
import { postNightHawkPlayExplain } from "@/lib/api";
import type { PlaybookPlay } from "@/lib/nighthawk/types";

type PlayDetailModalProps = {
  play: PlaybookPlay | null;
  editionFor: string | null;
  onClose: () => void;
};

function renderExplainLine(line: string, key: number) {
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  return (
    <p key={key} className="nighthawk-play-explain-line">
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={i} className="nighthawk-play-explain-strong">
              {part.slice(2, -2)}
            </strong>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </p>
  );
}

export function PlayDetailModal({ play, editionFor, onClose }: PlayDetailModalProps) {
  const swrKey =
    play && editionFor ? `nighthawk-explain:${editionFor}:${play.ticker}` : null;

  const { data, error, isLoading } = useSWR(
    swrKey,
    () =>
      postNightHawkPlayExplain({
        edition_for: editionFor!,
        ticker: play!.ticker,
      }),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  const paragraphs = useMemo(() => {
    if (!data?.explanation) return [];
    return data.explanation.split(/\n+/).filter((l) => l.trim());
  }, [data?.explanation]);

  const isBull =
    play?.direction?.toUpperCase().includes("BULL") ||
    play?.direction === "LONG" ||
    play?.direction?.toUpperCase().includes("CALL");

  const header = play && (
    <div>
      <p className="nighthawk-modal-kicker">Hawk Intel · Rank #{play.rank}</p>
      <h2 id="nighthawk-play-detail-title" className="nighthawk-play-detail-title">
        {play.ticker}{" "}
        <span
          className={clsx(
            "nighthawk-play-direction",
            isBull ? "nighthawk-play-direction-bull" : "nighthawk-play-direction-bear"
          )}
        >
          {play.direction}
        </span>
      </h2>
      <p className="nighthawk-play-detail-sub">
        {play.conviction ? `${play.conviction} conviction · ` : ""}
        Score {play.score != null ? play.score : "—"}
        {play.flow_streak_days != null ? ` · ${play.flow_streak_days}d flow streak` : ""}
        {play.iv_rank != null ? ` · IV ${play.iv_rank}` : ""}
      </p>
    </div>
  );

  return (
    <Modal
      open={!!play}
      onClose={onClose}
      title={header}
      className={clsx(
        "nighthawk-modal nighthawk-play-detail-modal",
        isBull ? "nighthawk-modal-gold" : "nighthawk-modal-bear"
      )}
    >
      {play && (
        <>
          <div className="nighthawk-play-detail-quick">
            <div className="nighthawk-play-detail-quick-cell">
              <em>Entry</em>
              <span>{play.entry_range}</span>
            </div>
            <div className="nighthawk-play-detail-quick-cell">
              <em>Target</em>
              <span>{play.target}</span>
            </div>
            <div className="nighthawk-play-detail-quick-cell">
              <em>Stop</em>
              <span>{play.stop}</span>
            </div>
            <div className="nighthawk-play-detail-quick-cell nighthawk-play-detail-contract">
              <em>Contract</em>
              <span>{play.options_play}</span>
            </div>
          </div>

          <p className="nighthawk-play-detail-disclaimer">
            Educational only — not investment advice. Every trade is your own decision.
          </p>

          <div className="nighthawk-play-detail-body">
            {isLoading && (
              <div className="nighthawk-play-detail-loading">
                <div className="nighthawk-power-ring" />
                <p>Building Hawk Intel briefing</p>
                <span>Synthesizing flow, positioning, technicals, and catalysts</span>
              </div>
            )}

            {error && (
              <p className="nighthawk-modal-error">
                Could not load Hawk Intel. {error instanceof Error ? error.message : "Try again."}
              </p>
            )}

            {!isLoading && !error && paragraphs.length > 0 && (
              <div className="nighthawk-play-explain-text">
                {data?.cached && (
                  <p className="nighthawk-play-explain-cached">Cached edition briefing</p>
                )}
                {paragraphs.map((line, i) => renderExplainLine(line, i))}
              </div>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

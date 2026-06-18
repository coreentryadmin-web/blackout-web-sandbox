"use client";

import { useEffect, useMemo } from "react";
import { clsx } from "clsx";
import { AnimatePresence, motion } from "framer-motion";
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

  useEffect(() => {
    if (!play) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [play, onClose]);

  const paragraphs = useMemo(() => {
    if (!data?.explanation) return [];
    return data.explanation.split(/\n+/).filter((l) => l.trim());
  }, [data?.explanation]);

  const isBull =
    play?.direction?.toUpperCase().includes("BULL") ||
    play?.direction === "LONG" ||
    play?.direction?.toUpperCase().includes("CALL");

  return (
    <AnimatePresence>
      {play && (
        <motion.div
          className="nighthawk-modal-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className={clsx(
              "nighthawk-modal nighthawk-play-detail-modal",
              isBull ? "nighthawk-modal-gold" : "nighthawk-modal-bear"
            )}
            initial={{ opacity: 0, y: 28, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.98 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="nighthawk-play-detail-title"
          >
            <header className="nighthawk-modal-header nighthawk-play-detail-header">
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
                  {play.conviction} conviction · Score {play.score}
                  {play.flow_streak_days != null ? ` · ${play.flow_streak_days}d flow streak` : ""}
                </p>
              </div>
              <button
                type="button"
                className="nighthawk-modal-close"
                onClick={onClose}
                aria-label="Close"
              >
                ✕
              </button>
            </header>

            <div className="nighthawk-play-detail-quick">
              <span>
                <em>Entry</em> {play.entry_range}
              </span>
              <span>
                <em>Target</em> {play.target}
              </span>
              <span>
                <em>Stop</em> {play.stop}
              </span>
              <span className="nighthawk-play-detail-contract">
                <em>Contract</em> {play.options_play}
              </span>
            </div>

            <div className="nighthawk-play-detail-body">
              {isLoading && (
                <div className="nighthawk-play-detail-loading">
                  <div className="nighthawk-power-ring" />
                  <p>Generating detailed playbook briefing…</p>
                  <span>Claude is synthesizing flow, positioning, technicals & catalysts</span>
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
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

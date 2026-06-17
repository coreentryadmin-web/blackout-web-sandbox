"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import type { SpxCommentaryResult, SpxDeskPayload } from "@/lib/api";
import { requestSpxCommentary } from "@/lib/api";

const MIN_INTERVAL_MS = 55_000;
const MATERIAL_PRICE_MOVE = 0.08;

type FeedEntry = SpxCommentaryResult & { id: string };

function shouldRefresh(desk: SpxDeskPayload, prev: Partial<SpxDeskPayload> | null, lastAt: number): boolean {
  if (Date.now() - lastAt < MIN_INTERVAL_MS) return false;
  if (!prev?.price) return true;

  const priceMove = Math.abs(desk.price - (prev.price ?? 0));
  if (priceMove >= MATERIAL_PRICE_MOVE) return true;

  if (prev.regime !== desk.regime) return true;
  if (prev.above_vwap !== desk.above_vwap) return true;
  if (prev.tide_bias !== desk.tide_bias) return true;
  if (prev.gex_king !== desk.gex_king) return true;

  return Date.now() - lastAt >= MIN_INTERVAL_MS * 2;
}

export function SpxCommentaryRail({
  desk,
  live,
}: {
  desk?: SpxDeskPayload;
  live?: boolean;
}) {
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prevRef = useRef<Partial<SpxDeskPayload> | null>(null);
  const lastFetchRef = useRef(0);
  const inFlightRef = useRef(false);

  const pullCommentary = useCallback(async (force = false) => {
    if (!desk?.available || !live || inFlightRef.current) return;

    const prev = prevRef.current;
    if (!force && !shouldRefresh(desk, prev, lastFetchRef.current)) return;

    inFlightRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const res = await requestSpxCommentary(desk, prev);
      const entry: FeedEntry = {
        ...res,
        id: `${res.as_of}-${Date.now()}`,
      };
      setEntries((e) => [entry, ...e].slice(0, 24));
      prevRef.current = { ...desk };
      lastFetchRef.current = Date.now();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Commentary unavailable";
      setError(msg);
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  }, [desk, live]);

  useEffect(() => {
    if (!live || !desk?.available) return;
    pullCommentary(true);
  }, [live, desk?.available]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!live) return;
    const interval = setInterval(() => pullCommentary(false), 15_000);
    return () => clearInterval(interval);
  }, [live, pullCommentary]);

  return (
    <aside className="spx-commentary-rail spx-commentary-rail-full spx-commentary-rail-desk">
      <div className="spx-commentary-header">
        <span className={clsx("badge-live-dot", live && "animate-pulse")} />
        <div>
          <span className="font-syne text-base tracking-[0.15em] uppercase text-purple-light block font-bold">
            Live Desk AI
          </span>
          <span className="font-mono text-[10px] tracking-[0.2em] text-grey-500 mt-0.5 block">
            Claude · full desk intel · GEX · tape · levels · news
          </span>
        </div>
        {loading && (
          <span className="ml-auto font-mono text-[8px] text-grey-500 animate-pulse">
            Thinking…
          </span>
        )}
      </div>

      <div className="spx-commentary-viewport">
        {!live ? (
          <p className="font-mono text-[10px] text-grey-500 p-4 text-center">
            Commentary loads when SPX desk is live
          </p>
        ) : error && entries.length === 0 ? (
          <p className="font-mono text-[10px] text-bear/80 p-4 text-center">
            {error.includes("ANTHROPIC") ? "Set ANTHROPIC_API_KEY on Railway" : error}
          </p>
        ) : entries.length === 0 ? (
          <p className="font-mono text-[10px] text-grey-500 p-4 text-center animate-pulse">
            Claude reading the tape…
          </p>
        ) : (
          <div className="spx-commentary-feed">
            <AnimatePresence initial={false}>
              {entries.map((entry, idx) => (
                <motion.article
                  key={entry.id}
                  initial={{ opacity: 0, y: -12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={clsx("spx-commentary-card", idx === 0 && "spx-commentary-card-featured")}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span
                      className={clsx(
                        "spx-commentary-bias",
                        entry.bias === "bullish" && "spx-bias-bull",
                        entry.bias === "bearish" && "spx-bias-bear",
                        entry.bias === "neutral" && "spx-bias-neutral"
                      )}
                    >
                      {entry.bias}
                    </span>
                    <time className="font-mono text-[8px] text-grey-500 shrink-0">
                      {new Date(entry.as_of).toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                  <h3
                    className={clsx(
                      "font-syne font-bold text-white leading-snug mb-2",
                      idx === 0 ? "text-lg md:text-xl" : "text-sm"
                    )}
                  >
                    {entry.headline}
                  </h3>
                  {entry.changed.length > 0 && (
                    <ul className="spx-commentary-changed mb-2">
                      {entry.changed.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  )}
                  <div className="spx-commentary-body whitespace-pre-line">{entry.body}</div>
                  {entry.watch.length > 0 && (
                    <div className="mt-3 pt-2 border-t border-grey-800/80">
                      <p className="font-syne text-[10px] tracking-[0.2em] uppercase text-grey-400 mb-1.5">
                        Watch
                      </p>
                      <ul className="spx-commentary-watch">
                        {entry.watch.map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </motion.article>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </aside>
  );
}

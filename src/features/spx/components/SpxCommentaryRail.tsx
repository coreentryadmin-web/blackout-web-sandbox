"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { renderEmphasis } from "@/features/spx/lib/spx-emphasis";

const BODY_PREVIEW_LINES = 12;
import type { SpxCommentaryResult, SpxDeskPayload } from "@/lib/api";
import { requestSpxCommentary } from "@/lib/api";
import { readSessionCache, writeSessionCache } from "@/lib/session-cache";
import { largoEnabled } from "@/lib/largo-env";
import { isStagingDeploy } from "@/lib/clerk-env";
import {
  commentaryOfflineTone,
  pickCommentaryOfflineCopy,
} from "@/features/spx/lib/spx-commentary-offline-copy";
import { flowStackSignature } from "@/lib/largo/flow-strike-stacks";

const RETRY_ON_ERROR_MS = 30_000;
const MIN_INTERVAL_MS = 55_000;
const MATERIAL_PRICE_MOVE = 0.08;
const COMMENTARY_CACHE_KEY = "spx-commentary-feed";
const COMMENTARY_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

type FeedEntry = SpxCommentaryResult & { id: string };

function loadCachedEntries(): FeedEntry[] {
  return readSessionCache<FeedEntry[]>(COMMENTARY_CACHE_KEY, COMMENTARY_CACHE_MAX_AGE_MS) ?? [];
}


function shouldRefresh(desk: SpxDeskPayload, prev: Partial<SpxDeskPayload> | null, lastAt: number): boolean {
  if (Date.now() - lastAt < MIN_INTERVAL_MS) return false;
  if (!prev?.price) return true;

  const priceMove = Math.abs(desk.price - (prev.price ?? 0));
  if (priceMove >= MATERIAL_PRICE_MOVE) return true;

  if (prev.regime !== desk.regime) return true;
  if (prev.above_vwap !== desk.above_vwap) return true;
  if (prev.tide_bias !== desk.tide_bias) return true;
  if (prev.gex_king !== desk.gex_king) return true;
  if (prev.gamma_flip !== desk.gamma_flip) return true;
  if (prev.gex_stale !== desk.gex_stale) return true;
  if (prev.feed_stalled !== desk.feed_stalled) return true;

  const prevStacks = flowStackSignature(prev.strike_stacks);
  const nextStacks = flowStackSignature(desk.strike_stacks);
  if (nextStacks && prevStacks !== nextStacks) return true;

  return Date.now() - lastAt >= MIN_INTERVAL_MS * 2;
}

/** One commentary line: peel a leading UPPERCASE label (followed by 2+ spaces) into a
 *  styled chip, then render the remainder with white-emphasis markup. */
function CommentaryLine({ line }: { line: string }) {
  const m = line.match(/^([A-ZΔ0-9][A-ZΔ0-9 +/&-]{0,13}?) {2,}(.+)$/);
  if (m) {
    return (
      <div className="spx-ai-line">
        <span className="spx-ai-label">{m[1]}</span>
        <span>{renderEmphasis(m[2])}</span>
      </div>
    );
  }
  return <div className="spx-ai-line">{renderEmphasis(line)}</div>;
}

function CommentaryBody({ body, featured }: { body: string; featured: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const lines = body.split("\n").filter(Boolean);
  const needsCollapse = featured && lines.length > BODY_PREVIEW_LINES;
  const visible = needsCollapse && !expanded ? lines.slice(0, BODY_PREVIEW_LINES) : lines;

  return (
    <div>
      <div className="spx-commentary-body">
        {visible.map((line, i) => (
          <CommentaryLine key={i} line={line} />
        ))}
      </div>
      {needsCollapse && (
        <button
          id="spx-commentary-expand"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 font-mono text-[10px] text-purple-light/70 hover:text-purple-light transition-colors"
        >
          {expanded ? "▲ collapse" : `▼ show full analysis (${lines.length - BODY_PREVIEW_LINES} more)`}
        </button>
      )}
    </div>
  );
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
  const [railCollapsed, setRailCollapsed] = useState(false);
  const prevRef = useRef<Partial<SpxDeskPayload> | null>(null);
  const lastFetchRef = useRef(0);
  const inFlightRef = useRef(false);
  const hydratedRef = useRef(entries.length > 0);
  const cancelledRef = useRef(false);
  /** Milliseconds until the server cache expires — set after each successful call. */
  const nextRefreshMsRef = useRef<number | null>(null);
  /** as_of of the most recent feed entry — the server caps generation at one per
   *  shared 5-min window, so refetches inside a window return the SAME as_of. We
   *  dedup on it so identical analysis is never stacked as a new card. */
  const lastAsOfRef = useRef<string | null>(null);

  // sessionStorage write is intentionally done inside pullCommentary after
  // new entries are added — see below — instead of watching the full entries
  // array (which would write up to 50KB on every 15-30s state update).

  const pullCommentary = useCallback(async (force = false) => {
    if (!largoEnabled() || !live || !desk?.available || inFlightRef.current) return;

    const prev = prevRef.current;
    if (!force && !shouldRefresh(desk, prev, lastFetchRef.current)) return;

    inFlightRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const { commentary, next_refresh_ms } = await requestSpxCommentary(desk, prev);
      nextRefreshMsRef.current = next_refresh_ms ?? null;
      // Always advance the polling clock + delta baseline, even when the content
      // is unchanged, so the scheduler keeps aligning to the server window.
      prevRef.current = { ...desk };
      lastFetchRef.current = Date.now();

      // Dedup: the server generates at most ONE commentary per shared 5-min window,
      // so every refetch inside a window returns the SAME as_of. Only prepend a
      // genuinely-new generation — otherwise the feed stacks identical cards (the
      // bug where the same 9:38 analysis printed 2-3x). The visible cadence then
      // matches the real 5-min generation cadence.
      if (commentary.as_of && commentary.as_of === lastAsOfRef.current) return;
      lastAsOfRef.current = commentary.as_of ?? null;

      const entry: FeedEntry = {
        ...commentary,
        // Stable key per generation (was as_of+Date.now(), which defeated React's
        // reconciliation and let duplicates render).
        id: commentary.as_of || `c-${Date.now()}`,
      };
      setEntries((e) => {
        const next = [entry, ...e].slice(0, 24);
        if (live) writeSessionCache(COMMENTARY_CACHE_KEY, next);
        return next;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Commentary unavailable";
      nextRefreshMsRef.current = null;
      // Advance the throttle clock on FAILURE too. It previously only advanced on
      // success, so while the server was erroring, every desk tick re-entered
      // shouldRefresh with a stale lastFetchRef and fired another POST — a
      // sub-second retry storm per client (2026-07-10 incident). With the clock
      // advanced, retries are bounded by MIN_INTERVAL_MS + the 30s error schedule.
      lastFetchRef.current = Date.now();
      setError(msg);
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  }, [desk, live]);

  useEffect(() => {
    if (!live) return;
    if (entries.length === 0) {
      const cached = loadCachedEntries();
      if (cached.length > 0) {
        setEntries(cached);
        hydratedRef.current = true;
        // Seed the dedup key from the newest cached entry so a first live fetch
        // landing in the same 5-min window doesn't re-add the hydrated card.
        lastAsOfRef.current = cached[0]?.as_of ?? null;
      }
    }
  }, [live, entries.length]);

  useEffect(() => {
    if (!largoEnabled() || !desk?.available || !live) return;
    if (hydratedRef.current && entries.length > 0) {
      pullCommentary(false);
      return;
    }
    pullCommentary(true);
  }, [live, desk?.available, desk?.price, desk?.gamma_flip, desk?.gex_king, desk?.regime]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!largoEnabled() || !desk?.available || !live) return;

    cancelledRef.current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      if (cancelledRef.current) return;
      // Use server-supplied refresh window (+2s buffer, min 5s).
      // Falls back to 60s if the server didn't supply next_refresh_ms.
      // On error (nextRefreshMsRef.current is null), retry after 30s.
      const serverMs = nextRefreshMsRef.current;
      const delayMs =
        serverMs !== null
          ? Math.max(5_000, serverMs + 2_000)
          : RETRY_ON_ERROR_MS;

      timer = setTimeout(() => {
        if (cancelledRef.current) return;
        pullCommentary(false).then(() => schedule());
      }, delayMs);
    };

    schedule();
    return () => {
      cancelledRef.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [desk?.available, live, pullCommentary]);

  const offlineCopy = pickCommentaryOfflineCopy(desk);
  const offlineTone = commentaryOfflineTone(desk);

  return (
    <aside
      className={clsx(
        "spx-commentary-rail spx-commentary-rail-full spx-commentary-rail-desk",
        !live && "spx-commentary-rail-standby"
      )}
    >
      <div className="spx-commentary-header">
        <span className={clsx("badge-live-dot", live && "opacity-100")} />
        <div className="min-w-0">
          <p className="t-kicker text-purple-light/80 mb-0.5">
            {live ? "Live commentary" : "Commentary standby"}
          </p>
          <span className="font-syne text-base tracking-[0.12em] text-purple-light block font-bold">
            Largo
          </span>
          {isStagingDeploy() && (
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-cyan-400/90">
              BlackOut Intelligence
            </span>
          )}
        </div>
        {live && (
          <button
            id="spx-commentary-rail-toggle"
            type="button"
            aria-expanded={!railCollapsed}
            onClick={() => setRailCollapsed((v) => !v)}
            className={clsx(
              "font-mono text-[10px] text-purple-light/70 hover:text-purple-light transition-colors shrink-0",
              loading ? "" : "ml-auto"
            )}
          >
            {railCollapsed ? "▼ expand" : "▲ collapse"}
          </button>
        )}
        {loading && (
          <span className="ml-auto font-mono text-[10px] text-cyan-400">
            Reading…
          </span>
        )}
      </div>

      <div className={clsx("spx-commentary-viewport", railCollapsed && "hidden")}>
        {!live ? (
          <div
            className={clsx(
              "spx-commentary-offline-hero",
              `spx-commentary-offline-hero-${offlineTone}`
            )}
          >
            <p className="spx-commentary-offline-kicker">{offlineCopy.kicker}</p>
            <h2 className="spx-commentary-offline-headline">{offlineCopy.headline}</h2>
            <p className="spx-commentary-offline-body">{offlineCopy.body}</p>
            <p className="spx-commentary-offline-tagline">{offlineCopy.tagline}</p>
          </div>
        ) : error && entries.length === 0 ? (
          <p className="font-mono text-[10px] text-bear-text p-4 text-center">
            {error.includes("ANTHROPIC") ? "Intel feed offline — reconnecting" : error}
          </p>
        ) : entries.length === 0 ? (
          <p className="font-mono text-[10px] text-cyan-400 p-4 text-center">
            Largo, standing by for live tape…
          </p>
        ) : (
          <div className="spx-commentary-feed">
            {entries.map((entry, idx) => (
              <article
                key={entry.id}
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
                    <time className="font-mono text-[10px] text-cyan-400 shrink-0">
                      {new Date(entry.as_of).toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                  <h3
                    className={clsx(
                      "font-syne font-bold spx-ai-headline leading-snug mb-2",
                      entry.bias === "bullish" && "spx-ai-headline-bull",
                      entry.bias === "bearish" && "spx-ai-headline-bear",
                      entry.bias === "neutral" && "spx-ai-headline-neutral",
                      idx === 0 ? "text-lg md:text-xl" : "text-sm"
                    )}
                  >
                    {renderEmphasis(entry.headline)}
                  </h3>
                  {entry.changed.length > 0 && (
                    <ul className="spx-commentary-changed mb-2">
                      {entry.changed.map((c) => (
                        // Strip {{}} like the headline/body — the desk brief wraps numbers in {{ }}.
                        <li key={c}>{renderEmphasis(c)}</li>
                      ))}
                    </ul>
                  )}
                  <CommentaryBody body={entry.body} featured={idx === 0} />
                  {entry.watch.length > 0 && (
                    <div className="mt-3 pt-2 border-t border-white/10">
                      <p className="font-syne text-[10px] tracking-[0.2em] uppercase text-sky-300 mb-1.5">
                        Watch
                      </p>
                      <ul className="spx-commentary-watch">
                        {entry.watch.map((w) => (
                          // The live leak: watch strings carry {{…}} (e.g. "γflip {{7,543}}") and
                          // were rendered raw, bypassing renderEmphasis — strip them here too.
                          <li key={w}>{renderEmphasis(w)}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </article>
              ))}
          </div>
        )}
      </div>
    </aside>
  );
}

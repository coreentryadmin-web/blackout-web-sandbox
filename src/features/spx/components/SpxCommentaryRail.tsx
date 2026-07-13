"use client";

// Largo LIVE COMMENTARY rail — 2026-07-13 trader-first redesign.
//
// The rail no longer prints 5-minute walls of restated numbers. It runs the shared
// deterministic BIE voice brain (src/lib/bie/spx-live-voice.ts — the same brain the
// /api/market/spx/commentary route and Largo terminal Q&A use) CLIENT-SIDE on every
// merged-desk tick, and renders exactly two things:
//   1. a PINNED bias card — direction-colored, the 3–4 sentence BIE voice read plus the
//      ≤3 trigger levels that would change the bias. Re-voiced only when the bias state
//      actually changes or every 5 minutes (BIAS_REFRESH_MS), never per tick.
//   2. a transition-only EVENT feed — king migrations, wall build/fade, γ-flip and VWAP
//      crossings, EMA/structure/regime shifts, expected-move tags, play lifecycle —
//      newest on top, timestamped, colored by direction, deduped by state key with a
//      cooldown so quiet tape stays quiet (≤~1 line/min) and bursts only when the tape
//      actually changes.
//
// Client-side (not server cards) because transitions happen between the server's 5-min
// windows — "crossed the γ-flip" is only tradeable the moment it happens. The desk prop
// already updates every ~2s via useMergedDesk; no extra network traffic is added.

import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";

import type { SpxDeskPayload } from "@/lib/api";
import { readSessionCache, writeSessionCache } from "@/lib/session-cache";
import { largoEnabled } from "@/lib/largo-env";
import { isStagingDeploy } from "@/lib/clerk-env";
import {
  commentaryOfflineTone,
  pickCommentaryOfflineCopy,
} from "@/features/spx/lib/spx-commentary-offline-copy";
import {
  composeBiasHeaderLine,
  composeBiasVoice,
  deriveSpxBias,
  deriveTriggerLevels,
  detectPlayVoiceEvents,
  detectSpxVoiceEvents,
  filterFreshVoiceEvents,
  voiceSnapshotFromDesk,
  type SpxBiasDirection,
  type SpxTriggerLevel,
  type SpxVoiceEvent,
  type SpxVoiceEventTone,
  type SpxVoicePlayState,
  type SpxVoiceSnapshot,
} from "@/lib/bie/spx-live-voice";
import { useSpxPlay } from "@/features/spx/hooks/useSpxPlay";

const FEED_CACHE_KEY = "spx-largo-signal-feed";
const FEED_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
/** Pinned bias card is re-voiced on bias change OR at most every 5 minutes. */
const BIAS_REFRESH_MS = 5 * 60 * 1000;
/** Same-key event cooldown — the anti-spam discipline (see filterFreshVoiceEvents). */
const EVENT_COOLDOWN_MS = 4 * 60 * 1000;
const MAX_FEED_ITEMS = 60;

type PinnedBias = {
  direction: SpxBiasDirection;
  conviction: string;
  aligned: number;
  total: number;
  headerLine: string;
  voice: string;
  triggers: SpxTriggerLevel[];
  at: number;
};

type FeedItem = {
  id: string;
  at: number;
  tone: SpxVoiceEventTone;
  line: string;
  kind: SpxVoiceEvent["kind"];
};

type PersistedRail = { pinned: PinnedBias | null; feed: FeedItem[] };

function toneTextClass(tone: SpxVoiceEventTone): string {
  switch (tone) {
    case "bull":
      return "text-bull";
    case "bear":
      return "text-bear";
    case "warn":
      return "text-amber-300";
    default:
      return "text-sky-300/90";
  }
}

function fmtTime(at: number): string {
  return new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function EventLine({ item }: { item: FeedItem }) {
  return (
    <div className="flex items-baseline gap-2 p-1 border-b border-white/5">
      <time className="font-mono text-[9px] text-white/40 shrink-0 tabular-nums">{fmtTime(item.at)}</time>
      <p className={clsx("font-mono text-[11px] leading-snug", toneTextClass(item.tone))}>{item.line}</p>
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
  const [pinned, setPinned] = useState<PinnedBias | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [railCollapsed, setRailCollapsed] = useState(false);

  const prevSnapRef = useRef<SpxVoiceSnapshot | null>(null);
  const prevPlayRef = useRef<SpxVoicePlayState>(null);
  const seenRef = useRef<Record<string, number>>({});
  const lastBiasKeyRef = useRef<string | null>(null);
  const lastBiasAtRef = useRef(0);
  const idSeqRef = useRef(0);
  const hydratedRef = useRef(false);

  // useSpxPlay shares its SWR key with SpxTradeAlerts, so this adds no polling — it just
  // observes the same payload for armed/fired/closed lifecycle lines.
  const { play } = useSpxPlay(Boolean(live && desk?.available));

  const persist = (nextPinned: PinnedBias | null, nextFeed: FeedItem[]) => {
    writeSessionCache<PersistedRail>(FEED_CACHE_KEY, { pinned: nextPinned, feed: nextFeed.slice(0, MAX_FEED_ITEMS) });
  };

  // Hydrate pinned card + feed from sessionStorage so a reload keeps session context.
  useEffect(() => {
    if (!live || hydratedRef.current) return;
    hydratedRef.current = true;
    const cached = readSessionCache<PersistedRail>(FEED_CACHE_KEY, FEED_CACHE_MAX_AGE_MS);
    if (cached) {
      if (cached.pinned) {
        setPinned(cached.pinned);
        // Seed the bias clock so hydration doesn't immediately re-voice an unchanged bias…
        lastBiasAtRef.current = cached.pinned.at;
        // …but leave lastBiasKeyRef null: the first live tick recomputes and re-pins if
        // the state moved while the tab was away.
      }
      if (cached.feed?.length) setFeed(cached.feed.slice(0, MAX_FEED_ITEMS));
    }
  }, [live]);

  // The brain tick: snapshot the desk, detect transitions, keep the pinned bias fresh.
  useEffect(() => {
    if (!live || !desk?.available || !largoEnabled()) return;

    const snap = voiceSnapshotFromDesk(desk);
    const bias = deriveSpxBias(snap);
    const now = Date.now();

    const rawEvents = detectSpxVoiceEvents(prevSnapRef.current, snap);
    const { fresh, seen } = filterFreshVoiceEvents(rawEvents, seenRef.current, now, EVENT_COOLDOWN_MS);
    seenRef.current = seen;
    prevSnapRef.current = snap;

    const biasChanged = lastBiasKeyRef.current !== null && bias.key !== lastBiasKeyRef.current;
    const periodicRefresh = now - lastBiasAtRef.current >= BIAS_REFRESH_MS;
    const needsPin = lastBiasKeyRef.current === null || biasChanged || periodicRefresh;

    let nextPinned: PinnedBias | null = null;
    if (needsPin) {
      nextPinned = {
        direction: bias.direction,
        conviction: bias.conviction,
        aligned: bias.aligned,
        total: bias.total,
        headerLine: composeBiasHeaderLine(snap, bias),
        voice: composeBiasVoice(snap, bias),
        triggers: deriveTriggerLevels(snap, bias),
        at: now,
      };
      lastBiasKeyRef.current = bias.key;
      lastBiasAtRef.current = now;
    }

    const newItems: FeedItem[] = [];
    // Bias restated in the feed ONLY when it actually changed — the pinned card handles
    // the periodic refresh, so quiet tape doesn't accumulate identical bias lines.
    if (biasChanged && nextPinned) {
      newItems.push({
        id: `b${now}-${idSeqRef.current++}`,
        at: now,
        tone: bias.direction === "bullish" ? "bull" : bias.direction === "bearish" ? "bear" : "warn",
        line: `🧭 ${nextPinned.headerLine}`,
        kind: "bias",
      });
    }
    for (const ev of fresh) {
      newItems.push({ id: `e${now}-${idSeqRef.current++}`, at: ev.at, tone: ev.tone, line: ev.line, kind: ev.kind });
    }

    if (nextPinned || newItems.length) {
      if (nextPinned) setPinned(nextPinned);
      setFeed((cur) => {
        const next = newItems.length ? [...newItems, ...cur].slice(0, MAX_FEED_ITEMS) : cur;
        persist(nextPinned ?? pinned, next);
        return next;
      });
    }
    // Snapshot identity changes on every desk poll; the detectors + cooldown map make
    // re-runs idempotent, so depending on `desk` alone is safe.
  }, [desk, live]); // eslint-disable-line react-hooks/exhaustive-deps

  // Play lifecycle — armed / fired / closed, one line each.
  useEffect(() => {
    if (!live || !largoEnabled()) return;
    const slice: SpxVoicePlayState = play
      ? { action: play.action, direction: play.direction ?? null, open_play: play.open_play ?? null }
      : null;
    const events = detectPlayVoiceEvents(prevPlayRef.current, slice, Date.now());
    prevPlayRef.current = slice;
    if (!events.length) return;
    const { fresh, seen } = filterFreshVoiceEvents(events, seenRef.current, Date.now(), EVENT_COOLDOWN_MS);
    seenRef.current = seen;
    if (!fresh.length) return;
    setFeed((cur) => {
      const next = [
        ...fresh.map((ev) => ({
          id: `p${ev.at}-${idSeqRef.current++}`,
          at: ev.at,
          tone: ev.tone,
          line: ev.line,
          kind: ev.kind,
        })),
        ...cur,
      ].slice(0, MAX_FEED_ITEMS);
      persist(pinned, next);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play, live]);

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
            className="ml-auto font-mono text-[10px] text-purple-light/70 hover:text-purple-light transition-colors shrink-0"
          >
            {railCollapsed ? "▼ expand" : "▲ collapse"}
          </button>
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
        ) : !pinned ? (
          <p className="font-mono text-[10px] text-cyan-400 p-4 text-center">
            Largo, standing by for live tape…
          </p>
        ) : (
          <div className="spx-commentary-feed">
            {/* PINNED BIAS CARD — always on top, direction-colored. */}
            <article
              id="spx-largo-bias-card"
              className="spx-commentary-card spx-commentary-card-featured"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <span
                  className={clsx(
                    "spx-commentary-bias",
                    pinned.direction === "bullish" && "spx-bias-bull",
                    pinned.direction === "bearish" && "spx-bias-bear",
                    pinned.direction === "neutral" && "spx-bias-neutral"
                  )}
                >
                  {pinned.direction}
                </span>
                <span className="font-mono text-[10px] text-white/50">
                  {pinned.total > 0 ? `${pinned.aligned}/${pinned.total} aligned · ${pinned.conviction}` : pinned.conviction}
                </span>
                <time className="font-mono text-[10px] text-cyan-400 shrink-0">{fmtTime(pinned.at)}</time>
              </div>
              <h3
                className={clsx(
                  "font-syne font-bold spx-ai-headline leading-snug mb-2 text-base md:text-lg",
                  pinned.direction === "bullish" && "spx-ai-headline-bull",
                  pinned.direction === "bearish" && "spx-ai-headline-bear",
                  pinned.direction === "neutral" && "spx-ai-headline-neutral"
                )}
              >
                {pinned.headerLine}
              </h3>
              <p className="spx-commentary-body text-[12px] leading-relaxed">{pinned.voice}</p>
              {pinned.triggers.length > 0 && (
                <div className="mt-3 pt-2 border-t border-white/10">
                  <p className="font-syne text-[10px] tracking-[0.2em] uppercase text-sky-300 mb-1.5">
                    Triggers
                  </p>
                  <ul className="space-y-1">
                    {pinned.triggers.map((t) => (
                      <li
                        key={t.line}
                        className={clsx("font-mono text-[11px] leading-snug", toneTextClass(t.tone))}
                      >
                        ▸ {t.line}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </article>

            {/* EVENT FEED — transition-only, newest on top. */}
            {feed.length > 0 ? (
              <div id="spx-largo-event-feed" className="spx-commentary-card">
                <p className="font-syne text-[10px] tracking-[0.2em] uppercase text-sky-300 mb-1">
                  Tape events
                </p>
                {feed.map((item) => (
                  <EventLine key={item.id} item={item} />
                ))}
              </div>
            ) : (
              <p className="font-mono text-[10px] text-white/40 p-3 text-center">
                Quiet tape — nothing changed since the read above.
              </p>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

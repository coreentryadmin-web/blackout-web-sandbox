"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { fetchSpxPlay } from "@/lib/api";
import { buildPlaybookTerminalLines } from "@/features/spx/lib/spx-play-terminal-lines";
import type { PlayTerminalLine } from "@/features/spx/lib/spx-play-terminal-lines";
import {
  buildPulseSnapshot,
  detectPulseSignals,
  filterFreshPulseSignals,
  wallEventToPulseSignal,
  PULSE_FEED_MAX,
  type PulseSnapshot,
  type PulseSignal,
  type PulseSignalTone,
} from "@/features/vector/lib/vector-pulse";
import type { VectorRegime } from "@/features/vector/lib/vector-regime";
import type { WallProximity } from "@/features/vector/lib/vector-wall-proximity";
import type { GammaMagnet } from "@/features/vector/lib/vector-gamma-magnet";
import type { WallIntegrity } from "@/features/vector/lib/vector-wall-integrity";
import type { VectorWallEvent } from "@/features/vector/lib/vector-wall-events";
import type { VectorWallLens } from "@/features/vector/lib/vector-wall-history";
import { normalizeVectorTicker } from "@/features/vector/lib/vector-ticker";
import { renderEmphasis } from "@/features/spx/lib/spx-emphasis";

type Props = {
  ticker: string;
  lens: VectorWallLens;
  wallEvents: VectorWallEvent[];
  liveSession: boolean;
  streamUpdatedAt?: number | null;
  regime: VectorRegime;
  proximity?: WallProximity | null;
  magnet?: GammaMagnet | null;
  confluence?: string[] | null;
  technicals?: string[];
  expectedMove?: string[];
  alerts?: string[];
  wallIntegrity?: { call: WallIntegrity | null; put: WallIntegrity | null };
  liveSpot?: number | null;
};

const TONE_LABELS: Record<PulseSignalTone, string> = {
  bull: "BULL",
  bear: "BEAR",
  warn: "WARN",
  info: "INFO",
};

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  const s = d.getSeconds().toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function fmtSpot(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function VectorPulse({
  ticker,
  lens,
  wallEvents,
  liveSession,
  streamUpdatedAt,
  regime,
  proximity,
  magnet,
  confluence,
  technicals,
  expectedMove,
  alerts,
  wallIntegrity,
  liveSpot,
}: Props) {
  const normalized = normalizeVectorTicker(ticker);
  const isSpx = normalized === "SPX";

  const [feed, setFeed] = useState<PulseSignal[]>([]);

  const prevSnapshotRef = useRef<PulseSnapshot | null>(null);
  const seenMapRef = useRef<Record<string, number>>({});
  const processedWallEventsRef = useRef(0);
  const feedRef = useRef<HTMLDivElement>(null);

  // Reset feed on ticker change.
  const prevTickerRef = useRef(normalized);
  useEffect(() => {
    if (prevTickerRef.current !== normalized) {
      setFeed([]);
      prevSnapshotRef.current = null;
      seenMapRef.current = {};
      processedWallEventsRef.current = 0;
      prevTickerRef.current = normalized;
    }
  }, [normalized]);

  // Detect transitions on every data tick.
  useEffect(() => {
    const now = streamUpdatedAt ?? Date.now();
    const integ = wallIntegrity ?? { call: null, put: null };

    const current = buildPulseSnapshot({
      at: now,
      regime,
      proximity: proximity ?? null,
      magnet: magnet ?? null,
      wallIntegrity: integ,
      wallEventCount: wallEvents.length,
    });

    const rawSignals: PulseSignal[] = detectPulseSignals(prevSnapshotRef.current, current);

    const newWallCount = wallEvents.length - processedWallEventsRef.current;
    if (newWallCount > 0) {
      const newEvents = wallEvents.slice(processedWallEventsRef.current);
      for (const ev of newEvents) {
        rawSignals.push(wallEventToPulseSignal(ev));
      }
      processedWallEventsRef.current = wallEvents.length;
    }

    if (rawSignals.length > 0) {
      const { fresh, seen } = filterFreshPulseSignals(
        rawSignals,
        seenMapRef.current,
        now
      );
      seenMapRef.current = seen;

      if (fresh.length > 0) {
        setFeed((prev) => [...fresh, ...prev].slice(0, PULSE_FEED_MAX));
      }
    }

    prevSnapshotRef.current = current;
  }, [regime, proximity, magnet, wallIntegrity, wallEvents, streamUpdatedAt]);

  // SPX playbook (carried forward from old terminal — SPX gets the linked playbook).
  const { data: spxPlay } = useSWR(
    isSpx && liveSession ? "vector-spx-playbook" : null,
    fetchSpxPlay,
    { refreshInterval: liveSession ? 1_000 : 0, revalidateOnFocus: false, revalidateOnReconnect: false }
  );

  const playbookLines: PlayTerminalLine[] | null = useMemo(() => {
    if (!isSpx || !spxPlay?.playbook_shadow) return null;
    return buildPlaybookTerminalLines(spxPlay.playbook_shadow, liveSession).slice(1);
  }, [isSpx, spxPlay, liveSession]);

  // Regime tone class.
  const regimeToneClass =
    regime.posture === "long" ? "vp-tone-bull"
      : regime.posture === "short" ? "vp-tone-bear"
        : regime.posture === "transition" ? "vp-tone-warn"
          : "vp-tone-muted";

  return (
    <div className="vector-pulse" role="complementary" aria-label={`Vector Pulse for ${normalized}`}>
      {/* ── REGIME STRIP ── */}
      <div className="vp-regime-strip">
        <div className="vp-regime-header">
          <span className="vp-ticker">{normalized}</span>
          <span className={`vp-regime-badge ${regimeToneClass}`}>{regime.headline}</span>
          {liveSession && streamUpdatedAt && (
            <span className="vp-live-dot" title="Live">
              <span className="vp-live-dot-ping" />
              <span className="vp-live-dot-core" />
            </span>
          )}
        </div>
        <p className="vp-regime-read">{regime.read}</p>
        {liveSpot != null && liveSpot > 0 && (
          <div className="vp-spot-row">
            <span className="vp-spot-label">SPOT</span>
            <span className="vp-spot-value">{fmtSpot(liveSpot)}</span>
          </div>
        )}
      </div>

      {/* ── PROXIMITY ALERT ── */}
      {proximity && (
        <div className={`vp-proximity ${proximity.nearness === "at" ? "vp-tone-warn" : "vp-tone-info"}`}>
          <span className="vp-proximity-badge">{proximity.nearness.toUpperCase()}</span>
          <span className="vp-proximity-text">{proximity.callout}</span>
        </div>
      )}

      {/* ── SIGNAL FEED ── */}
      <div className="vp-feed" ref={feedRef}>
        <div className="vp-feed-header">
          <span className="vp-feed-title">SIGNALS</span>
          <span className="vp-feed-count">{feed.length}</span>
        </div>
        {feed.length === 0 ? (
          <div className="vp-feed-empty">Watching for transitions{liveSession ? "..." : " — session closed"}</div>
        ) : (
          <div className="vp-feed-list">
            {feed.map((sig, i) => (
              <div key={`${sig.key}-${sig.at}-${i}`} className="vp-signal">
                <span className={`vp-signal-tone vp-tone-${sig.tone}`}>{TONE_LABELS[sig.tone]}</span>
                <span className="vp-signal-time">{formatTimestamp(sig.at)}</span>
                <span className="vp-signal-line">{sig.line}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── INTEL SECTIONS ── */}
      <div className="vp-intel">
        {/* Magnet */}
        {magnet && (
          <div className="vp-intel-row">
            <span className="vp-intel-icon">⬡</span>
            <span className={`vp-intel-text ${magnet.posture === "short" ? "vp-tone-warn" : ""}`}>
              {renderEmphasis(magnet.callout)}
            </span>
          </div>
        )}

        {/* Confluence */}
        {confluence && confluence.length > 0 && (
          <div className="vp-intel-section">
            <div className="vp-intel-section-header">CONFLUENCE</div>
            {confluence.map((c, i) => (
              <div key={i} className="vp-intel-row">
                <span className="vp-intel-icon">▸</span>
                <span className="vp-intel-text">{renderEmphasis(c)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Wall integrity */}
        {lens === "gex" && wallIntegrity && (
          <>
            {[wallIntegrity.call, wallIntegrity.put].filter(Boolean).map((wi) => (
              <div key={wi!.side} className="vp-intel-row">
                <span className="vp-intel-icon">▸</span>
                <span className={`vp-intel-text ${wi!.tier === "thin" ? "vp-tone-warn" : wi!.tier === "firm" ? "vp-tone-bull" : ""}`}>
                  {renderEmphasis(`${wi!.note} · ${wi!.score}/100`)}
                </span>
              </div>
            ))}
          </>
        )}

        {/* Technicals */}
        {technicals && technicals.length > 0 && (
          <div className="vp-intel-section">
            <div className="vp-intel-section-header">TECHNICALS</div>
            {technicals.map((t, i) => (
              <div key={i} className="vp-intel-row">
                <span className="vp-intel-icon">▸</span>
                <span className="vp-intel-text">{renderEmphasis(t)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Expected move */}
        {expectedMove && expectedMove.length > 0 && (
          <div className="vp-intel-section">
            <div className="vp-intel-section-header">EXPECTED MOVE</div>
            {expectedMove.map((e, i) => (
              <div key={i} className="vp-intel-row">
                <span className="vp-intel-icon">▸</span>
                <span className="vp-intel-text">{renderEmphasis(e)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Alerts */}
        {alerts && alerts.length > 0 && (
          <div className="vp-intel-section">
            <div className="vp-intel-section-header">ALERTS</div>
            {alerts.map((a, i) => (
              <div key={i} className="vp-intel-row">
                <span className="vp-intel-icon">▸</span>
                <span className="vp-intel-text vp-tone-bull">{renderEmphasis(a)}</span>
              </div>
            ))}
          </div>
        )}

        {/* SPX playbook (linked monitor) */}
        {playbookLines && playbookLines.length > 0 && (
          <div className="vp-intel-section">
            <div className="vp-intel-section-header">SPX PLAYBOOK</div>
            {playbookLines.map((line, i) => (
              <div key={i} className={`vp-intel-row vp-pb-${line.tone}`} style={{ paddingLeft: (line.indent ?? 0) * 12 }}>
                <span className="vp-intel-icon">{PB_ICON[line.icon] ?? "▸"}</span>
                <span className="vp-intel-text">{renderEmphasis(line.text)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const PB_ICON: Record<string, string> = {
  prompt: "❯", section: "◆", ok: "✓", no: "✕", vwap: "▲", flow: "◎",
  gamma: "⬡", level: "▸", news: "▪", trim: "✂", sell: "⏹", watch: "◉",
  dim: "·", pulse: "●",
};

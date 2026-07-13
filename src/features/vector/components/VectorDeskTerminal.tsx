"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { fetchSpxPlay } from "@/lib/api";
import { PlayTerminalWindow } from "@/components/terminal/PlayTerminalWindow";
import { buildPlaybookTerminalLines } from "@/features/spx/lib/spx-play-terminal-lines";
import { buildVectorTerminalLines, buildVectorPlayLines } from "@/features/vector/lib/vector-terminal-lines";
import type { VectorPlay } from "@/features/vector/lib/vector-play-engine";
import type { VectorWallEvent } from "@/features/vector/lib/vector-wall-events";
import type { VectorWallLens } from "@/features/vector/lib/vector-wall-history";
import type { WallProximity } from "@/features/vector/lib/vector-wall-proximity";
import type { GammaMagnet } from "@/features/vector/lib/vector-gamma-magnet";
import type { WallIntegrity } from "@/features/vector/lib/vector-wall-integrity";
import type { PlayTerminalLine } from "@/features/spx/lib/spx-play-terminal-lines";
import { normalizeVectorTicker } from "@/features/vector/lib/vector-ticker";

type Props = {
  ticker: string;
  lens: VectorWallLens;
  wallEvents: VectorWallEvent[];
  liveSession: boolean;
  streamUpdatedAt?: number | null;
  /** The synthesized top-of-terminal PLAY — rendered as the bold hero block above the live narration. */
  play?: VectorPlay | null;
  proximity?: WallProximity | null;
  magnet?: GammaMagnet | null;
  /** Ranked confluence callouts (pre-formatted by the chart's emit) — null when no zones. */
  confluence?: string[] | null;
  /** Always-on technicals lines (VWAP/EMA/RSI/MACD/pocket/structure) — narrated even with the chart
   *  overlays toggled OFF. Empty while warming up. Pre-formatted by the chart (which knows spot). */
  technicals?: string[];
  /** Options-implied EXPECTED MOVE lines (±1σ/2σ range for the horizon). Empty when no real ATM IV. */
  expectedMove?: string[];
  /** Recent fired-alert messages (newest first) for the ALERTS section. Empty when none have fired. */
  alerts?: string[];
  wallIntegrity?: { call: WallIntegrity | null; put: WallIntegrity | null };
};

/**
 * Vector side terminal — SPX shows full playbook monitor; other tickers show structure events.
 */
export function VectorDeskTerminal({
  ticker,
  lens,
  wallEvents,
  liveSession,
  streamUpdatedAt,
  play,
  proximity,
  magnet,
  confluence,
  technicals,
  expectedMove,
  alerts,
  wallIntegrity,
}: Props) {
  const normalized = normalizeVectorTicker(ticker);
  const isSpx = normalized === "SPX";

  const { data: spxPlay, error: spxPlayError } = useSWR(
    isSpx && liveSession ? "vector-spx-playbook" : null,
    fetchSpxPlay,
    {
      refreshInterval: liveSession ? 3_000 : 0,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );

  const lines = useMemo(() => {
    let base: PlayTerminalLine[];
    // A persistently failing playbook fetch must not silently degrade to the
    // structure-events view looking like "no playbook activity" — surface it.
    if (isSpx && liveSession && spxPlayError && !spxPlay) {
      base = [
        { icon: "section", tone: "accent", text: "VECTOR · SPX — linked playbook monitor" },
        { icon: "no", tone: "warn", text: "playbook feed unavailable — retrying", indent: 1 },
        ...buildVectorTerminalLines(normalized, lens, wallEvents, liveSession).slice(1),
      ];
    } else if (isSpx && spxPlay?.playbook_shadow) {
      const pb = buildPlaybookTerminalLines(spxPlay.playbook_shadow, liveSession);
      base = [
        { icon: "section", tone: "accent", text: "VECTOR · SPX — linked playbook monitor" },
        ...pb.slice(1),
      ];
    } else {
      base = buildVectorTerminalLines(normalized, lens, wallEvents, liveSession);
    }
    // Inject the live intelligence lines right under the header — the "what
    // matters right now" block: wall-proximity pulse, then the gamma magnet
    // (dealer-hedging center of mass). Each is absent when there's nothing real
    // to say (spot in open space / no gamma structure) — never a filler line.
    const intel: PlayTerminalLine[] = [];
    if (proximity) {
      intel.push({
        icon: "pulse",
        tone: proximity.nearness === "at" ? "warn" : "accent",
        text: proximity.callout,
        indent: 1,
      });
    }
    if (magnet) {
      intel.push({
        icon: "gamma",
        // A short-gamma "pivot" is a risk (acceleration), a long-gamma magnet is a
        // stabilizer — tone them differently so the read matches the flow.
        tone: magnet.posture === "short" ? "warn" : "accent",
        text: magnet.callout,
        indent: 1,
      });
    }
    // CONFLUENCE — where several INDEPENDENT levels stack (walls, flip, max pain, golden
    // pocket, session/prior-day levels). Ranked by the pure engine; absent when nothing stacks,
    // never a filler line. The strings arrive pre-formatted from the chart (which knows spot).
    if (confluence?.length) {
      intel.push({ icon: "section", tone: "accent", text: "CONFLUENCE — stacked levels", indent: 1 });
      for (const c of confluence) {
        intel.push({ icon: "level", tone: "accent", text: c, indent: 2 });
      }
    }
    // Wall-integrity confidence for the two levels the desk reads first. A "thin"
    // wall is a warning (don't over-trust it); "firm" is confirmation. Only shown
    // on the GEX lens (integrity is a gamma-wall measure, not a vanna one).
    if (lens === "gex" && wallIntegrity) {
      for (const wi of [wallIntegrity.call, wallIntegrity.put]) {
        if (!wi) continue;
        intel.push({
          icon: "level",
          tone: wi.tier === "thin" ? "warn" : wi.tier === "firm" ? "bull" : "neutral",
          text: `${wi.note} · ${wi.score}/100`,
          indent: 1,
        });
      }
    }
    // TECHNICALS — the trend/momentum read (VWAP, EMA stack, RSI, MACD, golden pocket, structure),
    // narrated CONTINUOUSLY even when the member hasn't toggled those overlays on the chart. The
    // chart computes it from the shown bars regardless of the enabled-overlay set; empty = warming up.
    if (technicals?.length) {
      intel.push({ icon: "section", tone: "accent", text: "TECHNICALS — trend & momentum", indent: 1 });
      for (const t of technicals) {
        intel.push({ icon: "level", tone: "neutral", text: t, indent: 2 });
      }
    }
    // EXPECTED MOVE — the options-implied ±1σ/2σ range the chain is pricing through the horizon's
    // front expiry (the "box" price is likely to stay in). Absent when there's no real ATM IV to
    // price it (never a fabricated band). Horizon-scoped, so it re-sizes with the DTE toggle.
    if (expectedMove?.length) {
      intel.push({ icon: "section", tone: "accent", text: "EXPECTED MOVE — options-implied range", indent: 1 });
      for (const e of expectedMove) {
        intel.push({ icon: "level", tone: "accent", text: e, indent: 2 });
      }
    }
    // ALERTS — the member's rules that FIRED (price touched a wall / crossed the flip). Newest first,
    // tone 'bull' so they stand out. Empty until something fires. (In-page delivery, slice 1b.)
    if (alerts?.length) {
      intel.push({ icon: "section", tone: "accent", text: "ALERTS — fired", indent: 1 });
      for (const a of alerts) {
        intel.push({ icon: "level", tone: "bull", text: `🔔 ${a}`, indent: 2 });
      }
    }
    // The synthesized PLAY is the HERO block — it leads, right under the window header (base[0]) and
    // ABOVE the live narration (intel) + the structure feed (base.slice(1)). Empty when there's no
    // play yet, so the terminal degrades to exactly its prior layout.
    const playLines = buildVectorPlayLines(play ?? null);
    if (playLines.length || intel.length) return [base[0]!, ...playLines, ...intel, ...base.slice(1)];
    return base;
  }, [isSpx, spxPlay, spxPlayError, liveSession, normalized, lens, wallEvents, play, proximity, magnet, confluence, technicals, expectedMove, alerts, wallIntegrity]);

  const cmd = isSpx ? "playbook --spx --vector-desk" : `vector --ticker ${normalized} --structure`;

  return (
    <PlayTerminalWindow
      title={`blackout — ${normalized} terminal`}
      host="blackout-vector"
      cmd={cmd}
      lines={lines}
      live={liveSession}
      asOf={streamUpdatedAt ? new Date(streamUpdatedAt).toISOString() : spxPlay?.as_of ?? null}
      ariaLabel={`Vector terminal for ${normalized}`}
      className="vector-desk-terminal"
    />
  );
}

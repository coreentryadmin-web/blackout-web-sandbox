"use client";

import { useState } from "react";
import { Badge, FreshnessChip } from "@/components/ui";
import { PlaybookPlayRow } from "./PlaybookPlayRow";
import { HawkRecordStrip } from "./HawkRecordStrip";
import type {
  NightHawkEdition,
  NightHawkRecordResponse,
  PlaybookPlay,
  PlayMorningStatus,
} from "@/lib/nighthawk/types";

type PlaybookBoardProps = {
  edition: NightHawkEdition | undefined;
  loading?: boolean;
  editionError?: string;
  onPlaySelect?: (play: PlaybookPlay) => void;
  confirmByTicker?: Map<string, PlayMorningStatus>;
  playStatusAvailable?: boolean;
  record?: NightHawkRecordResponse;
  recordLoading?: boolean;
};

const SLOT_COUNT = 5;

function formatEditionDate(editionFor: string | null | undefined): string | null {
  if (!editionFor) return null;
  const iso = String(editionFor).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function editionHasRecapContent(edition: NightHawkEdition | undefined): boolean {
  if (!edition) return false;
  if (edition.recap_headline?.trim()) return true;
  if (edition.recap_summary?.trim()) return true;
  if (edition.market_recap && Object.keys(edition.market_recap).length > 0) return true;
  return false;
}

function MarketContextBar({ recap }: { recap: Record<string, unknown> }) {
  const items: Array<{ label: string; value: string }> = [];
  if (typeof recap.tide === "string") items.push({ label: "Tide", value: recap.tide });
  if (typeof recap.spx_vix === "string") items.push({ label: "SPX/VIX", value: recap.spx_vix });
  if (typeof recap.sector_strength === "string") items.push({ label: "Leaders", value: recap.sector_strength });
  if (typeof recap.sector_weakness === "string") items.push({ label: "Laggards", value: recap.sector_weakness });

  if (!items.length) return null;

  return (
    <div className="nighthawk-market-context" role="region" aria-label="Market context">
      {items.map((item) => (
        <div key={item.label} className="nighthawk-market-context-item">
          <span className="nighthawk-market-context-label">{item.label}</span>
          <span className="nighthawk-market-context-value">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

export function PlaybookBoard({
  edition,
  loading,
  editionError,
  onPlaySelect,
  confirmByTicker,
  playStatusAvailable,
  record,
  recordLoading,
}: PlaybookBoardProps) {
  const [recapOpen, setRecapOpen] = useState(false);
  const plays = edition?.plays ?? [];
  const hasPlays = plays.length > 0;
  const hasRecap = editionHasRecapContent(edition);
  const showRecapState = (Boolean(edition?.available) || hasRecap) && !hasPlays;
  const editionLabel = formatEditionDate(edition?.edition_for);
  const isStale = Boolean(edition?.stale);
  const isDegraded = Boolean(edition?.degraded);
  const carryUntilClose = Boolean(edition?.carry_until_close);
  const servedForLabel = formatEditionDate(edition?.served_for ?? edition?.edition_for);
  const showFreshBadge = hasPlays && !isStale && !isDegraded;
  const showBuildSlots = !hasPlays;

  const morningSummary = playStatusAvailable
    ? Array.from(confirmByTicker?.values() ?? []).reduce(
        (acc, p) => {
          if (p.status === "CONFIRMED") acc.confirmed += 1;
          else if (p.status === "DEGRADED") acc.degraded += 1;
          else if (p.status === "INVALIDATED") acc.invalidated += 1;
          else if (p.status === "UNVERIFIED") acc.unverified += 1;
          return acc;
        },
        { confirmed: 0, degraded: 0, invalidated: 0, unverified: 0 }
      )
    : null;

  const freshnessStatus = loading
    ? ("syncing" as const)
    : showFreshBadge || showRecapState
      ? ("live" as const)
      : isStale
        ? ("stale" as const)
        : ("offline" as const);

  return (
    <section
      key={`nh-board-${plays.length}`}
      className={`nighthawk-playbook${hasPlays && !isStale ? " vitals-nh-border-pulse" : ""}`}
    >
      <header className="nighthawk-playbook-header">
        <div className="nighthawk-playbook-header-main">
          <div className="nighthawk-playbook-title-row">
            <p className="nighthawk-playbook-kicker">Tonight&apos;s playbook</p>
            {hasPlays && (
              <span className="nighthawk-play-fill">
                {plays.length} of {SLOT_COUNT} ranked
              </span>
            )}
          </div>
          <h2 className="nighthawk-playbook-title">
            {editionLabel ? `For ${editionLabel}` : "Next session"}
          </h2>
          {edition?.recap_headline && (
            <p className="nighthawk-playbook-headline">{edition.recap_headline}</p>
          )}
        </div>

        <div className="nighthawk-playbook-header-meta">
          {!loading && edition?.published_at && (
            <FreshnessChip
              status={freshnessStatus}
              asOf={new Date(edition.published_at)}
            />
          )}
          {loading ? (
            <Badge tone="sky">Syncing…</Badge>
          ) : isStale ? (
            <Badge tone="sky">Prior edition</Badge>
          ) : isDegraded ? (
            <Badge tone="sky">Legacy source</Badge>
          ) : showFreshBadge ? (
            <Badge tone="bull" dot>
              Edition live
            </Badge>
          ) : showRecapState ? (
            <Badge tone="sky" dot>
              Recap live
            </Badge>
          ) : (
            <Badge tone="sky">Awaiting close</Badge>
          )}
        </div>
      </header>

      {editionError && !edition && !loading && (
        <div
          className="mb-4 rounded border border-rose-400/35 bg-rose-400/10 px-4 py-3 font-mono text-xs text-rose-200"
          role="alert"
        >
          {editionError}
        </div>
      )}

      <HawkRecordStrip record={record} loading={recordLoading} />

      {edition?.market_recap && typeof edition.market_recap === "object" && (
        <MarketContextBar recap={edition.market_recap} />
      )}

      {morningSummary && hasPlays && (
        <div className="nighthawk-morning-summary" role="status">
          <span className="nighthawk-morning-summary-label">Pre-market</span>
          <span>
            {morningSummary.confirmed} confirmed
            {morningSummary.degraded ? ` · ${morningSummary.degraded} degraded` : ""}
            {morningSummary.invalidated ? ` · ${morningSummary.invalidated} invalidated` : ""}
            {morningSummary.unverified ? ` · ${morningSummary.unverified} unverified` : ""}
          </span>
        </div>
      )}

      {isStale && (
        <p className="nighthawk-playbook-notice" role="status">
          Showing {servedForLabel ?? "the last published"} edition — tonight&apos;s playbook isn&apos;t
          published yet. Levels may no longer be current.
        </p>
      )}
      {carryUntilClose && (
        <p className="nighthawk-playbook-notice" role="status">
          Today&apos;s generated plays stay live until the session close. Tomorrow&apos;s board takes over after
          the cash close.
        </p>
      )}
      {isDegraded && (
        <p className="nighthawk-playbook-notice" role="status">
          Served from a degraded fallback — treat as provisional until tonight&apos;s edition publishes.
        </p>
      )}

      {edition?.recap_summary && (
        <div className="nighthawk-recap-block">
          <button
            type="button"
            className="nighthawk-recap-toggle"
            onClick={() => setRecapOpen((o) => !o)}
            aria-expanded={recapOpen}
          >
            {recapOpen ? "Hide market recap" : "Show market recap"}
          </button>
          {(recapOpen || !hasPlays) && (
            <p className="nighthawk-playbook-recap">{edition.recap_summary}</p>
          )}
        </div>
      )}

      {hasPlays && (
        <p className="nighthawk-playbook-hint">Select a play for the full Hawk Intel briefing</p>
      )}

      {hasPlays ? (
        <div className="nighthawk-playbook-rows">
          {Array.from({ length: SLOT_COUNT }, (_, i) => {
            const play = plays[i];
            return (
              <PlaybookPlayRow
                key={play ? `${play.ticker}-${play.rank}` : `slot-${i + 1}`}
                rank={i + 1}
                play={play}
                empty={!play}
                morningConfirm={play ? confirmByTicker?.get(play.ticker.toUpperCase()) : undefined}
                onSelect={play && onPlaySelect ? () => onPlaySelect(play) : undefined}
              />
            );
          })}
        </div>
      ) : showBuildSlots ? (
        <div className="nighthawk-playbook-rows nighthawk-playbook-rows-building" role="status">
          {Array.from({ length: SLOT_COUNT }, (_, i) => (
            <PlaybookPlayRow
              key={`building-slot-${i + 1}`}
              rank={i + 1}
              empty
              emptyTitle="The Hawk is circling"
              emptyCopy={
                showRecapState
                  ? "No grounded plays cleared yet · tomorrow's tape is still under the lens"
                  : "Tomorrow's playbook is being forged from live tape"
              }
            />
          ))}
        </div>
      ) : (
        null
      )}
    </section>
  );
}

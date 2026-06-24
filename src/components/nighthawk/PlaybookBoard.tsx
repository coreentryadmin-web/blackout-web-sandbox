"use client";

import { Badge } from "@/components/ui";
import { PlaybookPlayRow } from "./PlaybookPlayRow";
import type { NightHawkEdition, PlaybookPlay } from "@/lib/nighthawk/types";

type PlaybookBoardProps = {
  edition: NightHawkEdition | undefined;
  loading?: boolean;
  onPlaySelect?: (play: PlaybookPlay) => void;
};

const SLOT_COUNT = 5;

export function PlaybookBoard({ edition, loading, onPlaySelect }: PlaybookBoardProps) {
  const plays = edition?.plays ?? [];
  const editionLabel = edition?.edition_for
    ? new Date(`${edition.edition_for}T12:00:00`).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : null;

  return (
    <section className="nighthawk-playbook">
      <header className="nighthawk-playbook-header">
        <div className="nighthawk-playbook-header-main">
          <p className="nighthawk-playbook-kicker">Tonight&apos;s playbook</p>
          <h2 className="nighthawk-playbook-title">
            {editionLabel ? `For ${editionLabel}` : "Next session"}
          </h2>
          {edition?.recap_headline && (
            <p className="nighthawk-playbook-headline">{edition.recap_headline}</p>
          )}
        </div>

        <div className="nighthawk-playbook-header-meta">
          {edition?.market_recap && (
            <div className="nighthawk-playbook-recap-grid">
              {typeof edition.market_recap.tide === "string" && (
                <span>Tide · {edition.market_recap.tide}</span>
              )}
              {typeof edition.market_recap.spx_vix === "string" && (
                <span>SPX/VIX · {edition.market_recap.spx_vix}</span>
              )}
              {typeof edition.market_recap.sector_strength === "string" && (
                <span>↑ {edition.market_recap.sector_strength}</span>
              )}
              {typeof edition.market_recap.sector_weakness === "string" && (
                <span>↓ {edition.market_recap.sector_weakness}</span>
              )}
            </div>
          )}
          {loading ? (
            <Badge tone="sky">Syncing…</Badge>
          ) : edition?.available ? (
            <Badge tone="bull" dot>
              Edition live
            </Badge>
          ) : (
            <Badge tone="bear">Awaiting close</Badge>
          )}
        </div>
      </header>

      {edition?.recap_summary && (
        <p className="nighthawk-playbook-recap">{edition.recap_summary}</p>
      )}

      <p className="nighthawk-playbook-hint">Click any play for full Hawk Intel briefing</p>

      <div className="nighthawk-playbook-rows">
        {Array.from({ length: SLOT_COUNT }, (_, i) => {
          const play = plays[i];
          return (
            <PlaybookPlayRow
              key={play ? `${play.ticker}-${play.rank}` : `slot-${i + 1}`}
              rank={i + 1}
              play={play}
              empty={!play}
              onSelect={play && onPlaySelect ? () => onPlaySelect(play) : undefined}
            />
          );
        })}
      </div>
    </section>
  );
}

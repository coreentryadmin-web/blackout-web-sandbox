"use client";

import type { NightHawkEdition } from "@/lib/nighthawk/types";
import { PlaybookPlayRow } from "./PlaybookPlayRow";

type PlaybookBoardProps = {
  edition: NightHawkEdition | undefined;
  loading?: boolean;
};

const SLOT_COUNT = 5;

export function PlaybookBoard({ edition, loading }: PlaybookBoardProps) {
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
        <div>
          <p className="nighthawk-playbook-kicker">Tonight&apos;s playbook</p>
          <h2 className="nighthawk-playbook-title">
            {editionLabel ? `For ${editionLabel}` : "Next session"}
          </h2>
          {edition?.recap_summary && (
            <p className="nighthawk-playbook-recap">{edition.recap_summary}</p>
          )}
        </div>
        <div className="nighthawk-playbook-status">
          {loading ? (
            <span className="nighthawk-status-pill nighthawk-status-loading">Syncing…</span>
          ) : edition?.available ? (
            <span className="nighthawk-status-pill nighthawk-status-live">
              <span className="nighthawk-status-dot" />
              Edition live
            </span>
          ) : (
            <span className="nighthawk-status-pill nighthawk-status-wait">Awaiting close</span>
          )}
        </div>
      </header>

      <div className="nighthawk-playbook-rows">
        {Array.from({ length: SLOT_COUNT }, (_, i) => {
          const play = plays[i];
          return (
            <PlaybookPlayRow
              key={play ? `${play.ticker}-${play.rank}` : `slot-${i + 1}`}
              rank={i + 1}
              play={play}
              empty={!play}
            />
          );
        })}
      </div>
    </section>
  );
}

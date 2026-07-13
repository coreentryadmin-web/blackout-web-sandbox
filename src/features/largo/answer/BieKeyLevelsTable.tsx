"use client";

import type { BieLevel } from "@/lib/bie/answer-envelope";
import { SourceStamp } from "./BieChips";

function formatPrice(price: number): string {
  // Round for display — several endpoints serve unrounded floats (7499.360000001).
  return price.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * Key-levels table (§6). One row per level with its price, optional note, and
 * provenance. Uses ARIA table roles (not a raw <table>) to match the terminal's
 * grid styling while staying screen-reader navigable.
 */
export function BieKeyLevelsTable({
  levels,
  label = "Key levels",
}: {
  levels: BieLevel[] | undefined;
  label?: string;
}) {
  if (!levels || levels.length === 0) return null;
  return (
    <div className="bie-levels">
      <p className="bie-block-label">{label}</p>
      <div className="bie-levels-grid" role="table" aria-label={label}>
        <div className="bie-levels-head" role="row">
          <span role="columnheader">Level</span>
          <span role="columnheader">Price</span>
          <span role="columnheader">Note</span>
        </div>
        {levels.map((l, i) => (
          <div className="bie-levels-row" role="row" key={`${l.label}-${i}`}>
            <span className="bie-levels-label" role="cell">
              {l.label}
            </span>
            <span className="bie-levels-price" role="cell">
              {formatPrice(l.price)}
            </span>
            <span className="bie-levels-note" role="cell">
              {l.note ? <span>{l.note}</span> : <span aria-hidden>—</span>}
              <SourceStamp provenance={l.provenance} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

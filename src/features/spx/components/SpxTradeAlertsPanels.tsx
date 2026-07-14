"use client";

import { clsx } from "clsx";
import type { SpxPlayPayload } from "@/features/spx/lib/spx-play-engine";
import type { LottoPlayPayload } from "@/features/spx/lib/spx-lotto-engine";
import type { PowerHourPlayPayload } from "@/features/spx/lib/spx-power-hour-engine";
import type { TradeAlertPlay } from "@/features/spx/lib/spx-trade-alert-plays";

type Props = {
  panels: { open: TradeAlertPlay[]; watch: TradeAlertPlay[]; closed: TradeAlertPlay[] };
  play: SpxPlayPayload | null;
  lotto: LottoPlayPayload | null;
  powerHour: PowerHourPlayPayload | null;
  selectedId: string | null;
  onSelectPlay: (id: string) => void;
};

function SelectablePlayRow({
  item,
  selected,
  subtitle,
  onSelect,
}: {
  item: TradeAlertPlay;
  selected: boolean;
  subtitle?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={clsx(
        "spx-play-select-row",
        `spx-play-select-row--${item.chip.kind}`,
        selected && "spx-play-select-row--selected"
      )}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span className="spx-play-select-kind">{item.chip.prefix}</span>
      <span className="spx-play-select-label">{item.chip.label}</span>
      {subtitle && <span className="spx-play-select-sub">{subtitle}</span>}
    </button>
  );
}

export function SpxTradeAlertsPanels({
  panels,
  play,
  lotto,
  powerHour,
  selectedId,
  onSelectPlay,
}: Props) {
  const stageHint = (item: TradeAlertPlay): string | undefined => {
    if (item.chip.column === "watch") {
      // Phase 2 ARM UI — surface primary shadow playbook on structure Watch rows.
      if (item.chip.kind === "structure" && play?.playbook_shadow) {
        const primary =
          play.playbook_shadow.verdicts.find((v) => v.primary) ??
          play.playbook_shadow.verdicts.find((v) => v.playbook_id === play.playbook_shadow?.primary_playbook_id);
        if (primary) {
          const st = primary.trigger_fired
            ? "FIRED"
            : primary.precondition_match && primary.session_window_open
              ? "ARMED"
              : primary.session_window_open
                ? "WATCH"
                : "IDLE";
          return `${primary.playbook_id} ${st}`;
        }
      }
      return "WATCH";
    }
    if (item.chip.column === "closed") return "CLOSED";
    if (item.chip.kind === "structure" && play) return play.action;
    if (item.chip.kind === "lotto" && lotto) return lotto.phase;
    if (item.chip.kind === "power" && powerHour) return powerHour.phase;
    return "OPEN";
  };

  const watchEmptyCopy = (() => {
    const primary = play?.playbook_shadow?.verdicts.find((v) => v.primary);
    if (primary && (primary.precondition_match || primary.session_window_open)) {
      return `Shadow: ${primary.playbook_id} ${primary.name}`;
    }
    return "Nothing armed.";
  })();

  const renderCol = (col: "open" | "watch" | "closed", items: TradeAlertPlay[], wide?: boolean) => (
    <section
      className={clsx(
        "spx-trade-alerts-panel-col",
        wide && "spx-trade-alerts-panel-col--open",
        col === "watch" && "spx-trade-alerts-panel-col--watch",
        col === "closed" && "spx-trade-alerts-panel-col--closed"
      )}
      aria-label={`${col} plays`}
    >
      <header className="spx-trade-alerts-panel-col-head">
        <h4>{col === "open" ? "Open" : col === "watch" ? "Watch" : "Closed"}</h4>
        <span className="spx-trade-alerts-panel-count">{items.length}</span>
      </header>
      <div className="spx-trade-alerts-panel-col-body">
        {items.length === 0 ? (
          <p className="spx-trade-alerts-panel-empty">
            {col === "open" ? "No open positions." : col === "watch" ? watchEmptyCopy : "No closed plays."}
          </p>
        ) : (
          items.map((item) => (
            <SelectablePlayRow
              key={item.id}
              item={item}
              selected={selectedId === item.id}
              subtitle={stageHint(item)}
              onSelect={() => onSelectPlay(item.id)}
            />
          ))
        )}
      </div>
    </section>
  );

  return (
    <div className="spx-trade-alerts-panels spx-trade-alerts-panels--stack">
      {renderCol("open", panels.open, true)}
      {renderCol("watch", panels.watch)}
      {renderCol("closed", panels.closed)}
    </div>
  );
}

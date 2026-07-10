import type { SpxPlayPayload } from "@/features/spx/lib/spx-play-engine";
import type { LottoPlayPayload } from "@/features/spx/lib/spx-lotto-engine";
import type { PowerHourPlayPayload } from "@/features/spx/lib/spx-power-hour-engine";
import { formatSpxContractLabel } from "@/features/spx/lib/spx-play-contract-label";

export type PlayKanbanKind = "structure" | "lotto" | "power";
export type PlayKanbanColumn = "open" | "watch" | "closed";
export type PlayKanbanFilter = "all" | PlayKanbanKind;

export type PlayKanbanChip = {
  id: string;
  column: PlayKanbanColumn;
  kind: PlayKanbanKind;
  label: string;
  prefix?: string;
  tone: "call" | "put" | "watch" | "closed" | "lotto" | "power" | "neutral";
};

type HistoryRow = SpxPlayPayload & { id: string };

function filterMatches(kind: PlayKanbanKind, filter: PlayKanbanFilter): boolean {
  return filter === "all" || filter === kind;
}

function structureStrikeChip(play: SpxPlayPayload): string | null {
  const raw =
    play.option_ticket?.contract_label ??
    play.open_play?.option_label ??
    null;
  const strike = play.levels.entry ?? play.open_play?.entry_price;
  const formatted = formatSpxContractLabel(raw, {
    strike: strike ?? 0,
    direction: play.direction,
  });
  if (formatted === "—" && strike == null) return null;
  return formatted;
}

function lottoChipLabel(lotto: LottoPlayPayload): string {
  return formatSpxContractLabel(lotto.contract_label, {
    strike: lotto.strike ?? 0,
    direction: lotto.direction,
  });
}

function powerChipLabel(power: PowerHourPlayPayload): string {
  const formatted = formatSpxContractLabel(power.contract_label, {
    strike: power.strike ?? 0,
    direction: power.direction,
  });
  if (formatted !== "—") return formatted;
  return power.phase;
}

function chipTone(
  kind: PlayKanbanKind,
  column: PlayKanbanColumn,
  direction?: string | null
): PlayKanbanChip["tone"] {
  if (column === "watch") return "watch";
  if (column === "closed") return "closed";
  if (kind === "lotto") return "lotto";
  if (kind === "power") return "power";
  if (direction === "short") return "put";
  if (direction === "long") return "call";
  return "neutral";
}

export function buildPlayKanbanChips(input: {
  play: SpxPlayPayload | null;
  lotto: LottoPlayPayload | null;
  powerHour: PowerHourPlayPayload | null;
  history: HistoryRow[];
  filter: PlayKanbanFilter;
  structureOpen: boolean;
  structureWatch: boolean;
  /** When false (AH / session wrapped), structure plays surface in Closed — not Open/Watch. */
  sessionLive?: boolean;
}): Record<PlayKanbanColumn, PlayKanbanChip[]> {
  const {
    play,
    lotto,
    powerHour,
    history,
    filter,
    structureOpen,
    structureWatch,
    sessionLive = true,
  } = input;
  const open: PlayKanbanChip[] = [];
  const watch: PlayKanbanChip[] = [];
  const closed: PlayKanbanChip[] = [];

  if (play && filterMatches("structure", filter)) {
    if (!sessionLive && play.action !== "SCANNING") {
      const label = structureStrikeChip(play) ?? play.action;
      closed.push({
        id: "structure-session",
        column: "closed",
        kind: "structure",
        label,
        prefix: "STR",
        tone: "closed",
      });
    } else if (structureOpen) {
      const label = structureStrikeChip(play);
      if (label) {
        open.push({
          id: "structure-open",
          column: "open",
          kind: "structure",
          label,
          prefix: "STR",
          tone: chipTone("structure", "open", play.direction),
        });
      }
    } else if (structureWatch) {
      const base = structureStrikeChip(play) ?? `Grade ${play.grade}`;
      const pb = play.playbook_shadow?.verdicts.find((v) => v.primary);
      const pbTag = pb ? ` · ${pb.playbook_id}` : "";
      const label = `${base}${pbTag}`;
      watch.push({
        id: "structure-watch",
        column: "watch",
        kind: "structure",
        label,
        prefix: "STR",
        tone: "watch",
      });
    } else if (play.action === "SELL") {
      const label = structureStrikeChip(play) ?? play.action;
      closed.push({
        id: "structure-sell",
        column: "closed",
        kind: "structure",
        label,
        prefix: "STR",
        tone: "closed",
      });
    }
  }

  if (lotto && filterMatches("lotto", filter)) {
    const lottoOpenPhase = lotto.phase === "BUY" || lotto.phase === "HOLD";
    const lottoWatchPhase = lotto.phase === "WATCH";
    const lottoClosedPhase = lotto.phase === "SELL" || lotto.phase === "INVALID";
    if (!sessionLive && (lottoOpenPhase || lottoWatchPhase)) {
      closed.push({
        id: "lotto-session",
        column: "closed",
        kind: "lotto",
        label: lottoChipLabel(lotto),
        prefix: "LOT",
        tone: "closed",
      });
    } else if (lottoOpenPhase) {
      open.push({
        id: "lotto-open",
        column: "open",
        kind: "lotto",
        label: lottoChipLabel(lotto),
        prefix: "LOT",
        tone: "lotto",
      });
    } else if (lottoWatchPhase) {
      watch.push({
        id: "lotto-watch",
        column: "watch",
        kind: "lotto",
        label: lottoChipLabel(lotto),
        prefix: "LOT",
        tone: "lotto",
      });
    } else if (lottoClosedPhase) {
      closed.push({
        id: "lotto-closed",
        column: "closed",
        kind: "lotto",
        label: lottoChipLabel(lotto),
        prefix: "LOT",
        tone: "closed",
      });
    }
  }

  if (powerHour && filterMatches("power", filter)) {
    const powerOpenPhase = powerHour.phase === "HOLD";
    const powerWatchPhase = powerHour.phase === "WATCH";
    if (!sessionLive && (powerOpenPhase || powerWatchPhase)) {
      closed.push({
        id: "power-session",
        column: "closed",
        kind: "power",
        label: powerChipLabel(powerHour),
        prefix: "PWR",
        tone: "closed",
      });
    } else if (powerOpenPhase) {
      open.push({
        id: "power-open",
        column: "open",
        kind: "power",
        label: powerChipLabel(powerHour),
        prefix: "PWR",
        tone: "power",
      });
    } else if (powerWatchPhase) {
      watch.push({
        id: "power-watch",
        column: "watch",
        kind: "power",
        label: powerChipLabel(powerHour),
        prefix: "PWR",
        tone: "power",
      });
    } else if (powerHour.phase === "SELL") {
      closed.push({
        id: "power-closed",
        column: "closed",
        kind: "power",
        label: powerChipLabel(powerHour),
        prefix: "PWR",
        tone: "closed",
      });
    }
  }

  if (play && filterMatches("structure", filter) && history.length > 1) {
    for (const row of history.slice(1, 8)) {
      const label = formatSpxContractLabel(row.open_play?.option_label, {
        strike: row.levels.entry ?? row.open_play?.entry_price ?? 0,
        direction: row.direction,
      });
      const fallback = label !== "—" ? label : row.action.slice(0, 4);
      closed.push({
        id: row.id,
        column: "closed",
        kind: "structure",
        label: fallback,
        prefix: "STR",
        tone: "closed",
      });
    }
  }

  return { open, watch, closed };
}

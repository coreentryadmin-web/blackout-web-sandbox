import type { SpxPlayPayload } from "@/features/spx/lib/spx-play-engine";
import type { LottoPlayPayload } from "@/features/spx/lib/spx-lotto-engine";
import type { PowerHourPlayPayload } from "@/features/spx/lib/spx-power-hour-engine";
import { buildPlayKanbanChips, type PlayKanbanChip } from "@/features/spx/lib/spx-play-kanban-chips";
import { formatSpxContractLabel } from "@/features/spx/lib/spx-play-contract-label";

export type TradeStageId = "hold" | "trim" | "sell";

export type TradeAlertPlay = {
  id: string;
  chip: PlayKanbanChip;
  /** Structure management stages — lotto/power use hold+sell only */
  stages: TradeStageId[];
  activeStage: TradeStageId;
  trimDone: boolean;
};

type HistoryRow = SpxPlayPayload & { id: string };

function structureStrikeLabel(play: SpxPlayPayload): string {
  return formatSpxContractLabel(
    play.option_ticket?.contract_label ?? play.open_play?.option_label,
    {
      strike: play.levels.entry ?? play.open_play?.entry_price ?? 0,
      direction: play.direction,
    }
  );
}

function structureActiveStage(play: SpxPlayPayload): TradeStageId {
  if (play.action === "SELL" || play.action === "SCANNING") return "sell";
  if (play.action === "TRIM" || play.open_play?.trim_done) return "trim";
  return "hold";
}

function lottoActiveStage(lotto: LottoPlayPayload): TradeStageId {
  if (lotto.phase === "SELL" || lotto.phase === "INVALID") return "sell";
  return "hold";
}

function powerActiveStage(power: PowerHourPlayPayload): TradeStageId {
  if (power.phase === "SELL") return "sell";
  return "hold";
}

function chipToTradePlay(
  chip: PlayKanbanChip,
  play: SpxPlayPayload | null,
  lotto: LottoPlayPayload | null,
  powerHour: PowerHourPlayPayload | null
): TradeAlertPlay {
  if (chip.kind === "structure" && play) {
    const active = structureActiveStage(play);
    return {
      id: chip.id,
      chip,
      stages: ["hold", "trim", "sell"],
      activeStage: chip.column === "closed" ? "sell" : active,
      trimDone: Boolean(play.open_play?.trim_done),
    };
  }
  if (chip.kind === "lotto" && lotto) {
    return {
      id: chip.id,
      chip,
      stages: ["hold", "sell"],
      activeStage: chip.column === "closed" ? "sell" : lottoActiveStage(lotto),
      trimDone: false,
    };
  }
  if (chip.kind === "power" && powerHour) {
    return {
      id: chip.id,
      chip,
      stages: ["hold", "sell"],
      activeStage: chip.column === "closed" ? "sell" : powerActiveStage(powerHour),
      trimDone: false,
    };
  }
  return {
    id: chip.id,
    chip,
    stages: ["hold", "sell"],
    activeStage: chip.column === "closed" ? "sell" : "hold",
    trimDone: false,
  };
}

export function buildTradeAlertPlays(input: {
  play: SpxPlayPayload | null;
  lotto: LottoPlayPayload | null;
  powerHour: PowerHourPlayPayload | null;
  history: HistoryRow[];
  structureOpen: boolean;
  structureWatch: boolean;
  sessionLive: boolean;
  /** Pinned structure snapshot — survives transient SCANNING polls */
  pinnedStructurePlay?: SpxPlayPayload | null;
}): {
  open: TradeAlertPlay[];
  watch: TradeAlertPlay[];
  closed: TradeAlertPlay[];
  structureLabel: string | null;
} {
  const {
    play,
    lotto,
    powerHour,
    history,
    structureOpen,
    structureWatch,
    sessionLive,
    pinnedStructurePlay,
  } = input;

  const displayPlay =
    play?.open_play && play.action !== "SELL"
      ? play
      : pinnedStructurePlay?.open_play && pinnedStructurePlay.action !== "SELL"
        ? pinnedStructurePlay
        : play;

  const cols = buildPlayKanbanChips({
    play: displayPlay,
    lotto,
    powerHour,
    history,
    filter: "all",
    structureOpen: structureOpen || Boolean(pinnedStructurePlay?.open_play && sessionLive),
    structureWatch,
    sessionLive,
  });

  const mapCol = (chips: PlayKanbanChip[]) =>
    chips.map((c) => chipToTradePlay(c, displayPlay, lotto, powerHour));

  return {
    open: mapCol(cols.open),
    watch: mapCol(cols.watch),
    closed: mapCol(cols.closed),
    structureLabel: displayPlay ? structureStrikeLabel(displayPlay) : null,
  };
}

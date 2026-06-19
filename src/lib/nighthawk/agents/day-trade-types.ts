import type { AgentFilterValues, HuntMode, HuntPlay } from "../types";

export const DAY_TRADE_AGENT_ID = "day-hawk" as const;

export type DayTradeSignalPhase = "CANDIDATE" | "WATCH" | "ACTIONABLE" | "EXPIRED";

export type DayTradeAgentConfig = {
  mode: Extract<HuntMode, "day">;
  filters: AgentFilterValues;
};

export type DayTradeSignal = HuntPlay & {
  phase: DayTradeSignalPhase;
  spx_aligned?: boolean;
};

export type DayTradeAgentRun = {
  id: string;
  started_at: string;
  completed_at: string | null;
  ok: boolean;
  message: string;
  signals: DayTradeSignal[];
  candidates: number;
  duration_ms: number;
  error?: string;
  spx_bias?: "bull" | "bear" | "neutral" | null;
};

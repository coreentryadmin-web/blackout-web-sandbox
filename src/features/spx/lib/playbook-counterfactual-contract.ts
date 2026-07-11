/**
 * Fixed counterfactual evaluation contract — underlying MFE/MAE for triggered-not-opened setups.
 *
 * Prevents longer-lived setups from mechanically inflating excursion vs opened trades.
 */
import type { PlaybookLifecycleState } from "@/features/spx/lib/playbook-trade-fsm";

export type CounterfactualExitReason =
  | "active"
  | "horizon_expired"
  | "setup_invalidated"
  | "trigger_expired"
  | "opened_superseded"
  | "session_end";

export type CounterfactualHorizonMode =
  | "until_invalidation_or_horizon"
  | "until_session_end";

export type CounterfactualEvalContract = {
  contract_version: 1;
  horizon_mode: CounterfactualHorizonMode;
  /** Underlying reference — trigger spot at episode fire (not option premium). */
  reference: "underlying_trigger_price";
  counterfactual_window_start_ms: number;
  counterfactual_window_end_ms: number | null;
  counterfactual_horizon_seconds: number;
  hypothetical_entry_price: number;
  hypothetical_stop: number | null;
  hypothetical_target: number | null;
  direction: "long" | "short";
  exit_reason_counterfactual: CounterfactualExitReason;
};

export function counterfactualHorizonSec(): number {
  const n = Number(process.env.PLAYBOOK_COUNTERFACTUAL_HORIZON_SEC ?? "900");
  return Number.isFinite(n) && n >= 60 ? Math.floor(n) : 900;
}

export function counterfactualHorizonMode(): CounterfactualHorizonMode {
  const raw = process.env.PLAYBOOK_COUNTERFACTUAL_HORIZON_MODE?.trim();
  return raw === "until_session_end" ? "until_session_end" : "until_invalidation_or_horizon";
}

/** RTH session end 16:00 ET — conservative cap for counterfactual window. */
export function sessionEndMsForDate(sessionDateYmd: string): number {
  return new Date(`${sessionDateYmd}T20:00:00.000Z`).getTime();
}

export function buildCounterfactualEvalContract(input: {
  session_date: string;
  direction: "long" | "short";
  trigger_price: number;
  triggered_at_ms: number;
  hypothetical_stop?: number | null;
  hypothetical_target?: number | null;
  now_ms?: number;
}): CounterfactualEvalContract {
  const now = input.now_ms ?? Date.now();
  const horizonSec = counterfactualHorizonSec();
  const horizonEnd = input.triggered_at_ms + horizonSec * 1000;
  const sessionEnd = sessionEndMsForDate(input.session_date);
  const mode = counterfactualHorizonMode();
  const capEnd = mode === "until_session_end" ? sessionEnd : Math.min(horizonEnd, sessionEnd);

  return {
    contract_version: 1,
    horizon_mode: mode,
    reference: "underlying_trigger_price",
    counterfactual_window_start_ms: input.triggered_at_ms,
    counterfactual_window_end_ms: null,
    counterfactual_horizon_seconds: horizonSec,
    hypothetical_entry_price: input.trigger_price,
    hypothetical_stop: input.hypothetical_stop ?? null,
    hypothetical_target: input.hypothetical_target ?? null,
    direction: input.direction,
    exit_reason_counterfactual: now >= capEnd ? "horizon_expired" : "active",
  };
}

export function counterfactualWindowCapEndMs(
  contract: CounterfactualEvalContract,
  sessionDateYmd: string
): number {
  const horizonEnd =
    contract.counterfactual_window_start_ms + contract.counterfactual_horizon_seconds * 1000;
  const sessionEnd = sessionEndMsForDate(sessionDateYmd);
  return contract.horizon_mode === "until_session_end"
    ? sessionEnd
    : Math.min(horizonEnd, sessionEnd);
}

export function isCounterfactualWindowActive(
  contract: CounterfactualEvalContract | null | undefined,
  nowMs: number,
  sessionDateYmd: string
): boolean {
  if (!contract) return false;
  if (contract.exit_reason_counterfactual !== "active") return false;
  if (contract.counterfactual_window_end_ms != null && nowMs >= contract.counterfactual_window_end_ms) {
    return false;
  }
  return nowMs < counterfactualWindowCapEndMs(contract, sessionDateYmd);
}

export function finalizeCounterfactualEval(
  contract: CounterfactualEvalContract,
  reason: CounterfactualExitReason,
  nowMs: number
): CounterfactualEvalContract {
  return {
    ...contract,
    counterfactual_window_end_ms: contract.counterfactual_window_end_ms ?? nowMs,
    exit_reason_counterfactual: reason,
  };
}

export function terminalStateCounterfactualReason(
  state: PlaybookLifecycleState
): CounterfactualExitReason | null {
  if (state === "invalidated") return "setup_invalidated";
  if (state === "expired") return "trigger_expired";
  if (state === "open" || state === "managing" || state === "closed") return "opened_superseded";
  return null;
}

export function parseCounterfactualEval(raw: unknown): CounterfactualEvalContract | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<CounterfactualEvalContract>;
  if (
    o.contract_version !== 1 ||
    o.counterfactual_window_start_ms == null ||
    o.hypothetical_entry_price == null ||
    (o.direction !== "long" && o.direction !== "short")
  ) {
    return null;
  }
  return o as CounterfactualEvalContract;
}

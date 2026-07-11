import type { PlaybookFeatureSnapshot } from "@/features/spx/lib/playbook-feature-snapshot";
import type { PlaybookId } from "@/features/spx/lib/playbook-registry";
import type { PlaybookInstanceTransition } from "@/features/spx/lib/playbook-state";
import type { PlaybookLifecycleState } from "@/features/spx/lib/playbook-trade-fsm";

export type PlaybookInstanceEventType =
  | "armed"
  | "triggered"
  | "blocked"
  | "entry_pending"
  | "invalidated"
  | "expired"
  | "cancelled"
  | "opened"
  | "managing"
  | "exit_pending"
  | "closed"
  | "counterfactual_tick";

export type PlaybookInstanceEventRow = {
  session_date: string;
  instance_id: string;
  playbook_id: PlaybookId;
  event_type: PlaybookInstanceEventType;
  direction: "long" | "short" | null;
  price_at_event: number | null;
  reason: string | null;
  gate_blocks: string[] | null;
  feature_snapshot: PlaybookFeatureSnapshot;
  engine_action: string | null;
  executable: boolean | null;
  counterfactual_mfe_pts: number | null;
  counterfactual_mae_pts: number | null;
};

export function lifecycleStateToEventType(
  state: PlaybookLifecycleState
): PlaybookInstanceEventType | null {
  const map: Partial<Record<PlaybookLifecycleState, PlaybookInstanceEventType>> = {
    armed: "armed",
    triggered: "triggered",
    blocked: "blocked",
    entry_pending: "entry_pending",
    invalidated: "invalidated",
    expired: "expired",
    cancelled: "cancelled",
    open: "opened",
    managing: "managing",
    exit_pending: "exit_pending",
    closed: "closed",
  };
  return map[state] ?? null;
}

export function transitionToEventType(
  toState: PlaybookInstanceTransition["to_state"]
): PlaybookInstanceEventType | null {
  return lifecycleStateToEventType(toState);
}

export function buildTransitionEvents(
  sessionDate: string,
  transitions: readonly PlaybookInstanceTransition[],
  snapshot: PlaybookFeatureSnapshot,
  engineAction: string,
  price: number | null
): PlaybookInstanceEventRow[] {
  const rows: PlaybookInstanceEventRow[] = [];
  for (const t of transitions) {
    const eventType = transitionToEventType(t.to_state);
    if (!eventType) continue;
    rows.push({
      session_date: sessionDate,
      instance_id: t.instance_id,
      playbook_id: t.playbook_id,
      event_type: eventType,
      direction: t.direction,
      price_at_event: price,
      reason: t.detail || `${t.from_state}→${t.to_state}`,
      gate_blocks: null,
      feature_snapshot: snapshot,
      engine_action: engineAction,
      executable:
        eventType === "triggered" || eventType === "entry_pending"
          ? null
          : eventType === "opened"
            ? true
            : eventType === "blocked" || eventType === "cancelled"
              ? false
              : null,
      counterfactual_mfe_pts: null,
      counterfactual_mae_pts: null,
    });
  }
  return rows;
}

export function buildBlockedPrimaryEvent(input: {
  session_date: string;
  instance_id: string;
  playbook_id: PlaybookId;
  direction: "long" | "short" | null;
  price: number | null;
  gate_blocks: readonly string[];
  snapshot: PlaybookFeatureSnapshot;
  engine_action: string;
}): PlaybookInstanceEventRow {
  return {
    session_date: input.session_date,
    instance_id: input.instance_id,
    playbook_id: input.playbook_id,
    event_type: "blocked",
    direction: input.direction,
    price_at_event: input.price,
    reason: input.gate_blocks.join("; "),
    gate_blocks: [...input.gate_blocks],
    feature_snapshot: input.snapshot,
    engine_action: input.engine_action,
    executable: false,
    counterfactual_mfe_pts: null,
    counterfactual_mae_pts: null,
  };
}

/** Update running counterfactual excursion for a triggered-but-not-opened instance. */
export function computeCounterfactualExcursion(
  direction: "long" | "short",
  triggerPrice: number,
  currentPrice: number,
  prevMfe: number,
  prevMae: number
): { mfe_pts: number; mae_pts: number } {
  const move = currentPrice - triggerPrice;
  const favorable = direction === "long" ? move : -move;
  const adverse = direction === "long" ? -move : move;
  return {
    mfe_pts: Math.max(prevMfe, Math.max(0, favorable)),
    mae_pts: Math.max(prevMae, Math.max(0, adverse)),
  };
}

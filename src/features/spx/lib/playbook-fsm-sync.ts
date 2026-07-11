import { buildPlaybookFeatureSnapshot } from "@/features/spx/lib/playbook-feature-snapshot";
import {
  buildTransitionEvents,
  type PlaybookInstanceEventType,
} from "@/features/spx/lib/playbook-instance-events";
import type { PlaybookId } from "@/features/spx/lib/playbook-registry";
import {
  engineFsmTransition,
  type PlaybookFsmTransition,
  type PlaybookLifecycleState,
} from "@/features/spx/lib/playbook-state-machine";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { PlayTechnicals } from "@/features/spx/lib/spx-play-technicals";
import {
  dbConfigured,
  insertPlaybookInstanceEvents,
  loadPlaybookInstanceStates,
  upsertPlaybookInstances,
} from "@/lib/db";

function fsmEventType(state: PlaybookLifecycleState): PlaybookInstanceEventType | null {
  if (state === "armed") return "armed";
  if (state === "triggered") return "triggered";
  if (state === "invalidated") return "invalidated";
  if (state === "open") return "opened";
  if (state === "managing") return "managing";
  if (state === "closed") return "closed";
  return null;
}

async function persistFsmTransitions(
  sessionDate: string,
  transitions: readonly PlaybookFsmTransition[],
  desk: SpxDeskPayload,
  technicals: PlayTechnicals | null,
  engineAction: string
): Promise<void> {
  if (!dbConfigured() || !transitions.length) return;

  const snapshot = buildPlaybookFeatureSnapshot(desk, technicals);

  await upsertPlaybookInstances(
    sessionDate,
    transitions.map((t) => ({
      instance_id: t.instance_id,
      playbook_id: t.playbook_id,
      direction: t.direction,
      state: t.to_state,
      feature_snapshot: snapshot,
      detail: t.detail,
      trigger_price: t.to_state === "triggered" && desk.price != null ? desk.price : null,
      reason_invalidated: t.to_state === "invalidated" ? t.detail : null,
    }))
  );

  const eventRows = transitions.flatMap((t) => {
    const eventType = fsmEventType(t.to_state);
    if (!eventType) return [];
    return [
      {
        session_date: sessionDate,
        instance_id: t.instance_id,
        playbook_id: t.playbook_id,
        event_type: eventType,
        direction: t.direction,
        price_at_event: desk.price ?? null,
        reason: `${t.from_state}→${t.to_state}: ${t.detail}`,
        gate_blocks: null,
        feature_snapshot: snapshot,
        engine_action: engineAction,
        executable: t.to_state === "open" ? true : t.to_state === "triggered" ? null : null,
        counterfactual_mfe_pts: null,
        counterfactual_mae_pts: null,
      },
    ];
  });

  if (eventRows.length) await insertPlaybookInstanceEvents(eventRows);
}

async function loadInstanceState(
  sessionDate: string,
  playbookId: PlaybookId
): Promise<PlaybookLifecycleState> {
  const states = await loadPlaybookInstanceStates(sessionDate);
  const row = states.find((s) => s.instance_id === `${sessionDate}:${playbookId}`);
  return row?.state ?? "idle";
}

/** Engine: TRIGGERED/ARMED → OPEN when play commits. */
export async function commitPlaybookInstanceOpen(input: {
  session_date: string;
  playbook_id: PlaybookId;
  direction: "long" | "short";
  desk: SpxDeskPayload;
  technicals: PlayTechnicals | null;
  detail?: string;
}): Promise<void> {
  const from = await loadInstanceState(input.session_date, input.playbook_id);
  const transition = engineFsmTransition(
    input.session_date,
    input.playbook_id,
    from,
    "open",
    input.direction,
    input.detail ?? "engine openPlay"
  );
  await persistFsmTransitions(
    input.session_date,
    [transition],
    input.desk,
    input.technicals,
    "BUY"
  );
}

/** Engine: OPEN → MANAGING on trim / active management. */
export async function commitPlaybookInstanceManaging(input: {
  session_date: string;
  playbook_id: PlaybookId;
  direction: "long" | "short";
  desk: SpxDeskPayload;
  technicals: PlayTechnicals | null;
  detail: string;
}): Promise<void> {
  const from = await loadInstanceState(input.session_date, input.playbook_id);
  if (from !== "open") return;
  const transition = engineFsmTransition(
    input.session_date,
    input.playbook_id,
    from,
    "managing",
    input.direction,
    input.detail
  );
  await persistFsmTransitions(input.session_date, [transition], input.desk, input.technicals, "TRIM");
}

/** Engine: OPEN/MANAGING → CLOSED on exit. */
export async function commitPlaybookInstanceClosed(input: {
  session_date: string;
  playbook_id: PlaybookId;
  direction: "long" | "short";
  desk: SpxDeskPayload;
  technicals: PlayTechnicals | null;
  exit_reason: string;
  exit_action: string;
}): Promise<void> {
  const from = await loadInstanceState(input.session_date, input.playbook_id);
  if (from !== "open" && from !== "managing") return;
  const transition = engineFsmTransition(
    input.session_date,
    input.playbook_id,
    from,
    "closed",
    input.direction,
    input.exit_reason
  );
  await persistFsmTransitions(
    input.session_date,
    [transition],
    input.desk,
    input.technicals,
    input.exit_action
  );
}

export { persistFsmTransitions };

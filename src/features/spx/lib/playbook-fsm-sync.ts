import { buildPlaybookFeatureSnapshot } from "@/features/spx/lib/playbook-feature-snapshot";
import { lifecycleStateToEventType } from "@/features/spx/lib/playbook-instance-events";
import type { PlaybookInstanceEventType } from "@/features/spx/lib/playbook-instance-events";
import {
  findActiveEpisodeInstanceId,
  parsePlaybookInstanceId,
  snapshotFromInstanceRow,
} from "@/features/spx/lib/playbook-instance-episode";
import type { PlaybookId } from "@/features/spx/lib/playbook-registry";
import {
  canEngineTransition,
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
  return lifecycleStateToEventType(state);
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
      trigger_price:
        (t.to_state === "triggered" || t.to_state === "blocked") && desk.price != null
          ? desk.price
          : null,
      reason_invalidated: t.to_state === "invalidated" ? t.detail : null,
      reason_blocked: t.to_state === "blocked" ? t.detail : null,
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
        gate_blocks: t.to_state === "blocked" ? [t.detail] : null,
        feature_snapshot: snapshot,
        engine_action: engineAction,
        executable:
          t.to_state === "open"
            ? true
            : t.to_state === "blocked" || t.to_state === "cancelled"
              ? false
              : null,
        counterfactual_mfe_pts: null,
        counterfactual_mae_pts: null,
      },
    ];
  });

  if (eventRows.length) await insertPlaybookInstanceEvents(eventRows);
}

async function loadActiveInstanceState(
  sessionDate: string,
  playbookId: PlaybookId,
  direction: "long" | "short"
): Promise<{ state: PlaybookLifecycleState; instance_id: string; episode_start_ms: number } | null> {
  const states = await loadPlaybookInstanceStates(sessionDate);
  const snapshots = states.map(snapshotFromInstanceRow);
  const instanceId = findActiveEpisodeInstanceId(snapshots, playbookId, direction);
  if (!instanceId) return null;
  const row = states.find((s) => s.instance_id === instanceId);
  if (!row) return null;
  const parsed = parsePlaybookInstanceId(instanceId);
  return {
    state: row.state,
    instance_id: instanceId,
    episode_start_ms: parsed.episode_start_ms || Date.now(),
  };
}

async function commitEngineTransition(input: {
  session_date: string;
  playbook_id: PlaybookId;
  direction: "long" | "short";
  desk: SpxDeskPayload;
  technicals: PlayTechnicals | null;
  to_state: PlaybookLifecycleState;
  detail: string;
  engine_action: string;
  fallback_from?: PlaybookLifecycleState;
}): Promise<void> {
  const active = await loadActiveInstanceState(
    input.session_date,
    input.playbook_id,
    input.direction
  );
  const from = active?.state ?? input.fallback_from ?? "triggered";
  if (!canEngineTransition(from, input.to_state)) return;
  const episodeMs = active?.episode_start_ms ?? Date.now();
  const transition = engineFsmTransition(
    input.session_date,
    input.playbook_id,
    from,
    input.to_state,
    input.direction,
    input.detail,
    episodeMs
  );
  await persistFsmTransitions(
    input.session_date,
    [transition],
    input.desk,
    input.technicals,
    input.engine_action
  );
}

/** Active playbook episode instance id for engine open/close correlation. */
export async function resolveActivePlaybookInstanceId(
  sessionDate: string,
  playbookId: PlaybookId,
  direction: "long" | "short"
): Promise<string | null> {
  const active = await loadActiveInstanceState(sessionDate, playbookId, direction);
  return active?.instance_id ?? null;
}

/** Engine: ticket generated — awaiting fill confirmation. */
export async function commitPlaybookInstanceEntryPending(input: {
  session_date: string;
  playbook_id: PlaybookId;
  direction: "long" | "short";
  desk: SpxDeskPayload;
  technicals: PlayTechnicals | null;
  detail?: string;
}): Promise<void> {
  await commitEngineTransition({
    ...input,
    to_state: "entry_pending",
    detail: input.detail ?? "option ticket generated",
    engine_action: "ENTRY_PENDING",
  });
}

/** Engine: entry aborted — illiquid contract, governor, or risk rejection. */
export async function commitPlaybookInstanceCancelled(input: {
  session_date: string;
  playbook_id: PlaybookId;
  direction: "long" | "short";
  desk: SpxDeskPayload;
  technicals: PlayTechnicals | null;
  reason: string;
}): Promise<void> {
  await commitEngineTransition({
    ...input,
    to_state: "cancelled",
    detail: input.reason,
    engine_action: "CANCELLED",
  });
}

/** Engine: TRIGGERED/ENTRY_PENDING → OPEN when play commits. */
export async function commitPlaybookInstanceOpen(input: {
  session_date: string;
  playbook_id: PlaybookId;
  direction: "long" | "short";
  desk: SpxDeskPayload;
  technicals: PlayTechnicals | null;
  detail?: string;
}): Promise<void> {
  await commitEngineTransition({
    ...input,
    to_state: "open",
    detail: input.detail ?? "engine openPlay",
    engine_action: "BUY",
    fallback_from: "entry_pending",
  });
}

/** Engine: setup invalidated while position open — exit required. */
export async function commitPlaybookInstanceExitPending(input: {
  session_date: string;
  playbook_id: PlaybookId;
  direction: "long" | "short";
  desk: SpxDeskPayload;
  technicals: PlayTechnicals | null;
  reason: string;
}): Promise<void> {
  await commitEngineTransition({
    ...input,
    to_state: "exit_pending",
    detail: input.reason,
    engine_action: "EXIT_PENDING",
  });
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
  await commitEngineTransition({
    ...input,
    to_state: "managing",
    detail: input.detail,
    engine_action: "TRIM",
  });
}

/** Engine: OPEN/MANAGING/EXIT_PENDING → CLOSED on exit. */
export async function commitPlaybookInstanceClosed(input: {
  session_date: string;
  playbook_id: PlaybookId;
  direction: "long" | "short";
  desk: SpxDeskPayload;
  technicals: PlayTechnicals | null;
  exit_reason: string;
  exit_action: string;
}): Promise<void> {
  await commitEngineTransition({
    session_date: input.session_date,
    playbook_id: input.playbook_id,
    direction: input.direction,
    desk: input.desk,
    technicals: input.technicals,
    to_state: "closed",
    detail: input.exit_reason,
    engine_action: input.exit_action,
  });
}

export { persistFsmTransitions };

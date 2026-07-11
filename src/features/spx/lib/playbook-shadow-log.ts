import {
  dbConfigured,
  getMeta,
  insertPlaybookInstanceEvents,
  insertPlaybookShadowObservation,
  loadPlaybookInstanceStates,
  loadTriggeredPlaybookInstances,
  patchPlaybookInstanceBlocked,
  patchPlaybookInstanceOpened,
  setMeta,
  syncPlaybookArmedPollCounts,
  updatePlaybookInstanceCounterfactual,
  upsertPlaybookInstances,
} from "@/lib/db";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { buildPlaybookFeatureSnapshot } from "@/features/spx/lib/playbook-feature-snapshot";
import {
  buildBlockedPrimaryEvent,
  buildTransitionEvents,
  computeCounterfactualExcursion,
} from "@/features/spx/lib/playbook-instance-events";
import { computePlaybookPipelineAudit } from "@/features/spx/lib/playbook-pipeline-audit";
import { resolveGuardedPlaybookMatch } from "@/features/spx/lib/playbook-match-resolver";
import { refreshOrBreakMemory } from "@/features/spx/lib/playbook-break-memory-store";
import type { PlaybookShadowPanel } from "@/features/spx/lib/playbook-shadow-panel";
import { snapshotFromInstanceRow } from "@/features/spx/lib/playbook-instance-episode";
import {
  collectPlaybookInstanceTransitions,
  findActiveEpisodeInstanceId,
} from "@/features/spx/lib/playbook-state";
import type { PlaybookId } from "@/features/spx/lib/playbook-registry";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { PlayTechnicals } from "@/features/spx/lib/spx-play-technicals";

const CURSOR_KEY = "spx_playbook_shadow_cursor";
const BLOCKED_CURSOR_KEY = "spx_playbook_blocked_cursor";

/** State key for throttle — primary + fired set + gate block fingerprint. */
export function playbookShadowStateKey(
  panel: PlaybookShadowPanel,
  gateBlocks?: readonly string[]
): string {
  const fired = panel.verdicts
    .filter((v) => v.trigger_fired)
    .map((v) => `${v.playbook_id}:${v.direction}`)
    .sort()
    .join(",");
  const blocks = gateBlocks?.length ? `|blocks:${gateBlocks.length}` : "";
  return `${panel.primary_playbook_id ?? "none"}|${fired}${blocks}`;
}

export type PlaybookShadowLogOpts = {
  technicals?: PlayTechnicals | null;
  gate_blocks?: readonly string[];
  primary_direction?: "long" | "short" | null;
  opened_direction?: "long" | "short" | null;
  primary_playbook_id?: PlaybookId | null;
  option_contract_candidate?: unknown;
  first_block_category?: string | null;
};

/**
 * Phase 1+ telemetry — logs playbook shadow transitions, blocked primaries, and
 * counterfactual MFE/MAE without affecting BUY.
 */
export async function maybeLogPlaybookShadowMatch(
  desk: SpxDeskPayload,
  panel: PlaybookShadowPanel | null,
  engine: { action: string; score: number },
  opts?: PlaybookShadowLogOpts
): Promise<void> {
  if (!dbConfigured() || !panel) return;

  const gateBlocks = opts?.gate_blocks ?? [];
  const key = playbookShadowStateKey(panel, gateBlocks);
  const prev = await getMeta(CURSOR_KEY);
  const stateChanged = prev !== key;

  const sessionDate = todayEtYmd();
  const orBreakMemory = await refreshOrBreakMemory(sessionDate, desk, opts?.technicals, false);
  const resolved =
    opts?.technicals?.available
      ? await resolveGuardedPlaybookMatch(sessionDate, desk, opts.technicals, {
          or_break_memory: orBreakMemory,
        })
      : null;
  const rawVerdicts = resolved
    ? resolved.verdicts
    : panel.verdicts.map((v) => ({
        playbook_id: v.playbook_id,
        session_window_open: v.session_window_open,
        regime_eligible: v.regime_eligible,
        precondition_match: v.precondition_match,
        trigger_fired: v.trigger_fired,
        direction: v.direction === "neutral" ? null : v.direction,
        detail: v.detail,
      }));

  const featureSnapshot = buildPlaybookFeatureSnapshot(desk, opts?.technicals);
  const pipelineAudit = computePlaybookPipelineAudit(rawVerdicts, {
    gate_blocks: gateBlocks,
    primary_direction: opts?.primary_direction ?? null,
    opened_direction: opts?.opened_direction ?? null,
  });

  const prevStates = await loadPlaybookInstanceStates(sessionDate);
  const snapshots = prevStates.map(snapshotFromInstanceRow);
  const primaryId =
    opts?.primary_playbook_id ?? panel.primary_playbook_id ?? null;
  const gateBlockedIds = new Set<string>();
  const primaryBlocked =
    primaryId != null &&
    gateBlocks.length > 0 &&
    rawVerdicts.some((v) => v.playbook_id === primaryId && v.trigger_fired);
  if (primaryBlocked && primaryId) {
    const blockedInstanceId = findActiveEpisodeInstanceId(
      snapshots,
      primaryId,
      opts?.primary_direction ?? null
    );
    if (blockedInstanceId) gateBlockedIds.add(blockedInstanceId);
  }

  const { transitions, nextByInstance } = collectPlaybookInstanceTransitions(
    sessionDate,
    rawVerdicts,
    snapshots,
    { gate_blocked_instance_ids: gateBlockedIds, now_ms: Date.now() }
  );

  const armedPollByInstance = resolved?.next_armed_poll_counts;

  if (transitions.length > 0) {
    await upsertPlaybookInstances(
      sessionDate,
      transitions.map((t) => ({
        instance_id: t.instance_id,
        playbook_id: t.playbook_id,
        direction: t.direction,
        state: t.to_state,
        feature_snapshot: featureSnapshot,
        detail: t.detail,
        trigger_price:
          t.to_state === "triggered" && desk.price != null ? desk.price : null,
        reason_invalidated: t.to_state === "invalidated" ? t.detail : null,
        armed_poll_count: armedPollByInstance?.get(t.instance_id) ?? null,
      }))
    );

    if (armedPollByInstance?.size) {
      await syncPlaybookArmedPollCounts(armedPollByInstance);
    }

    const eventRows = buildTransitionEvents(
      sessionDate,
      transitions,
      featureSnapshot,
      engine.action,
      desk.price ?? null
    );
    if (eventRows.length) {
      await insertPlaybookInstanceEvents(
        eventRows.map((e) => ({
          session_date: e.session_date,
          instance_id: e.instance_id,
          playbook_id: e.playbook_id,
          event_type: e.event_type,
          direction: e.direction,
          price_at_event: e.price_at_event,
          reason: e.reason,
          gate_blocks: e.gate_blocks,
          feature_snapshot: e.feature_snapshot,
          engine_action: e.engine_action,
          executable: e.executable,
          counterfactual_mfe_pts: e.counterfactual_mfe_pts,
          counterfactual_mae_pts: e.counterfactual_mae_pts,
        }))
      );
    }
  }

  if (primaryBlocked && primaryId) {
    const instanceId =
      findActiveEpisodeInstanceId(snapshots, primaryId, opts?.primary_direction ?? null) ??
      transitions.find((t) => t.playbook_id === primaryId)?.instance_id;
    if (instanceId) {
      const blockKey = `${instanceId}|${gateBlocks.join("||")}`;
      const prevBlocked = await getMeta(BLOCKED_CURSOR_KEY);
      if (prevBlocked !== blockKey) {
        const blockedEvent = buildBlockedPrimaryEvent({
          session_date: sessionDate,
          instance_id: instanceId,
          playbook_id: primaryId,
          direction: opts?.primary_direction ?? null,
          price: desk.price ?? null,
          gate_blocks: gateBlocks,
          snapshot: featureSnapshot,
          engine_action: engine.action,
        });
        await insertPlaybookInstanceEvents([
          {
            session_date: blockedEvent.session_date,
            instance_id: blockedEvent.instance_id,
            playbook_id: blockedEvent.playbook_id,
            event_type: blockedEvent.event_type,
            direction: blockedEvent.direction,
            price_at_event: blockedEvent.price_at_event,
            reason: blockedEvent.reason,
            gate_blocks: blockedEvent.gate_blocks,
            feature_snapshot: blockedEvent.feature_snapshot,
            engine_action: blockedEvent.engine_action,
            executable: blockedEvent.executable,
            counterfactual_mfe_pts: blockedEvent.counterfactual_mfe_pts,
            counterfactual_mae_pts: blockedEvent.counterfactual_mae_pts,
          },
        ]);
        await patchPlaybookInstanceBlocked({
          instance_id: instanceId,
          reason_blocked: gateBlocks.join("; "),
          executable: false,
        });
        await setMeta(BLOCKED_CURSOR_KEY, blockKey);
      }
    }
  }

  if (opts?.opened_direction && primaryId) {
    const openInstanceId =
      findActiveEpisodeInstanceId(snapshots, primaryId, opts.opened_direction) ??
      transitions.find((t) => t.playbook_id === primaryId)?.instance_id;
    if (openInstanceId) {
      await patchPlaybookInstanceOpened({
        instance_id: openInstanceId,
        option_contract_candidate: opts.option_contract_candidate ?? null,
        executable: true,
      });
      await insertPlaybookInstanceEvents([
        {
          session_date: sessionDate,
          instance_id: openInstanceId,
          playbook_id: primaryId,
          event_type: "opened",
          direction: opts.opened_direction,
          price_at_event: desk.price ?? null,
          reason: "engine open",
          gate_blocks: null,
          feature_snapshot: featureSnapshot,
          engine_action: engine.action,
          executable: true,
          counterfactual_mfe_pts: null,
          counterfactual_mae_pts: null,
        },
      ]);
    }
  }

  if (desk.price != null) {
    const triggered = await loadTriggeredPlaybookInstances(sessionDate);
    for (const row of triggered) {
      if (row.direction == null || row.trigger_price == null) continue;
      const { mfe_pts, mae_pts } = computeCounterfactualExcursion(
        row.direction,
        row.trigger_price,
        desk.price,
        row.counterfactual_mfe_pts,
        row.counterfactual_mae_pts
      );
      if (mfe_pts > row.counterfactual_mfe_pts || mae_pts > row.counterfactual_mae_pts) {
        await updatePlaybookInstanceCounterfactual(row.instance_id, mfe_pts, mae_pts);
      }
    }
  }

  if (!stateChanged) return;

  await insertPlaybookShadowObservation({
    session_date: sessionDate,
    primary_playbook_id: panel.primary_playbook_id,
    regime: desk.regime ?? null,
    gamma_regime: desk.gamma_regime ?? null,
    price_at_observation: desk.price ?? null,
    engine_action: engine.action,
    engine_score: engine.score,
    verdicts: panel.verdicts,
    pipeline_audit: pipelineAudit,
    feature_snapshot: featureSnapshot,
    instance_transitions: transitions,
    gate_blocks: gateBlocks.length ? gateBlocks : null,
    first_block_category: opts?.first_block_category ?? null,
  });
  await setMeta(CURSOR_KEY, key);

  void nextByInstance;
}

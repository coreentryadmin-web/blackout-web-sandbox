import {
  dbConfigured,
  getMeta,
  insertPlaybookShadowObservation,
  loadPlaybookInstanceStates,
  setMeta,
  upsertPlaybookInstances,
} from "@/lib/db";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { buildPlaybookFeatureSnapshot } from "@/features/spx/lib/playbook-feature-snapshot";
import { computePlaybookPipelineAudit } from "@/features/spx/lib/playbook-pipeline-audit";
import { matchPlaybooksShadow } from "@/features/spx/lib/playbook-shadow-matcher";
import type { PlaybookShadowPanel } from "@/features/spx/lib/playbook-shadow-panel";
import {
  collectPlaybookInstanceTransitions,
  type PlaybookLifecycleState,
} from "@/features/spx/lib/playbook-state";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { PlayTechnicals } from "@/features/spx/lib/spx-play-technicals";

const CURSOR_KEY = "spx_playbook_shadow_cursor";

/** State key for throttle — primary + which playbooks fired this tick. */
export function playbookShadowStateKey(panel: PlaybookShadowPanel): string {
  const fired = panel.verdicts
    .filter((v) => v.trigger_fired)
    .map((v) => `${v.playbook_id}:${v.direction}`)
    .sort()
    .join(",");
  return `${panel.primary_playbook_id ?? "none"}|${fired}`;
}

export type PlaybookShadowLogOpts = {
  technicals?: PlayTechnicals | null;
  gate_blocks?: readonly string[];
  primary_direction?: "long" | "short" | null;
  opened_direction?: "long" | "short" | null;
};

/**
 * Phase 1 telemetry — logs playbook shadow transitions without affecting BUY.
 * Throttled via platform_meta cursor (same idiom as maybeLogSpxEngineSnapshot).
 */
export async function maybeLogPlaybookShadowMatch(
  desk: SpxDeskPayload,
  panel: PlaybookShadowPanel | null,
  engine: { action: string; score: number },
  opts?: PlaybookShadowLogOpts
): Promise<void> {
  if (!dbConfigured() || !panel) return;

  const key = playbookShadowStateKey(panel);
  const prev = await getMeta(CURSOR_KEY);
  if (prev === key) return;

  const sessionDate = todayEtYmd();
  const rawVerdicts = opts?.technicals?.available
    ? matchPlaybooksShadow(desk, opts.technicals).verdicts
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
    gate_blocks: opts?.gate_blocks,
    primary_direction: opts?.primary_direction ?? null,
    opened_direction: opts?.opened_direction ?? null,
  });

  const prevStates = await loadPlaybookInstanceStates(sessionDate);
  const prevMap = new Map<string, PlaybookLifecycleState>(
    prevStates.map((r) => [r.instance_id, r.state])
  );
  const { transitions, nextByInstance } = collectPlaybookInstanceTransitions(
    sessionDate,
    rawVerdicts,
    prevMap
  );

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
      }))
    );
  }

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
  });
  await setMeta(CURSOR_KEY, key);

  void nextByInstance;
}

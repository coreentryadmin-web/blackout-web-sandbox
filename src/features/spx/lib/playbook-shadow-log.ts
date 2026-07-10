import {
  dbConfigured,
  getMeta,
  insertPlaybookShadowObservation,
  setMeta,
} from "@/lib/db";
import { todayEtYmd } from "@/lib/providers/spx-session";
import type { PlaybookShadowPanel } from "@/features/spx/lib/playbook-shadow-panel";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";

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

/**
 * Phase 1 telemetry — logs playbook shadow transitions without affecting BUY.
 * Throttled via platform_meta cursor (same idiom as maybeLogSpxEngineSnapshot).
 */
export async function maybeLogPlaybookShadowMatch(
  desk: SpxDeskPayload,
  panel: PlaybookShadowPanel | null,
  engine: { action: string; score: number }
): Promise<void> {
  if (!dbConfigured() || !panel) return;

  const key = playbookShadowStateKey(panel);
  const prev = await getMeta(CURSOR_KEY);
  if (prev === key) return;

  await insertPlaybookShadowObservation({
    session_date: todayEtYmd(),
    primary_playbook_id: panel.primary_playbook_id,
    regime: desk.regime ?? null,
    gamma_regime: desk.gamma_regime ?? null,
    price_at_observation: desk.price ?? null,
    engine_action: engine.action,
    engine_score: engine.score,
    verdicts: panel.verdicts,
  });
  await setMeta(CURSOR_KEY, key);
}

import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { PlayTechnicals } from "@/features/spx/lib/spx-play-technicals";
import { PLAYBOOK_REGISTRY, type PlaybookId } from "@/features/spx/lib/playbook-registry";
import { matchPlaybooksShadow, type PlaybookShadowMatchResult } from "@/features/spx/lib/playbook-shadow-matcher";
import { computePlaybookPipelineAudit, type PlaybookPipelineAudit } from "@/features/spx/lib/playbook-pipeline-audit";
import type { OrBreakMemory } from "@/features/spx/lib/playbook-break-memory";
import { playbookLiveGateEnabled } from "@/features/spx/lib/spx-play-config";

export type PlaybookShadowVerdictSummary = {
  playbook_id: PlaybookId;
  name: string;
  trigger_fired: boolean;
  precondition_match: boolean;
  session_window_open: boolean;
  regime_eligible: boolean;
  direction: "long" | "short" | "neutral";
  detail: string;
  primary: boolean;
};

export type PlaybookShadowPanel = {
  mode: "shadow" | "live";
  primary_playbook_id: PlaybookId | null;
  verdicts: PlaybookShadowVerdictSummary[];
  pipeline_audit: PlaybookPipelineAudit;
};

const NAME_BY_ID = Object.fromEntries(
  PLAYBOOK_REGISTRY.map((p) => [p.id, p.name])
) as Record<PlaybookId, string>;

/** Read-only shadow snapshot for member UI — does not affect play engine decisions. */
export function buildPlaybookShadowPanel(
  desk: SpxDeskPayload,
  technicals: PlayTechnicals | null | undefined,
  opts?: {
    or_break_memory?: OrBreakMemory | null;
    /** Pre-resolved guarded match (engine/API path). Falls back to raw matcher when omitted. */
    match?: PlaybookShadowMatchResult | null;
  }
): PlaybookShadowPanel | null {
  if (!technicals?.available) return null;

  const { verdicts, primary_playbook_id } =
    opts?.match ??
    matchPlaybooksShadow(desk, technicals, Date.now(), {
      or_break_memory: opts?.or_break_memory ?? null,
    });
  return {
    mode: playbookLiveGateEnabled() ? "live" : "shadow",
    primary_playbook_id,
    pipeline_audit: computePlaybookPipelineAudit(verdicts),
    verdicts: verdicts.map((v) => ({
      playbook_id: v.playbook_id,
      name: NAME_BY_ID[v.playbook_id] ?? v.playbook_id,
      trigger_fired: v.trigger_fired,
      precondition_match: v.precondition_match,
      session_window_open: v.session_window_open,
      regime_eligible: v.regime_eligible,
      direction: v.direction === "long" ? "long" : v.direction === "short" ? "short" : "neutral",
      detail: v.detail,
      primary: v.playbook_id === primary_playbook_id,
    })),
  };
}

import type { SpxPlayPayload } from "@/features/spx/lib/spx-play-engine";
import { resolveGuardedPlaybookMatch } from "@/features/spx/lib/playbook-match-resolver";
import { refreshOrBreakMemory } from "@/features/spx/lib/playbook-break-memory-store";
import { buildPlaybookShadowPanel } from "@/features/spx/lib/playbook-shadow-panel";
import { maybeLogPlaybookShadowMatch } from "@/features/spx/lib/playbook-shadow-log";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { PlayTechnicals } from "@/features/spx/lib/spx-play-technicals";
import { todayEtYmd } from "@/lib/providers/spx-session";

/** Cron mutate path — persist playbook FSM telemetry (not only member reads). */
export async function syncPlaybookTelemetryAfterEvaluate(
  desk: SpxDeskPayload,
  technicals: PlayTechnicals | null | undefined,
  play: SpxPlayPayload
): Promise<void> {
  if (!technicals?.available) return;

  const sessionDate = todayEtYmd();
  const orBreakMemory = await refreshOrBreakMemory(sessionDate, desk, technicals, true);
  const match = await resolveGuardedPlaybookMatch(sessionDate, desk, technicals, {
    or_break_memory: orBreakMemory,
  });
  const panel = buildPlaybookShadowPanel(desk, technicals, {
    or_break_memory: orBreakMemory,
    match,
  });
  if (!panel) return;

  const primaryVerdict = panel.verdicts.find((v) => v.primary && v.trigger_fired);
  await maybeLogPlaybookShadowMatch(
    desk,
    panel,
    { action: play.action, score: play.score },
    {
      technicals,
      resolved: match,
      persist_instances: true,
      gate_blocks: play.gates.blocks,
      first_block_category: play.gates.first_block_category,
      primary_playbook_id: panel.primary_playbook_id,
      primary_direction:
        primaryVerdict?.direction === "long" || primaryVerdict?.direction === "short"
          ? primaryVerdict.direction
          : null,
      opened_direction:
        play.phase === "OPEN" && play.open_play?.direction ? play.open_play.direction : null,
      option_contract_candidate: play.option_ticket ?? null,
      hypothetical_stop: play.levels?.stop ?? null,
      hypothetical_target: play.levels?.target ?? null,
    }
  );
}

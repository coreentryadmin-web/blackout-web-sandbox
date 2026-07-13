import type { PlaybookId } from "@/features/spx/lib/playbook-registry";
import { liveDataQualityMode, playbookDataQualityFlags } from "@/features/spx/lib/playbook-data-quality";
import { playbookStagingLabEnabled } from "@/features/spx/lib/spx-play-config";

/** Max fired-primary attempts per playbook per session (research governor). */
export function playbookSessionMaxTriggersPerPb(): number {
  const n = Number(process.env.PLAYBOOK_SESSION_MAX_TRIGGERS_PER_PB ?? "3");
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 3;
}

/** Size multiplier when staging lab + degraded data quality (not fail-closed). */
export function playbookDegradedSizeMultiplier(): number {
  const n = Number(process.env.PLAYBOOK_DEGRADED_SIZE_MULT ?? "0.5");
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.5;
}

export type PlaybookSessionRiskInput = {
  playbook_id: PlaybookId | null;
  triggers_today_by_pb: ReadonlyMap<string, number>;
  desk: { vix?: number | null; polled_at?: string | null; as_of?: string | null; halt_channel_stale?: boolean; gex_walls?: unknown[] };
};

export type PlaybookSessionRiskResult = {
  block: string | null;
  size_multiplier: number;
  warnings: string[];
};

export function evaluatePlaybookSessionRisk(input: PlaybookSessionRiskInput): PlaybookSessionRiskResult {
  const warnings: string[] = [];
  let size_multiplier = 1;

  if (!input.playbook_id) {
    return { block: null, size_multiplier, warnings };
  }

  const count = input.triggers_today_by_pb.get(input.playbook_id) ?? 0;
  const max = playbookSessionMaxTriggersPerPb();
  if (count >= max) {
    return {
      block: `Playbook ${input.playbook_id} session trigger cap (${max}) — stand down until tomorrow`,
      size_multiplier: 0,
      warnings,
    };
  }

  if (playbookStagingLabEnabled()) {
    const dq = playbookDataQualityFlags(input.desk as Parameters<typeof playbookDataQualityFlags>[0]);
    const mode = liveDataQualityMode(dq);
    if (mode === "degraded") {
      size_multiplier = playbookDegradedSizeMultiplier();
      warnings.push(`Playbook lab degraded size ×${size_multiplier} (${mode} data quality)`);
    }
  }

  return { block: null, size_multiplier, warnings };
}

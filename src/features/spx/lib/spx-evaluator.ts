import "server-only";

import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { PlayTechnicals } from "@/features/spx/lib/spx-play-technicals";
import {
  releaseSpxEvaluateLock,
  tryAcquireSpxEvaluateLock,
  dbConfigured,
} from "@/lib/db";
import { evaluateSpxPlay, type SpxPlayPayload } from "@/features/spx/lib/spx-play-engine";
import { syncPlaybookTelemetryAfterEvaluate } from "@/features/spx/lib/playbook-engine-telemetry";
import {
  recordPlayEngineTick,
  type PlayEngineTickSource,
} from "@/lib/play-engine-heartbeat";

export type RunSpxEvaluatorResult =
  | { ok: true; skipped: false; play: SpxPlayPayload }
  | { ok: true; skipped: true; reason: string; play?: undefined }
  | { ok: false; skipped?: undefined; error: string };

export function isSpxEvaluatorPlayResult(
  result: RunSpxEvaluatorResult
): result is { ok: true; skipped: false; play: SpxPlayPayload } {
  return result.ok === true && result.skipped === false;
}

/** Single mutation entry — acquires advisory lock, evaluates, records heartbeat. */
export async function runSpxEvaluator(
  desk: SpxDeskPayload,
  technicals?: PlayTechnicals | null,
  source: PlayEngineTickSource = "evaluate"
): Promise<RunSpxEvaluatorResult> {
  if (dbConfigured()) {
    const acquired = await tryAcquireSpxEvaluateLock();
    if (!acquired) {
      return { ok: true, skipped: true, reason: "Evaluator lock held by another instance" };
    }
  }

  try {
    const play = await evaluateSpxPlay(desk, technicals, { mutate: true });
    await syncPlaybookTelemetryAfterEvaluate(desk, technicals, play).catch((err) => {
      console.warn(
        "[spx-evaluator] playbook telemetry:",
        err instanceof Error ? err.message : err
      );
    });
    await recordPlayEngineTick(source);
    return { ok: true, skipped: false, play };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  } finally {
    if (dbConfigured()) {
      await releaseSpxEvaluateLock();
    }
  }
}

/** Read-only play snapshot — no DB writes, Discord, or signal side effects. */
export async function readSpxPlaySnapshot(
  desk: SpxDeskPayload,
  technicals?: PlayTechnicals | null,
  opts?: {
    or_break_memory?: import("@/features/spx/lib/playbook-break-memory").OrBreakMemory | null;
    playbook_resolved?: import("@/features/spx/lib/playbook-match-resolver").ResolvedPlaybookMatch | null;
  }
): Promise<SpxPlayPayload> {
  return evaluateSpxPlay(desk, technicals, {
    mutate: false,
    or_break_memory: opts?.or_break_memory,
    playbook_resolved: opts?.playbook_resolved,
  });
}

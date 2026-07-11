import type { PlaybookFidelity, PlaybookId, PlaybookSetupFamily } from "@/features/spx/lib/playbook-registry";

/**
 * Explicit execution posture per playbook — disambiguates shadow research from
 * paper-executable staging and future limited-live / production tiers.
 */
export type PlaybookExecutionMode =
  | "shadow"
  | "paper_executable"
  | "limited_live"
  | "production";

const MODE_RANK: Record<PlaybookExecutionMode, number> = {
  shadow: 0,
  paper_executable: 1,
  limited_live: 2,
  production: 3,
};

/** Default staging paper-executable set — high-fidelity core only (no mvp matchers). */
export const PLAYBOOK_PAPER_EXECUTABLE_DEFAULT: readonly PlaybookId[] = [
  "PB-01",
  "PB-02",
  "PB-03",
];

export function defaultExecutionMode(
  fidelity: PlaybookFidelity,
  id: PlaybookId
): PlaybookExecutionMode {
  if (PLAYBOOK_PAPER_EXECUTABLE_DEFAULT.includes(id) && fidelity === "high") {
    return "paper_executable";
  }
  return "shadow";
}

export function isPlaybookPaperExecutable(id: PlaybookId, mode: PlaybookExecutionMode): boolean {
  return MODE_RANK[mode] >= MODE_RANK.paper_executable;
}

export function executionModeMeets(
  actual: PlaybookExecutionMode,
  minimum: PlaybookExecutionMode
): boolean {
  return MODE_RANK[actual] >= MODE_RANK[minimum];
}

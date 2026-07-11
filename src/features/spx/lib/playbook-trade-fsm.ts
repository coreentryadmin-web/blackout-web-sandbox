import type { PlaybookMatchVerdict } from "@/features/spx/lib/playbook-shadow-matcher";

/**
 * Complete playbook trade lifecycle — setup detection + execution + position management.
 * Lowercase persisted in Postgres; uppercase labels in docs only.
 */
export type PlaybookLifecycleState =
  | "idle"
  | "armed"
  | "triggered"
  | "blocked"
  | "entry_pending"
  | "open"
  | "managing"
  | "exit_pending"
  | "closed"
  | "invalidated"
  | "expired"
  | "cancelled";

/** Terminal — no further matcher-driven transitions on this episode row. */
export function isTerminalPlaybookState(state: PlaybookLifecycleState): boolean {
  return (
    state === "closed" ||
    state === "invalidated" ||
    state === "expired" ||
    state === "cancelled"
  );
}

/** Position lifecycle — engine-owned; matcher may only push exit_pending on setup loss. */
export function isPostEntryPlaybookState(state: PlaybookLifecycleState): boolean {
  return state === "open" || state === "managing" || state === "exit_pending" || state === "closed";
}

/** Pre-entry states where a valid trigger can still lead to execution. */
export function isPreEntryActiveState(state: PlaybookLifecycleState): boolean {
  return (
    state === "armed" ||
    state === "triggered" ||
    state === "blocked" ||
    state === "entry_pending"
  );
}

/** States eligible for counterfactual MFE/MAE tracking (fired but not opened). */
export function isCounterfactualCandidateState(state: PlaybookLifecycleState): boolean {
  return state === "triggered" || state === "blocked" || state === "entry_pending";
}

/** Default TTL for triggered-without-entry (90s). */
export function playbookTriggerTtlMs(): number {
  const n = Number(process.env.PLAYBOOK_TRIGGER_TTL_MS ?? "90000");
  return Number.isFinite(n) && n >= 10_000 ? Math.floor(n) : 90_000;
}

export function verdictCandidateState(v: PlaybookMatchVerdict): PlaybookLifecycleState {
  if (!v.regime_eligible || !v.session_window_open) return "idle";
  if (v.trigger_fired) return "triggered";
  if (v.precondition_match) return "armed";
  return "idle";
}

export type ResolveMatcherFsmOpts = {
  /** Primary triggered but gates vetoed — distinct from setup invalidation. */
  gate_blocked?: boolean;
};

/**
 * Matcher + gate layer — pre-entry path only.
 * Post-entry (open/managing/exit_pending) handled by resolvePostEntryMatcherState.
 */
export function resolvePreEntryMatcherState(
  prev: PlaybookLifecycleState,
  v: PlaybookMatchVerdict,
  opts?: ResolveMatcherFsmOpts
): PlaybookLifecycleState {
  if (isTerminalPlaybookState(prev)) return prev;
  if (isPostEntryPlaybookState(prev)) return prev;

  const naive = verdictCandidateState(v);

  if (prev === "entry_pending") {
    return naive === "triggered" ? "entry_pending" : prev;
  }

  if (prev === "blocked") {
    if (
      naive === "idle" &&
      v.session_window_open &&
      v.regime_eligible
    ) {
      return "invalidated";
    }
    if (naive === "triggered" && !opts?.gate_blocked) return "triggered";
    if (naive === "triggered" && opts?.gate_blocked) return "blocked";
    return prev;
  }

  if (prev === "triggered" && opts?.gate_blocked && naive === "triggered") {
    return "blocked";
  }

  if (prev === "triggered" && naive === "triggered") return "triggered";

  if (naive === "armed" && prev === "triggered") return "invalidated";

  if (
    naive === "idle" &&
    (prev === "armed" || prev === "triggered") &&
    v.session_window_open &&
    v.regime_eligible
  ) {
    return "invalidated";
  }

  return naive;
}

/**
 * When a position is open, setup invalidation requires exit — not silent telemetry.
 */
export function resolvePostEntryMatcherState(
  prev: PlaybookLifecycleState,
  v: PlaybookMatchVerdict
): PlaybookLifecycleState {
  if (prev !== "open" && prev !== "managing") return prev;

  const naive = verdictCandidateState(v);
  const setupLost =
    naive === "idle" ||
    (naive === "armed" && !v.trigger_fired) ||
    (prev === "open" && naive === "armed" && !v.precondition_match);

  if (setupLost && v.session_window_open && v.regime_eligible) {
    return "exit_pending";
  }

  return prev;
}

export function resolvePlaybookFsmState(
  prev: PlaybookLifecycleState,
  v: PlaybookMatchVerdict,
  opts?: ResolveMatcherFsmOpts
): PlaybookLifecycleState {
  const post = resolvePostEntryMatcherState(prev, v);
  if (post !== prev) return post;
  return resolvePreEntryMatcherState(prev, v, opts);
}

export type PlaybookInstanceSnapshot = {
  instance_id: string;
  playbook_id: string;
  direction: "long" | "short" | null;
  state: PlaybookLifecycleState;
  triggered_at_ms: number | null;
};

/** Expire triggered/blocked/entry_pending episodes that exceeded TTL without open. */
export function applyTriggerExpiryTransitions(
  snapshots: readonly PlaybookInstanceSnapshot[],
  nowMs: number,
  ttlMs: number = playbookTriggerTtlMs()
): Array<{
  instance_id: string;
  playbook_id: string;
  direction: "long" | "short" | null;
  from_state: PlaybookLifecycleState;
  to_state: "expired";
  detail: string;
}> {
  const out: Array<{
    instance_id: string;
    playbook_id: string;
    direction: "long" | "short" | null;
    from_state: PlaybookLifecycleState;
    to_state: "expired";
    detail: string;
  }> = [];

  for (const s of snapshots) {
    if (!isCounterfactualCandidateState(s.state)) continue;
    const anchor = s.triggered_at_ms;
    if (anchor == null || nowMs - anchor < ttlMs) continue;
    out.push({
      instance_id: s.instance_id,
      playbook_id: s.playbook_id,
      direction: s.direction,
      from_state: s.state,
      to_state: "expired",
      detail: `trigger TTL ${Math.round(ttlMs / 1000)}s exceeded without entry`,
    });
  }

  return out;
}

/** Engine-allowed transitions (validated before persist). */
export const ENGINE_TRANSITIONS: ReadonlyArray<{
  from: PlaybookLifecycleState | "*";
  to: PlaybookLifecycleState;
}> = [
  { from: "triggered", to: "entry_pending" },
  { from: "blocked", to: "entry_pending" },
  { from: "triggered", to: "open" },
  { from: "entry_pending", to: "open" },
  { from: "entry_pending", to: "cancelled" },
  { from: "triggered", to: "cancelled" },
  { from: "blocked", to: "cancelled" },
  { from: "open", to: "managing" },
  { from: "open", to: "closed" },
  { from: "managing", to: "closed" },
  { from: "exit_pending", to: "closed" },
  { from: "open", to: "exit_pending" },
  { from: "managing", to: "exit_pending" },
];

export function canEngineTransition(
  from: PlaybookLifecycleState,
  to: PlaybookLifecycleState
): boolean {
  return ENGINE_TRANSITIONS.some((t) => (t.from === from || t.from === "*") && t.to === to);
}

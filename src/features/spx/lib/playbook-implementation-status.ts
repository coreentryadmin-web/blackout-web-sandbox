import type { PlaybookId } from "@/features/spx/lib/playbook-registry";

/**
 * Canonical implementation status labels — use exactly these in docs and registry.
 *
 * - not_started: designed only, no runtime wiring
 * - stub: placeholder path exists, not decision-grade
 * - partial: wired but incomplete vs spec (proxies, missing fields, join-only data)
 * - implemented: spec-shaped behavior in staging code paths
 * - validated: OOS evidence + promotion gates met for the scoped surface
 * - production_eligible: limited-live or prod tier cleared with risk controls
 */
export type PlaybookImplementationStatus =
  | "not_started"
  | "stub"
  | "partial"
  | "implemented"
  | "validated"
  | "production_eligible";

export type PlaybookSurfaceStatus = {
  matcher: PlaybookImplementationStatus;
  /** Instance FSM + Postgres persistence for this PB's episodes. */
  fsm_persistence: PlaybookImplementationStatus;
  /** Gate A17 allowlist — permits staging BUY when primary. Independent of matcher fidelity. */
  allowlist_gate: PlaybookImplementationStatus;
  /** Exit engine wiring in evaluateOpenPlay. */
  exit_management: PlaybookImplementationStatus;
  /** Promotion / limited-live readiness. */
  production_eligible: PlaybookImplementationStatus;
  notes?: string;
};

/**
 * Per-playbook surface status — single source for architecture matrix.
 * Allowlist_gate=implemented does NOT imply matcher=validated.
 */
export const PLAYBOOK_SURFACE_STATUS: Record<PlaybookId, PlaybookSurfaceStatus> = {
  "PB-01": {
    matcher: "implemented",
    fsm_persistence: "implemented",
    allowlist_gate: "implemented",
    exit_management: "implemented",
    production_eligible: "not_started",
    notes: "Awaiting OOS promotion gates",
  },
  "PB-02": {
    matcher: "implemented",
    fsm_persistence: "implemented",
    allowlist_gate: "implemented",
    exit_management: "implemented",
    production_eligible: "not_started",
  },
  "PB-03": {
    matcher: "implemented",
    fsm_persistence: "implemented",
    allowlist_gate: "implemented",
    exit_management: "implemented",
    production_eligible: "not_started",
  },
  "PB-04": {
    matcher: "partial",
    fsm_persistence: "implemented",
    allowlist_gate: "implemented",
    exit_management: "implemented",
    production_eligible: "not_started",
    notes: "mvp wall proxy on allowlist for paper accumulation — not interchangeable with PB-02",
  },
  "PB-05": {
    matcher: "partial",
    fsm_persistence: "implemented",
    allowlist_gate: "not_started",
    exit_management: "partial",
    production_eligible: "not_started",
  },
  "PB-06": {
    matcher: "partial",
    fsm_persistence: "implemented",
    allowlist_gate: "not_started",
    exit_management: "partial",
    production_eligible: "not_started",
  },
  "PB-07": {
    matcher: "partial",
    fsm_persistence: "implemented",
    allowlist_gate: "not_started",
    exit_management: "partial",
    production_eligible: "not_started",
  },
  "PB-08": {
    matcher: "partial",
    fsm_persistence: "implemented",
    allowlist_gate: "not_started",
    exit_management: "partial",
    production_eligible: "not_started",
  },
  "PB-09": {
    matcher: "partial",
    fsm_persistence: "implemented",
    allowlist_gate: "not_started",
    exit_management: "stub",
    production_eligible: "not_started",
    notes: "Modifier only — never primary",
  },
  "PB-10": {
    matcher: "partial",
    fsm_persistence: "implemented",
    allowlist_gate: "not_started",
    exit_management: "partial",
    production_eligible: "not_started",
  },
  "PB-11": {
    matcher: "implemented",
    fsm_persistence: "implemented",
    allowlist_gate: "not_started",
    exit_management: "partial",
    production_eligible: "not_started",
  },
  "PB-12": {
    matcher: "partial",
    fsm_persistence: "implemented",
    allowlist_gate: "not_started",
    exit_management: "partial",
    production_eligible: "not_started",
  },
  "PB-13": {
    matcher: "partial",
    fsm_persistence: "implemented",
    allowlist_gate: "not_started",
    exit_management: "partial",
    production_eligible: "not_started",
  },
  "PB-14": {
    matcher: "implemented",
    fsm_persistence: "implemented",
    allowlist_gate: "not_started",
    exit_management: "partial",
    production_eligible: "not_started",
    notes: "OR break memory shipped; shadow until promotion",
  },
};

export type PlaybookSubsystemStatus = {
  subsystem: string;
  status: PlaybookImplementationStatus;
  detail: string;
};

/** Cross-cutting subsystem status (decoupled from per-PB matrix). */
export const PLAYBOOK_SUBSYSTEM_STATUS: readonly PlaybookSubsystemStatus[] = [
  {
    subsystem: "matcher_fsm",
    status: "implemented",
    detail: "idle→armed→triggered→invalidated persisted; matchers still tick-recomputed each poll",
  },
  {
    subsystem: "trade_fsm",
    status: "implemented",
    detail: "open→managing→closed commits on engine BUY/TRIM/SELL",
  },
  {
    subsystem: "blocked_while_armed_ordering",
    status: "partial",
    detail: "Gate re-arm exists; full blocked-while-armed episode ordering not enforced",
  },
  {
    subsystem: "spx_playbook_instance_events",
    status: "implemented",
    detail: "Append-only events + feature_snapshot per transition",
  },
  {
    subsystem: "spx_playbook_instances",
    status: "implemented",
    detail: "Episode-scoped id + durable row; temporal ordering still partial",
  },
  {
    subsystem: "execution_sim",
    status: "partial",
    detail: "lite_v1 research model — not production_eligible",
  },
  {
    subsystem: "counterfactual_eval",
    status: "implemented",
    detail: "Fixed-horizon contract on instance row",
  },
];

export type InstanceSchemaFieldStatus = {
  field: string;
  status: PlaybookImplementationStatus;
  where: string;
  gap?: string;
};

/** 20-field research contract — exact coverage accounting. */
export const INSTANCE_SCHEMA_FIELD_STATUS: readonly InstanceSchemaFieldStatus[] = [
  { field: "session_date", status: "implemented", where: "spx_playbook_instances" },
  { field: "playbook_id", status: "implemented", where: "spx_playbook_instances" },
  { field: "instance_id", status: "implemented", where: "playbook-instance-episode.ts", gap: "episode-scoped #71" },
  { field: "armed_at", status: "implemented", where: "COALESCE on first armed" },
  { field: "triggered_at", status: "implemented", where: "COALESCE on first triggered" },
  { field: "invalidated_at", status: "implemented", where: "invalidated transition" },
  { field: "opened_at", status: "implemented", where: "patched on engine open" },
  {
    field: "closed_at",
    status: "partial",
    where: "spx_play_outcomes join",
    gap: "not denormalized on instance row",
  },
  { field: "direction", status: "implemented", where: "instance row" },
  { field: "regime_snapshot", status: "implemented", where: "feature_snapshot + events" },
  { field: "input_feature_snapshot", status: "implemented", where: "append-only events" },
  { field: "data_quality_flags", status: "implemented", where: "data_quality_mode + halt/desk/gex" },
  { field: "reason_armed", status: "implemented", where: "instance_events.reason" },
  { field: "reason_triggered", status: "implemented", where: "instance_events.reason" },
  { field: "reason_blocked", status: "implemented", where: "reason_blocked + blocked events" },
  { field: "reason_invalidated", status: "implemented", where: "reason_invalidated" },
  { field: "underlying_entry_reference", status: "implemented", where: "trigger_price + price_at_event" },
  { field: "option_contract_candidate", status: "implemented", where: "JSONB on open" },
  { field: "counterfactual_mfe_mae", status: "implemented", where: "counterfactual_*_pts + counterfactual_eval" },
  {
    field: "actual_outcome",
    status: "partial",
    where: "spx_play_outcomes join when opened",
    gap: "absent when triggered-but-not-opened (by design)",
  },
];

export function instanceSchemaCoverageSummary(): {
  implemented: number;
  partial: number;
  not_started: number;
  total: number;
} {
  let implemented = 0;
  let partial = 0;
  let not_started = 0;
  for (const f of INSTANCE_SCHEMA_FIELD_STATUS) {
    if (f.status === "implemented") implemented += 1;
    else if (f.status === "partial") partial += 1;
    else if (f.status === "not_started") not_started += 1;
  }
  return { implemented, partial, not_started, total: INSTANCE_SCHEMA_FIELD_STATUS.length };
}

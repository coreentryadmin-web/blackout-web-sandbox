import type { PlaybookId } from "@/features/spx/lib/playbook-registry";

/** Named exit policy contract — registry metadata only.
 *  Runtime exits live in `playbook-exit-engines.ts` (do not edit numbers here expecting live behavior). */
export type PlaybookExitPolicy = {
  initial_stop_model: string;
  target_model: string;
  trim_model: string;
  trailing_model: string;
  thesis_invalidation: string;
  max_hold_minutes: number | null;
  theta_cutoff: string | null;
  end_of_day_policy: string;
};

const DEFAULT_EXIT: PlaybookExitPolicy = {
  initial_stop_model: "legacy_confluence_stop",
  target_model: "legacy_confluence_target",
  trim_model: "generic_mfe_trim",
  trailing_model: "generic_trailing_window",
  thesis_invalidation: "legacy_confluence_thesis_break",
  max_hold_minutes: null,
  theta_cutoff: "session_force_exit",
  end_of_day_policy: "flat_by_no_entry_cutoff",
};

const BY_PB: Partial<Record<PlaybookId, Partial<PlaybookExitPolicy>>> = {
  "PB-01": {
    initial_stop_model: "vwap_reclaim_buffer",
    target_model: "vwap_extension_or_structural",
    trim_model: "partial_at_0.9x_dynamic_mfe",
    trailing_model: "breakeven_then_vwap_trail",
    thesis_invalidation: "close_back_through_vwap",
    max_hold_minutes: 90,
  },
  "PB-02": {
    initial_stop_model: "vwap_acceptance_buffer",
    target_model: "fade_to_range_mid",
    trim_model: "partial_at_0.85x_dynamic_mfe",
    trailing_model: "tight_vwap_trail",
    thesis_invalidation: "vwap_reclaimed_against_fade",
    max_hold_minutes: 75,
  },
  "PB-03": {
    initial_stop_model: "or_mid_structural",
    target_model: "or_extension_measured_move",
    trim_model: "partial_at_1.1x_dynamic_mfe",
    trailing_model: "wide_or_trail",
    thesis_invalidation: "re_entry_inside_or",
    max_hold_minutes: 120,
  },
  "PB-04": {
    initial_stop_model: "wall_acceptance",
    target_model: "fast_mean_reversion_to_mid",
    trim_model: "aggressive_at_wall_touch_0.75x_mfe",
    trailing_model: "tight_pin_trail",
    thesis_invalidation: "sustained_wall_break",
    max_hold_minutes: 45,
    theta_cutoff: "aggressive_theta_after_30m",
  },
  "PB-14": {
    initial_stop_model: "or_rebreak_stop",
    target_model: "failed_break_measured_move",
    trim_model: "partial_at_1.0x_dynamic_mfe",
    trailing_model: "or_mid_trail",
    thesis_invalidation: "or_re_exit_original_side",
    max_hold_minutes: 60,
  },
};

export function defaultExitPolicy(id: PlaybookId): PlaybookExitPolicy {
  return { ...DEFAULT_EXIT, ...BY_PB[id] };
}

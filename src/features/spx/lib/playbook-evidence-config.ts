/**
 * Playbook evidence / research constants — train vs OOS firewall and parameter bands.
 */

/** Prod outcomes through this date (inclusive) are training/motivation only — never promotion validation. */
export const PLAYBOOK_TRAIN_CUTOFF_DATE = "2026-07-07";

/** Design landed on staging — prospective OOS evidence starts after this session. */
export const PLAYBOOK_OOS_START_DATE = "2026-07-10";

export type PlaybookParamBand = {
  name: string;
  env_key: string | null;
  default_value: number;
  band_low: number;
  band_high: number;
  unit: string;
};

/** Stability bands for OOS sensitivity — edge should survive band, not a single tuned point. */
export const PLAYBOOK_PARAM_BANDS: readonly PlaybookParamBand[] = [
  {
    name: "wall_proximity_pts",
    env_key: "SPX_PLAY_STRUCTURE_PROX_PTS",
    default_value: 10,
    band_low: 8,
    band_high: 12,
    unit: "pts",
  },
  {
    name: "mtf_buffer_pts",
    env_key: "SPX_PLAY_MTF_BUFFER_PTS",
    default_value: 1,
    band_low: 0.5,
    band_high: 2,
    unit: "pts",
  },
  {
    name: "wall_stop_offset_pts",
    env_key: null,
    default_value: 3,
    band_low: 2,
    band_high: 4,
    unit: "pts",
  },
  {
    name: "helix_stop_pts",
    env_key: null,
    default_value: 5,
    band_low: 4,
    band_high: 6,
    unit: "pts",
  },
  {
    name: "gap_pct",
    env_key: null,
    default_value: 0.3,
    band_low: 0.25,
    band_high: 0.35,
    unit: "pct",
  },
  {
    name: "range_chop_pct",
    env_key: null,
    default_value: 0.35,
    band_low: 0.3,
    band_high: 0.4,
    unit: "pct",
  },
  {
    name: "rsi_stretch_high",
    env_key: null,
    default_value: 72,
    band_low: 70,
    band_high: 74,
    unit: "rsi",
  },
  {
    name: "rsi_stretch_low",
    env_key: null,
    default_value: 28,
    band_low: 26,
    band_high: 30,
    unit: "rsi",
  },
  {
    name: "vwap_duration_min",
    env_key: null,
    default_value: 15,
    band_low: 12,
    band_high: 18,
    unit: "min",
  },
  {
    name: "flow_materiality_min",
    env_key: "PLAYBOOK_FLOW_MATERIALITY_MIN",
    default_value: 100_000,
    band_low: 75_000,
    band_high: 150_000,
    unit: "usd",
  },
];

export function isPlaybookOosSessionDate(sessionDate: string): boolean {
  return sessionDate >= PLAYBOOK_OOS_START_DATE;
}

export function isPlaybookTrainSessionDate(sessionDate: string): boolean {
  return sessionDate <= PLAYBOOK_TRAIN_CUTOFF_DATE;
}

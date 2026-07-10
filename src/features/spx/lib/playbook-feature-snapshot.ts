import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { PlayTechnicals } from "@/features/spx/lib/spx-play-technicals";

/** Immutable feature slice at observation time — avoids look-ahead in research joins. */
export type PlaybookFeatureSnapshot = {
  price: number;
  vwap: number | null;
  regime: string | null;
  gamma_regime: string | null;
  gamma_flip: number | null;
  flow_0dte_net: number | null;
  gex_wall_count: number;
  hod: number | null;
  lod: number | null;
  vix: number | null;
  halt_channel_stale: boolean;
  gex_age_ms: number | null;
  flow_data_age_ms: number | null;
  or_defined: boolean;
  or_high: number | null;
  or_low: number | null;
  minutes_below_vwap: number;
  minutes_above_vwap: number;
  rolling_30m_high: number | null;
  rolling_30m_low: number | null;
  captured_at: string;
};

export function buildPlaybookFeatureSnapshot(
  desk: SpxDeskPayload,
  technicals: PlayTechnicals | null | undefined
): PlaybookFeatureSnapshot {
  return {
    price: desk.price,
    vwap: desk.vwap ?? null,
    regime: desk.regime ?? null,
    gamma_regime: desk.gamma_regime ?? null,
    gamma_flip: desk.gamma_flip ?? null,
    flow_0dte_net: desk.flow_0dte_net ?? null,
    gex_wall_count: desk.gex_walls?.length ?? 0,
    hod: desk.hod ?? null,
    lod: desk.lod ?? null,
    vix: desk.vix ?? null,
    halt_channel_stale: desk.halt_channel_stale === true,
    gex_age_ms: desk.gex_age_ms ?? null,
    flow_data_age_ms: desk.flow_data_age_ms ?? null,
    or_defined: technicals?.or_defined ?? false,
    or_high: technicals?.or_high ?? null,
    or_low: technicals?.or_low ?? null,
    minutes_below_vwap: technicals?.minutes_below_vwap ?? 0,
    minutes_above_vwap: technicals?.minutes_above_vwap ?? 0,
    rolling_30m_high: technicals?.rolling_30m_high ?? null,
    rolling_30m_low: technicals?.rolling_30m_low ?? null,
    captured_at: new Date().toISOString(),
  };
}

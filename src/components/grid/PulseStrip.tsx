"use client";

import useSWR from "swr";
import { clsx } from "clsx";
import { fetchSpxState, type SpxState } from "@/lib/api";
import { GridCard } from "./GridCard";
import { useGridTicker } from "@/lib/grid/grid-ticker-context";

function fmt(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function Chip({
  label,
  value,
  tone = "sky",
  sub,
}: {
  label: string;
  value: string;
  tone?: "emerald" | "bear" | "sky" | "gold";
  sub?: string;
}) {
  return (
    <div className="pulse-chip">
      <span className="pulse-chip-label">{label}</span>
      <span className={clsx("pulse-chip-value", `pulse-tone-${tone}`)}>{value}</span>
      {sub && <span className="pulse-chip-sub">{sub}</span>}
    </div>
  );
}

/**
 * Panel 1 — Market Pulse (hero strip). Reuses the existing SPX desk merged payload (fetchSpxState
 * → /api/market/spx/merged, already server-cached) — no new fetch path, honoring the cache-reader
 * rule. Surfaces SPX, VIX, breadth (adv/dec/TRIN/TICK), the market tide bias and key chart levels.
 */
export function PulseStrip() {
  const { ticker } = useGridTicker();
  const { data, error } = useSWR<SpxState>("grid-pulse", fetchSpxState, {
    refreshInterval: 20_000,
  });

  // GEX chip — follows the active ticker; defaults to market-wide SPX
  const gexTicker = ticker ?? "SPX";
  const { data: gex } = useSWR(
    `grid-pulse-gex-${gexTicker}`,
    () => fetch(`/api/market/gex-positioning?ticker=${gexTicker}`, { credentials: "same-origin" }).then((r) => r.json()),
    { refreshInterval: 60_000 }
  );
  const gexLabel = gex?.net_gex != null ? (gex.net_gex < 0 ? "NEG γ" : "POS γ") : "—";
  const gexTone: "emerald" | "bear" | "sky" = gex?.net_gex != null ? (gex.net_gex < 0 ? "bear" : "emerald") : "sky";
  const gexSub = gex?.gamma_posture != null ? `${gexTicker} flip ${gex?.flip ?? "—"}` : undefined;

  const s = data;
  const live = !error && !!s?.available && (s?.price ?? 0) > 0;

  const spxTone = (s?.spx_change_pct ?? 0) >= 0 ? "emerald" : "bear";
  // VIX up = fear → bear tone; down = calm → emerald.
  const vixTone = (s?.vix_change_pct ?? 0) > 0 ? "bear" : "emerald";
  const breadthNet = (s?.adv ?? 0) - (s?.dec ?? 0);
  const breadthTone = breadthNet >= 0 ? "emerald" : "bear";
  const tideBias = (s?.tide_bias ?? "").toLowerCase();
  const tideTone = tideBias.includes("bull") ? "emerald" : tideBias.includes("bear") ? "bear" : "sky";

  return (
    <GridCard title="Market Pulse" kicker="PULSE" accent="gold" live={live} span={4}>
      {!s?.available ? (
        <p className="grid-empty">
          {data ? "Desk closed — pulse resumes at the open" : "Reading the tape…"}
        </p>
      ) : (
        <div className="pulse-grid">
          <Chip label="SPX" value={fmt(s.price)} tone={spxTone} sub={pct(s.spx_change_pct)} />
          <Chip
            label="VIX"
            value={s.vix != null ? fmt(s.vix) : "—"}
            tone={vixTone}
            sub={s.vix_change_pct != null ? pct(s.vix_change_pct) : undefined}
          />
          <Chip
            label="Breadth"
            value={`${s.adv ?? "—"} / ${s.dec ?? "—"}`}
            tone={breadthTone}
            sub={breadthNet >= 0 ? `+${breadthNet} adv` : `${breadthNet} adv`}
          />
          <Chip
            label="TRIN"
            value={s.trin != null ? fmt(s.trin) : "—"}
            tone={(s.trin ?? 1) <= 1 ? "emerald" : "bear"}
          />
          <Chip
            label="TICK"
            value={s.tick != null ? String(Math.round(s.tick)) : "—"}
            tone={(s.tick ?? 0) >= 0 ? "emerald" : "bear"}
          />
          <Chip label="Tide" value={s.tide_bias ?? "—"} tone={tideTone} />
          <Chip label="VWAP" value={fmt(s.vwap)} tone={s.above_vwap ? "emerald" : "bear"} sub={s.above_vwap ? "above" : "below"} />
          <Chip
            label="Gamma Flip"
            value={s.gamma_flip != null ? fmt(s.gamma_flip, 0) : "—"}
            tone="gold"
          />
          <Chip label="GEX" value={gexLabel} tone={gexTone} sub={gexSub} />
        </div>
      )}
    </GridCard>
  );
}

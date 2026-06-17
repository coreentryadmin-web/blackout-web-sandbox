"use client";

import { clsx } from "clsx";
import type { SpxDeskPayload } from "@/lib/api";
import { fmtPct, fmtPremium, fmtPrice } from "@/lib/api";

export function SpxTechnicalsPanel({ desk, live }: { desk?: SpxDeskPayload; live?: boolean }) {
  return (
    <aside className="spx-technicals-panel">
      <div className="spx-technicals-header">
        <span className="badge-live-dot" />
        <span className="font-mono text-[9px] tracking-[0.4em] uppercase text-bull">
          Structure
        </span>
      </div>

      <div className="spx-technicals-body">
        <Section title="Session">
          <Row label="LOD" value={live ? fmtPrice(desk?.lod ?? null) : "—"} kind="support" />
          <Row label="HOD" value={live ? fmtPrice(desk?.hod ?? null) : "—"} kind="resistance" />
          <Row label="VWAP" value={live ? fmtPrice(desk?.vwap ?? null) : "—"} accent={desk?.above_vwap} />
          <Row label="PDH" value={live ? fmtPrice(desk?.pdh ?? null) : "—"} kind="resistance" />
          <Row label="PDL" value={live ? fmtPrice(desk?.pdl ?? null) : "—"} kind="support" />
        </Section>

        <Section title="Moving Averages">
          <Row label="EMA 20" value={live ? fmtPrice(desk?.ema20 ?? null) : "—"} />
          <Row label="EMA 50" value={live ? fmtPrice(desk?.ema50 ?? null) : "—"} />
          <Row label="EMA 200" value={live ? fmtPrice(desk?.ema200 ?? null) : "—"} />
          <Row label="SMA 50" value={live ? fmtPrice(desk?.sma50 ?? null) : "—"} />
          <Row label="SMA 200" value={live ? fmtPrice(desk?.sma200 ?? null) : "—"} />
        </Section>

        <Section title="Dealer · Flow">
          <Row label="GEX Net" value={live && desk?.gex_net != null ? fmtPremium(desk.gex_net) : "—"} />
          <Row label="GEX King" value={live ? fmtPrice(desk?.gex_king ?? null) : "—"} />
          <Row label="Max Pain" value={live ? fmtPrice(desk?.max_pain ?? null) : "—"} />
          <Row label="0DTE Net" value={live && desk?.flow_0dte_net != null ? fmtPremium(desk.flow_0dte_net) : "—"} />
          <Row label="Tide" value={live ? (desk?.tide_bias ?? "—") : "—"} accent={desk?.tide_bias === "bullish"} />
          <Row label="NOPE" value={live && desk?.nope != null ? desk.nope.toFixed(2) : "—"} />
        </Section>

        <Section title="Internals">
          <Row label="TICK" value={live && desk?.tick != null ? String(Math.round(desk.tick)) : "—"} />
          <Row label="TRIN" value={live && desk?.trin != null ? desk.trin.toFixed(2) : "—"} />
          <Row label="IV Rank" value={live && desk?.uw_iv_rank != null ? String(desk.uw_iv_rank) : "—"} />
          <Row label="Regime" value={live ? (desk?.regime ?? "—") : "—"} accent />
        </Section>

        <Section title="Level Ladder">
          {(desk?.levels ?? []).map((lv) => (
            <div key={lv.label} className={clsx("spx-level-row", `spx-level-${lv.kind}`)}>
              <span className="spx-level-label">{lv.label}</span>
              <span className="spx-level-value">{live ? fmtPrice(lv.value) : "—"}</span>
              {lv.distance_pct != null && live && (
                <span
                  className={clsx(
                    "spx-level-dist",
                    lv.distance_pct >= 0 ? "num-bull" : "num-bear"
                  )}
                >
                  {fmtPct(lv.distance_pct)}
                </span>
              )}
            </div>
          ))}
        </Section>
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="spx-technicals-section">
      <p className="spx-technicals-section-title">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({
  label,
  value,
  kind,
  accent,
}: {
  label: string;
  value: string;
  kind?: "support" | "resistance";
  accent?: boolean | string;
}) {
  return (
    <div className={clsx("spx-tech-row", kind && `spx-tech-row-${kind}`)}>
      <span className="spx-tech-label">{label}</span>
      <span
        className={clsx(
          "spx-tech-value",
          accent === true || accent === "bullish" ? "text-bull" : accent === "bearish" ? "text-bear" : "text-white"
        )}
      >
        {value}
      </span>
    </div>
  );
}

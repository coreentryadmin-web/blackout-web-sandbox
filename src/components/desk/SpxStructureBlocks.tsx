"use client";

import { motion } from "framer-motion";
import { clsx } from "clsx";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import { OdteFlowBar } from "@/components/desk/SpxDeskPanels";
import { fmtPct, fmtPremium, fmtPrice } from "@/lib/api";

type BlockProps = { desk?: SpxDeskPayload; live?: boolean };

const CARD_THEMES = {
  session: {
    border: "border-cyan-500/35",
    header: "text-cyan-300",
    glow: "rgba(34, 211, 238, 0.08)",
    accent: "bg-cyan-500/10",
  },
  dealer: {
    border: "border-gold/35",
    header: "text-gold",
    glow: "rgba(255, 210, 63, 0.08)",
    accent: "bg-gold/10",
  },
  levels: {
    border: "border-violet-400/35",
    header: "text-violet-300",
    glow: "rgba(167, 139, 250, 0.08)",
    accent: "bg-violet-500/10",
  },
} as const;

export function SpxStructureBlocks({
  desk,
  live,
  variant = "stacked",
}: BlockProps & { variant?: "stacked" | "left-rail" }) {
  const isLeftRail = variant === "left-rail";
  const levelCap = isLeftRail ? 12 : 6;

  return (
    <div className={clsx("spx-structure-grid", isLeftRail && "spx-structure-left-rail")}>
      <StructureCard theme="session" title="Price Structure" subtitle="Session · MAs" large={isLeftRail} live={live}>
        <Row label="LOD" value={live ? fmtPrice(desk?.lod ?? null) : "—"} tone="support" />
        <Row label="HOD" value={live ? fmtPrice(desk?.hod ?? null) : "—"} tone="resistance" />
        <Row
          label="VWAP"
          value={live ? fmtPrice(desk?.vwap ?? null) : "—"}
          tone={desk?.above_vwap ? "bull" : "bear"}
          highlight={desk?.above_vwap}
        />
        <Row label="PDH" value={live ? fmtPrice(desk?.pdh ?? null) : "—"} tone="resistance" />
        <Row label="PDL" value={live ? fmtPrice(desk?.pdl ?? null) : "—"} tone="support" />
        <div className="spx-structure-divider" />
        <Row label="EMA 20" value={live ? fmtPrice(desk?.ema20 ?? null) : "—"} tone="orange" />
        <Row label="EMA 50" value={live ? fmtPrice(desk?.ema50 ?? null) : "—"} tone="purple" />
        <Row label="EMA 200" value={live ? fmtPrice(desk?.ema200 ?? null) : "—"} tone="blue" />
        <Row label="SMA 50" value={live ? fmtPrice(desk?.sma50 ?? null) : "—"} tone="orange" />
        <Row label="SMA 200" value={live ? fmtPrice(desk?.sma200 ?? null) : "—"} tone="blue" />
      </StructureCard>

      <StructureCard theme="dealer" title="Dealer Desk" subtitle="GEX · Flow" large={isLeftRail} live={live}>
        {live && desk?.gex_stale && (
          <p className="font-mono text-[10px] tracking-wider text-gold mb-1.5 flex items-center gap-1.5">
            <span className="badge-live-dot" style={{ background: "var(--gold, #ffd23f)" }} aria-hidden />
            GEX last-good
            {desk?.gex_age_ms != null && desk.gex_age_ms > 0
              ? ` · ${Math.round(desk.gex_age_ms / 1000)}s old`
              : ""}{" "}
            — not live
          </p>
        )}
        <Row
          label="GEX Net"
          value={live && desk?.gex_net != null ? fmtPremium(desk.gex_net) : "—"}
          tone={(desk?.gex_net ?? 0) >= 0 ? "bull" : "bear"}
        />
        <Row label="GEX Anchor" value={live ? fmtPrice(desk?.gex_king ?? null) : "—"} tone="gold" />
        <Row label="γ Flip" value={live ? fmtPrice(desk?.gamma_flip ?? null) : "—"} tone="magenta" />
        <Row label="Max Pain" value={live ? fmtPrice(desk?.max_pain ?? null) : "—"} tone="cyan" />
        <Row
          label="0DTE Net"
          value={live && desk?.flow_0dte_net != null ? fmtPremium(desk.flow_0dte_net) : "—"}
          tone={(desk?.flow_0dte_net ?? 0) >= 0 ? "bull" : "bear"}
        />
        <Row
          label="Tide"
          value={live ? (desk?.tide_bias ?? "—") : "—"}
          tone={desk?.tide_bias === "bullish" ? "bull" : desk?.tide_bias === "bearish" ? "bear" : "neutral"}
        />
        <Row
          label="Tide Call $"
          value={live && desk?.tide_call_premium != null ? fmtPremium(desk.tide_call_premium) : "—"}
          tone="bull"
        />
        <Row
          label="Tide Put $"
          value={live && desk?.tide_put_premium != null ? fmtPremium(desk.tide_put_premium) : "—"}
          tone="bear"
        />
        <Row label="NOPE" value={live && desk?.nope != null ? desk.nope.toFixed(2) : "—"} tone="teal" />
        <Row
          label="NOPE Δ"
          value={live && desk?.nope_net_delta != null ? desk.nope_net_delta.toFixed(2) : "—"}
          tone="teal"
        />
        <div className="spx-structure-divider" />
        <OdteFlowBar desk={desk} live={live} />
        <Row
          label="IV Rank"
          value={live && desk?.uw_iv_rank != null ? String(desk.uw_iv_rank) : "—"}
          tone="orange"
        />
      </StructureCard>

      <StructureCard theme="levels" title="Levels · Tape" subtitle="Internals · Ladder" large={isLeftRail} live={live}>
        <Row
          label="TICK"
          value={live && desk?.tick != null ? String(Math.round(desk.tick)) : "—"}
          tone={(desk?.tick ?? 0) >= 0 ? "bull" : "bear"}
          estimated={live && desk?.tick != null && desk?.internals_estimated?.tick}
        />
        <Row
          label="TRIN"
          value={live && desk?.trin != null ? desk.trin.toFixed(2) : "—"}
          tone={(desk?.trin ?? 1) < 1 ? "bull" : "bear"}
          estimated={live && desk?.trin != null && desk?.internals_estimated?.trin}
        />
        <Row
          label="ADD"
          value={live && desk?.add != null ? String(Math.round(desk.add)) : "—"}
          tone={(desk?.add ?? 0) >= 0 ? "bull" : "bear"}
          estimated={live && desk?.add != null && desk?.internals_estimated?.add}
        />
        <Row
          label="Regime"
          value={live ? (desk?.regime ?? "—") : "—"}
          tone="violet"
          highlight
        />
        <div className="spx-structure-divider" />
        {(desk?.levels ?? []).slice(0, levelCap).map((lv) => (
          <LevelRow key={lv.label} label={lv.label} value={lv.value} dist={lv.distance_pct} live={live} kind={lv.kind} />
        ))}
      </StructureCard>
    </div>
  );
}

function StructureCard({
  theme,
  title,
  subtitle,
  children,
  large,
  live,
}: {
  theme: keyof typeof CARD_THEMES;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  large?: boolean;
  live?: boolean;
}) {
  const t = CARD_THEMES[theme];
  return (
    <div
      className={clsx("spx-structure-card", t.border, large && "spx-structure-card-large")}
      style={{ boxShadow: `inset 0 0 40px ${t.glow}` }}
    >
      <div className={clsx("spx-structure-card-header", t.accent)}>
        {/* Pulse only when the feed is actually live; dim static dot otherwise.
            A pulsing "live" dot on a dead feed is a trust violation. */}
        <span className={clsx("badge-live-dot", live ? "animate-pulse" : "opacity-40")} />
        <div>
          <p
            className={clsx(
              "font-syne tracking-[0.12em] uppercase font-bold",
              large ? "text-sm" : "text-[10px] tracking-[0.35em] font-semibold font-mono",
              t.header
            )}
          >
            {title}
          </p>
          <p
            className={clsx(
              "uppercase text-cyan-400",
              large ? "font-mono text-[10px] tracking-[0.25em] mt-0.5" : "font-mono text-[10px] tracking-widest"
            )}
          >
            {subtitle}
          </p>
        </div>
      </div>
      <div className="spx-structure-card-body">{children}</div>
    </div>
  );
}

const TONE_CLASS: Record<string, string> = {
  bull: "text-bull text-glow-green",
  // Small structure values (GEX Net, 0DTE Net, internals) — AA-safe bear fill,
  // keep the red glow for the bearish feel.
  bear: "text-bear-text text-glow-red",
  support: "text-emerald-400",
  resistance: "text-rose-400",
  neutral: "text-sky-200",
  orange: "text-orange-400",
  purple: "text-purple-400",
  blue: "text-sky-400",
  gold: "text-gold",
  magenta: "text-fuchsia-400",
  cyan: "text-cyan-400",
  teal: "text-teal-400",
  violet: "text-violet-300",
};

function Row({
  label,
  value,
  tone = "neutral",
  highlight,
  estimated,
}: {
  label: string;
  value: string;
  tone?: string;
  highlight?: boolean;
  /** FIX-C: true when this reading is a breadth-derived PROXY, not a real internal. */
  estimated?: boolean;
}) {
  return (
    <div className={clsx("spx-structure-row", highlight && "spx-structure-row-hot")}>
      <span className="spx-structure-label">
        {label}
        {estimated && (
          <span
            className="ml-1.5 font-mono text-[8px] tracking-[0.18em] uppercase align-middle text-sky-300"
            title="Estimated from market breadth — no real I:TICK/I:TRIN/I:ADD feed"
          >
            est.
          </span>
        )}
      </span>
      <motion.span
        key={value}
        initial={{ opacity: 0.6, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
        className={clsx("spx-structure-value", TONE_CLASS[tone] ?? TONE_CLASS.neutral)}
      >
        {value}
      </motion.span>
    </div>
  );
}

function LevelRow({
  label,
  value,
  dist,
  live,
  kind,
}: {
  label: string;
  value: number | null;
  dist?: number | null;
  live?: boolean;
  kind?: string;
}) {
  const tone = kind === "support" ? "support" : kind === "resistance" ? "resistance" : "violet";
  return (
    <div className={clsx("spx-structure-level", `spx-structure-level-${kind ?? "neutral"}`)}>
      <span className="spx-structure-label">{label}</span>
      <motion.span
        key={value}
        initial={{ opacity: 0.6 }}
        animate={{ opacity: 1 }}
        className={clsx("spx-structure-value", TONE_CLASS[tone])}
      >
        {live && value != null ? fmtPrice(value) : "—"}
      </motion.span>
      {dist != null && live && (
        <span className={clsx("spx-structure-dist", dist >= 0 ? "num-bull" : "num-bear")}>
          {fmtPct(dist)}
        </span>
      )}
    </div>
  );
}

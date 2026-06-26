"use client";

import { Fragment, useCallback } from "react";
import { clsx } from "clsx";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import { useLiveSpxTape } from "@/hooks/useLiveSpxTape";
import { useStableArray, useStableValue } from "@/hooks/useStableValue";
import { fmtPct, fmtPremium, fmtPrice } from "@/lib/api";
import { Panel as UiPanel, type PanelAccent } from "@/components/ui";

type DeskProps = { desk?: SpxDeskPayload; live?: boolean; refreshing?: boolean };

// Map the legacy per-panel accent class to the UI Panel accent vocab.
const ACCENT_MAP: Record<string, PanelAccent> = {
  "spx-panel-amber": "accent",
  "spx-panel-gold": "accent",
  "spx-panel-purple": "sky",
  "spx-panel-cyan": "accent",
};

/**
 * Desk panel — re-skinned onto the shared UI <Panel> primitive (glass surface,
 * accent top-strip, kicker + title header). The UI Panel supplies the chrome, so we
 * deliberately do NOT carry the legacy `.spx-desk-panel` visual class (border/bg) to
 * avoid doubling it. We DO keep emitting `spx-desk-panel-body` on the body plus the
 * caller's layout/refresh hook classes (`spx-left-tape-panel`, `spx-tape-panel`,
 * `spx-desk-panel-refreshing`, `spx-gex-ladder-*`) so the grid/flex sizing and
 * refresh CSS hooks in globals.css keep applying.
 */
function Panel({
  title,
  subtitle,
  accent,
  children,
  className,
  live,
}: {
  title: string;
  subtitle?: string;
  accent: string;
  children: React.ReactNode;
  className?: string;
  live?: boolean;
}) {
  return (
    <UiPanel
      accent={ACCENT_MAP[accent] ?? "bull"}
      kicker={subtitle}
      title={title}
      // Pulse only when the feed is live; dim static dot otherwise. A pulsing
      // "live" dot on a dead/standby feed is a trust violation.
      actions={
        <span
          className={clsx("badge-live-dot", live ? "animate-pulse" : "opacity-40")}
          aria-hidden
        />
      }
      className={clsx("flex flex-col", className)}
      bodyClassName="spx-desk-panel-body !px-4 !py-3.5"
    >
      {children}
    </UiPanel>
  );
}

const LEADER_TICKERS = ["AAPL", "NVDA", "MSFT", "GOOG", "TSLA", "META"] as const;

export function SpxIntelStrip({ desk, live }: DeskProps) {
  const byTicker = new Map((desk?.leader_stocks ?? []).map((s) => [s.ticker, s]));
  const stocks = LEADER_TICKERS.map(
    (ticker) => byTicker.get(ticker) ?? { ticker, name: ticker, change_pct: 0 }
  );

  return (
    <div className="spx-intel-strip">
      {stocks.map((s) => {
        const hasData = live && byTicker.has(s.ticker);
        const up = s.change_pct >= 0;
        return (
          <div
            key={s.ticker}
            className={clsx(
              "spx-intel-chip spx-stock-chip",
              hasData && (up ? "spx-stock-chip-bull" : "spx-stock-chip-bear")
            )}
          >
            <span className="spx-intel-ticker">{s.ticker}</span>
            <span
              className={clsx(
                "font-mono text-sm tabular-nums font-semibold",
                !hasData && "text-cyan-400",
                hasData && (up ? "num-bull" : "num-bear")
              )}
            >
              {hasData ? fmtPct(s.change_pct) : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function SpxDarkPoolCard({ desk, live }: DeskProps) {
  const dp = desk?.dark_pool;
  const prints = dp?.prints ?? [];

  return (
    <Panel title="Dark Pool" subtitle="SPX · institutional prints" accent="spx-panel-amber" live={live}>
      {!live || !prints.length ? (
        <p className="font-mono text-[11px] text-cyan-400 py-2">{dp?.detail ?? "No prints on the tape"}</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 mb-2">
            <span
              className={clsx(
                "spx-desk-bias-pill",
                dp?.bias === "bullish" && "spx-bias-bull",
                dp?.bias === "bearish" && "spx-bias-bear",
                dp?.bias === "mixed" && "spx-bias-neutral"
              )}
            >
              {dp?.bias}
            </span>
            <span className="font-mono text-xs text-sky-300 tabular-nums">
              {fmtPremium(dp?.total_premium ?? 0)}
              {dp?.pcr != null ? ` · PCR ${dp.pcr}` : ""}
            </span>
          </div>
          <ul className="spx-desk-list">
            {prints.slice(0, 6).map((p, i) => (
              <li key={`${p.executed_at}-${i}`} className="spx-desk-list-row">
                <span className="text-cyan-400 font-mono text-[10px]">
                  {new Date(p.executed_at).toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
                <span className="font-mono text-xs text-white tabular-nums">
                  {p.strike > 0 ? fmtPrice(p.strike) : "—"}
                </span>
                <span className="font-mono text-xs text-gold tabular-nums ml-auto">
                  {fmtPremium(p.premium)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

function tapeSideClass(t: { kind: string; side: string }) {
  if (t.kind === "darkpool") return { tag: "DP", tagClass: "text-gold", labelClass: "text-sky-100" };
  if (t.side === "put") return { tag: "PUT", tagClass: "text-bear-text", labelClass: "text-bear-text" };
  return { tag: "CALL", tagClass: "text-bull", labelClass: "text-bull" };
}

type GexWallRow = { strike: number; net_gex: number; kind: string; distance_pts?: number | null };

/**
 * One GEX-wall row. Bug #93: the ladder is two-sided, so a row can be a CALL wall
 * (positive net_gex → resistance/magnet, bull green) or a PUT wall (negative net_gex →
 * support, bear #ff5c78). The role label is derived from the net_gex SIGN so "Call Wall" /
 * "Put Wall" mean the SAME strike as the canonical Heatmap + Night's Watch (#80). `kind` is
 * GEOMETRIC (strike vs spot); when spot has already traded through a wall (sign ≠ geometry)
 * we append the acting-as role, e.g. "call wall · support".
 */
function renderGexWallRow(w: GexWallRow, spot: number | null) {
  const dist =
    w.distance_pts ?? (spot != null ? Math.round((w.strike - spot) * 100) / 100 : null);
  const hasSign = Number.isFinite(w.net_gex) && w.net_gex !== 0;
  const isPut = w.net_gex < 0; // negative net-gamma => put wall (support)
  const nativeRole = isPut ? "support" : "resistance";
  const roleWord = isPut ? "put wall" : "call wall";
  const roleLabel = !hasSign
    ? w.kind
    : w.kind === nativeRole
      ? `${roleWord} (${nativeRole})`
      : `${roleWord} · ${w.kind}`;
  // Call wall = bull green; put wall = bear #ff5c78 (matches the Heatmap wall palette).
  const callTone = hasSign ? !isPut : w.kind === "resistance";
  return (
    <li
      className={clsx(
        "spx-desk-list-row border-l-2",
        callTone ? "border-l-emerald-500/50" : "border-l-rose-500/50"
      )}
    >
      <span className="font-mono text-[10px] uppercase text-cyan-400 w-16 leading-tight">
        {roleLabel}
      </span>
      <span className="font-mono text-sm text-white tabular-nums">{fmtPrice(w.strike)}</span>
      {dist != null && (
        // Distance is geometry, not direction — kept NEUTRAL (sky) so it can't contradict
        // the bull=green / bear=red wall language carried by the border + net value.
        <span className="font-mono text-[10px] tabular-nums text-sky-300/80">
          {dist >= 0 ? "+" : ""}
          {dist.toFixed(0)} pts
        </span>
      )}
      <span
        className={clsx(
          "font-mono text-xs tabular-nums ml-auto",
          w.net_gex >= 0 ? "num-bull" : "num-bear"
        )}
      >
        {fmtPremium(w.net_gex)}
      </span>
    </li>
  );
}

export function SpxGexLadder({ desk, live, refreshing }: DeskProps) {
  const walls = useStableArray(desk?.gex_walls ?? []);
  const isValidGammaFlip = useCallback((v: number | null | undefined) => v != null, []);
  const isValidGammaRegime = useCallback(
    (v: string | null | undefined) => Boolean(v && v !== "unknown"),
    []
  );
  const gammaFlip = useStableValue(desk?.gamma_flip, isValidGammaFlip);
  const gammaRegime = useStableValue(desk?.gamma_regime, isValidGammaRegime);
  const spot = desk?.price ?? null;
  const hasWalls = walls.length > 0;
  // Gap #7a: when the Massive chain is out, the desk serves last-good walls. gex_stale flags
  // that these nodes are REAL but not live — surface an age badge so a minutes-old wall is
  // never read as a current node (distances re-derive against live price and otherwise look live).
  const gexStale = Boolean(desk?.gex_stale);
  const gexAgeSec =
    desk?.gex_age_ms != null && desk.gex_age_ms > 0 ? Math.round(desk.gex_age_ms / 1000) : null;

  // Bug #93: the ladder is built two-sided (call wall above spot, put wall below). A wall
  // with positive net_gex is a CALL wall (resistance/magnet); negative is a PUT wall
  // (support) — the SAME sign convention as the canonical Heatmap call_wall/put_wall (#80).
  const hasCallWall = walls.some((w) => Number.isFinite(w.net_gex) && w.net_gex > 0);
  // Honest, grounded note: when the live chain has NO positive-net_gex strike anywhere,
  // we do NOT invent a call wall — the day is genuinely put-dominated. (Suppress while
  // serving stale last-good nodes, which may simply pre-date the call wall building.)
  const fullyPutDominated = hasWalls && !hasCallWall && !gexStale;

  return (
    <Panel
      title="GEX Walls"
      subtitle={spot != null ? `0DTE nodes · spot ${fmtPrice(spot)}` : "0DTE gamma nodes"}
      accent="spx-panel-gold"
      live={live && !gexStale}
      className={clsx(refreshing && hasWalls && "spx-desk-panel-refreshing")}
    >
      {gexStale && hasWalls && (
        <p className="font-mono text-[10px] tracking-wider text-gold mb-2 flex items-center gap-1.5">
          <span className="badge-live-dot" style={{ background: "var(--gold, #ffd23f)" }} aria-hidden />
          Last-good nodes{gexAgeSec != null ? ` · ${gexAgeSec}s old` : ""} — not live
        </p>
      )}
      {fullyPutDominated && (
        <p className="font-mono text-[10px] tracking-wider mb-2" style={{ color: "var(--bear-text, #ff5c78)" }}>
          No call wall — fully put-dominated
        </p>
      )}
      {!hasWalls ? (
        <p className="font-mono text-[11px] text-cyan-400 py-2 spx-gex-ladder-empty">
          Mapping gamma nodes…
        </p>
      ) : (
        <ul className="spx-desk-list spx-gex-ladder-list">
          {walls.map((w, i) => {
            // Spot anchor between the call side (above spot) and put side (below). Walls
            // arrive sorted descending by strike, so insert it where strike first drops
            // to/below spot — the boundary that separates resistance from support.
            const prev = i > 0 ? walls[i - 1] : null;
            const showSpotAnchorBefore =
              spot != null && w.strike <= spot && (prev == null || prev.strike > spot);
            return (
              <Fragment key={`${w.kind}-${w.strike}`}>
                {showSpotAnchorBefore && (
                  <li className="spx-gex-ladder-spot" aria-label="spot">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-cyan-300 w-16">
                      ◂ spot ▸
                    </span>
                    <span className="font-mono text-sm tabular-nums text-cyan-200">
                      {fmtPrice(spot!)}
                    </span>
                    <span className="font-mono text-[9px] uppercase tracking-wider text-cyan-400/70 ml-auto">
                      calls ↑ · puts ↓
                    </span>
                  </li>
                )}
                {renderGexWallRow(w, spot)}
              </Fragment>
            );
          })}
        </ul>
      )}
      {gammaFlip != null && (
        <p className="font-mono text-[10px] text-sky-300 mt-2 pt-2 border-t border-white/5">
          γ flip {fmtPrice(gammaFlip)}
          {gammaRegime && gammaRegime !== "unknown"
            ? ` · ${String(gammaRegime).replace("_", " ")}`
            : ""}
        </p>
      )}
    </Panel>
  );
}

export function SpxUnifiedTape({ desk, live, refreshing }: DeskProps) {
  const tape = useLiveSpxTape(desk?.unified_tape);
  const hasTape = tape.length > 0;

  return (
    <Panel
      title="Live Tape"
      subtitle="Flow + dark pool"
      accent="spx-panel-cyan"
      live={live}
      className={clsx(
        "spx-tape-panel spx-left-tape-panel",
        refreshing && hasTape && "spx-desk-panel-refreshing"
      )}
    >
      {!hasTape ? (
        <p className="font-mono text-[11px] text-cyan-400 py-2 spx-tape-empty">Tape quiet…</p>
      ) : (
        <ul className="spx-desk-list spx-tape-list">
          {tape.map((t, i) => {
            const side = tapeSideClass(t);
            return (
              <li key={`${t.kind}-${t.time}-${t.label}-${i}`} className="spx-desk-list-row">
                <span
                  className={clsx(
                    "font-mono text-[10px] uppercase tracking-wider w-12 shrink-0 font-bold",
                    side.tagClass
                  )}
                >
                  {side.tag}
                </span>
                <span className="font-mono text-[11px] text-cyan-400 shrink-0">
                  {t.time
                    ? new Date(t.time).toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                      })
                    : "—"}
                </span>
                <span className={clsx("font-mono text-[13px] truncate font-semibold", side.labelClass)}>
                  {t.label}
                </span>
                <span
                  className={clsx(
                    "font-mono text-sm tabular-nums ml-auto shrink-0 font-bold",
                    t.side === "put" ? "text-bear-text" : t.side === "call" ? "text-bull" : "text-sky-100"
                  )}
                >
                  {fmtPremium(t.premium)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function OdteFlowBar({ desk, live }: { desk?: SpxDeskPayload; live?: boolean }) {
  const calls = desk?.flow_0dte_call_premium ?? 0;
  const puts = desk?.flow_0dte_put_premium ?? 0;
  const total = calls + puts || 1;
  const callPct = (calls / total) * 100;

  if (!live) return null;

  return (
    <div className="spx-odte-bar-wrap">
      <div className="flex justify-between font-mono text-[10px] mb-1">
        <span className="text-bull">0DTE Calls {fmtPremium(calls)}</span>
        <span className="text-bear-text">Puts {fmtPremium(puts)}</span>
      </div>
      <div className="spx-odte-bar">
        <div className="spx-odte-bar-call" style={{ width: `${callPct}%` }} />
      </div>
    </div>
  );
}

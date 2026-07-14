"use client";

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { buildGexLadder, type GexLadder, type GexLadderRow } from "@/features/vector/lib/vector-gex-ladder";
import { horizonScopeShortLabel, type VectorDteHorizon } from "@/features/vector/lib/vector-dte-horizon";

/**
 * GEX signing lens. `oi` (DEFAULT) = our canonical view: static call+/put− weighted by OPEN
 * INTEREST — "what's positioned". `flow` = the FLOW-GEX lens: each strike signed by TODAY'S
 * directional traded flow (dealer short what customers bought at the ask, long what they sold at the
 * bid) — "which way today's trading pushed dealers", the same lens tools like Skylit show.
 */
export type GexLensMode = "oi" | "flow";

// Match the chart's bead colours exactly (VectorChart CALL_WALL_COLOR / PUT_WALL_COLOR) so the
// ladder and the beads read as the same object: gold = call/resistance, purple = put/support.
const CALL_COLOR = "#ffd60a";
const PUT_COLOR = "#d97bff";

const USD_COMPACT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Signed, compact net-GEX label: `+$1.2M` (call) / `-$820K` (put). */
function fmtGex(gex: number): string {
  const sign = gex >= 0 ? "+" : "-";
  return `${sign}$${USD_COMPACT.format(Math.abs(gex))}`;
}

type Props = {
  ticker: string;
  liveSession: boolean;
  /** SSR-seeded spot so the header + empty state aren't blank before the first fetch. */
  initialSpot?: number | null;
  /** DTE horizon from the chart's toggle — the ladder re-scopes to the SAME expiries so it matches
   *  the walls on the chart. "all" = near-term aggregate (default). */
  dteHorizon?: VectorDteHorizon;
};

/** P1-B honesty signal: when a bounded horizon (e.g. 0DTE) had no in-window expiry, the ladder is
 *  really the NEAREST expiry — surfaced so the header labels it honestly, not as the requested DTE. */
type LadderScope = { isFallback: boolean; fallbackExpiry: string | null };
type LadderResponse = {
  spot: number | null;
  asOf: string | null;
  ladder: GexLadder;
  mode?: GexLensMode;
  scope?: LadderScope | null;
};

/**
 * Strike-ladder side panel — the dense per-strike net-GEX column a member scans alongside the
 * chart (Skylit-Atlas parity). The chart collapses each strike to one bead; this shows the whole
 * near-spot gamma structure at once: every strike, its signed net GEX as a magnitude bar (gold
 * call / purple put), and the single dominant "king" per side. Polls /api/market/vector/gex-ladder
 * on its own cadence (off the per-second SSE payload) and re-scopes to the chart's DTE toggle. The
 * ladder is DENSE — every material strike across the fetched chain (Skylit parity), scrolling within
 * the rail — so the panel renders whatever rows the API returns (no client-side row cap).
 */
export function VectorGexLadder({ ticker, liveSession, initialSpot = null, dteHorizon = "all" }: Props) {
  const [ladder, setLadder] = useState<GexLadder>(() => buildGexLadder(null, initialSpot));
  const [spot, setSpot] = useState<number | null>(initialSpot);
  const [asOf, setAsOf] = useState<string | null>(null);
  // P1-B: honest nearest-expiry fallback signal for the header scope label. Null = no fallback / not
  // yet known / flow lens (which is inherently all-expiry, never a per-horizon fallback).
  const [scope, setScope] = useState<LadderScope | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  // GEX signing lens — OI (canonical, default) vs Flow (today's directional flow, Skylit parity).
  // Switching refetches with `?mode=flow` and re-renders the SAME dense ladder off the flow-signed
  // map. Kept local (not URL) so it's a per-panel view choice that doesn't perturb the chart.
  const [mode, setMode] = useState<GexLensMode>("oi");
  const [infoOpen, setInfoOpen] = useState(false);
  // Guard against a slow response for a PREVIOUS ticker landing after a switch and overwriting the
  // new ticker's ladder (same staleness class the chart's fetches guard with a ref check).
  const tickerRef = useRef(ticker);

  useEffect(() => {
    tickerRef.current = ticker;
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(
          `/api/market/vector/gex-ladder?ticker=${encodeURIComponent(ticker)}&dte=${encodeURIComponent(dteHorizon)}&mode=${mode}`
        );
        if (cancelled || tickerRef.current !== ticker) return;
        if (!res.ok) {
          setState("error");
          return;
        }
        const data = (await res.json()) as LadderResponse;
        if (cancelled || tickerRef.current !== ticker) return;
        setLadder(data.ladder ?? buildGexLadder(null, data.spot ?? null));
        setSpot(data.spot ?? null);
        setAsOf(data.asOf ?? null);
        // Flow lens is all-expiry (no per-horizon fallback); only the OI path reports a scope.
        setScope(mode === "flow" ? null : data.scope ?? null);
        setState("ready");
      } catch {
        if (!cancelled && tickerRef.current === ticker) setState("error");
      }
    };

    void load();
    // Live: refresh with the walls cadence (15s). Off-hours: one fetch — the ladder is static.
    const id = liveSession ? setInterval(load, 15_000) : null;
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
  }, [ticker, liveSession, dteHorizon, mode]);

  const rows = ladder.rows;
  // Index of the first row at/below spot — the spot marker slots ABOVE it (rows are strike-desc, so
  // this is the boundary between strikes above spot and strikes at/below it).
  const spotIdx =
    spot != null ? rows.findIndex((r) => r.strike <= spot) : -1;

  // Auto-centre the ladder on spot once per ticker: the rows are strike-descending, so without this
  // the panel opens scrolled to the highest strikes (all calls) and a member has to scroll down to
  // see spot and the puts below it. Centre the spot marker in the viewport on the first ready load
  // (and again when the ticker changes) — but NOT on the 15s live refresh, which would yank the
  // scroll back if the member has scrolled away.
  const listRef = useRef<HTMLOListElement>(null);
  const centeredTickerRef = useRef<string | null>(null);
  // Re-centre on ticker OR horizon change — a narrowed DTE shifts the strike set, so the panel must
  // re-anchor on spot instead of holding the previous horizon's scroll position.
  const centerKey = `${ticker}:${dteHorizon}:${mode}`;
  useEffect(() => {
    if (state !== "ready" || spot == null || rows.length === 0) return;
    if (centeredTickerRef.current === centerKey) return;
    const list = listRef.current;
    if (!list) return;
    const target =
      list.querySelector<HTMLElement>(".vector-gex-ladder-spot") ??
      list.querySelector<HTMLElement>(".vector-gex-ladder-row");
    if (!target) return;
    const t = target.getBoundingClientRect();
    const l = list.getBoundingClientRect();
    list.scrollTop += t.top - l.top - list.clientHeight / 2 + t.height / 2;
    centeredTickerRef.current = centerKey;
  }, [state, spot, rows, centerKey]);

  return (
    <section className="vector-gex-ladder" aria-label={`${ticker} GEX strike ladder`}>
      <header className="vector-gex-ladder-head">
        <span className="vector-gex-ladder-title">GEX Ladder</span>
        <span className="vector-gex-ladder-sub">
          {spot != null ? `spot ${spot.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—"}
          <span
            className={clsx(
              "vector-gex-ladder-scope",
              // P1-B: a fallback scope is a data-honesty caution, styled distinctly so the member
              // reads "this isn't really 0DTE" rather than mistaking the nearest expiry for it.
              scope?.isFallback && "vector-gex-ladder-scope--fallback"
            )}
            title={
              scope?.isFallback && scope.fallbackExpiry
                ? `No ${dteHorizon.toUpperCase()} expiry available — showing the nearest chain (${scope.fallbackExpiry})`
                : undefined
            }
          >
            {" · "}
            {mode === "flow" ? "flow · all exp" : horizonScopeShortLabel(dteHorizon, scope)}
          </span>
        </span>
      </header>

      {/* Lens toggle: canonical OI positioning (default) vs today's flow-signed dealer gamma
          (Skylit parity). The ⓘ opens a plain-English explainer of the two lenses. */}
      <div className="vector-gex-ladder-lens">
        <div className="vector-gex-ladder-lens-toggle" role="group" aria-label="GEX signing lens">
          <button
            type="button"
            className={clsx("vector-gex-ladder-lens-btn", mode === "oi" && "is-active")}
            aria-pressed={mode === "oi"}
            onClick={() => setMode("oi")}
            title="Positioning — static call+/put− weighted by open interest (canonical)"
          >
            Positioning (OI)
          </button>
          <button
            type="button"
            className={clsx("vector-gex-ladder-lens-btn", mode === "flow" && "is-active")}
            aria-pressed={mode === "flow"}
            onClick={() => setMode("flow")}
            title="Flow — each strike signed by today's directional trading (Skylit-style)"
          >
            Flow (today)
          </button>
        </div>
        <button
          type="button"
          className="vector-gex-ladder-lens-info"
          aria-label="What do these lenses mean?"
          aria-expanded={infoOpen}
          onClick={() => setInfoOpen((v) => !v)}
        >
          ⓘ
        </button>
        {infoOpen ? (
          <div className="vector-gex-ladder-lens-pop" role="dialog" aria-label="GEX lens explainer">
            <p>
              <strong>Positioning (OI)</strong> — the standard published dealer-gamma view: calls add
              positive gamma, puts negative, weighted by <em>open interest</em> (the contracts held).
              It shows <em>what&rsquo;s positioned</em>. This is our canonical number and matches every
              other BlackOut surface.
            </p>
            <p>
              <strong>Flow (today)</strong> — signs each strike by <em>today&rsquo;s directional
              trading</em> instead: heavy <em>buying</em> at a strike implies dealers are short it, so
              that strike flips <em>negative</em> even when its open interest is call-heavy. It shows
              <em> which way today&rsquo;s trading pushed dealers</em> — the same lens tools like Skylit
              use.
            </p>
            <p className="vector-gex-ladder-lens-eg">
              Example — a call-heavy strike (lots of call open interest) shows <strong>+</strong> under
              Positioning; if it also saw heavy call <em>buying</em> today, Flow shows it deeply{" "}
              <strong>−</strong>. Same strike, two questions: &ldquo;what&rsquo;s held&rdquo; vs
              &ldquo;what just traded.&rdquo;
            </p>
          </div>
        ) : null}
      </div>

      {state === "error" ? (
        <div className="vector-gex-ladder-empty">GEX ladder unavailable</div>
      ) : rows.length === 0 ? (
        <div className="vector-gex-ladder-empty">
          {state === "loading" ? "Loading GEX ladder…" : "No GEX structure near spot"}
        </div>
      ) : (
        <ol className="vector-gex-ladder-rows" ref={listRef}>
          {rows.map((r, i) => (
            <LadderRow key={r.strike} row={r} showSpotAbove={i === spotIdx} spot={spot} />
          ))}
        </ol>
      )}
    </section>
  );
}

function LadderRow({
  row,
  showSpotAbove,
  spot,
}: {
  row: GexLadderRow;
  showSpotAbove: boolean;
  spot: number | null;
}) {
  const color = row.side === "call" ? CALL_COLOR : PUT_COLOR;
  return (
    <>
      {showSpotAbove && spot != null ? (
        <li className="vector-gex-ladder-spot" aria-hidden="true">
          <span className="vector-gex-ladder-spot-label">
            spot {spot.toLocaleString("en-US", { maximumFractionDigits: 2 })}
          </span>
        </li>
      ) : null}
      <li
        className={clsx(
          "vector-gex-ladder-row",
          `vector-gex-ladder-${row.side}`,
          row.isKing && "vector-gex-ladder-king"
        )}
      >
        <span className="vector-gex-ladder-strike">{row.strike.toLocaleString("en-US")}</span>
        <span className="vector-gex-ladder-bar-track">
          <span
            className="vector-gex-ladder-bar"
            style={{ width: `${Math.max(2, Math.round(row.magnitude * 100))}%`, backgroundColor: color }}
          />
        </span>
        <span className="vector-gex-ladder-val" style={{ color }}>
          {row.isKing ? <span className="vector-gex-ladder-crown" aria-hidden="true">♛</span> : null}
          {fmtGex(row.gex)}
        </span>
      </li>
    </>
  );
}

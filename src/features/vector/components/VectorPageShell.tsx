"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PageShell, FreshnessChip } from "@/components/ui";
import { ProductMark } from "@/components/marks/ProductMark";
import type { VectorBar } from "@/features/vector/components/VectorChart";
import type { VectorDarkPoolLevel, VectorWalls } from "@/lib/api";
import type { WallHistorySample, VectorWallLens } from "@/features/vector/lib/vector-wall-history";
import type { VectorDteHorizon } from "@/features/vector/lib/vector-dte-horizon";
import { VectorTickerSelect } from "@/features/vector/components/VectorTickerSelect";
import { VectorScanner } from "@/features/vector/components/VectorScanner";
import { VectorDeskTerminal } from "@/features/vector/components/VectorDeskTerminal";
import { VectorGexLadder } from "@/features/vector/components/VectorGexLadder";
import { VectorRegimeBanner } from "@/features/vector/components/VectorRegimeBanner";
import { VectorAlertsPanel } from "@/features/vector/components/VectorAlertsPanel";
import type { AlertRule, AlertKind, FiredAlert } from "@/features/vector/lib/vector-alerts";
import { loadAlertRules, saveAlertRules, buildAlertRule, loadNotifyEnabled, saveNotifyEnabled } from "@/features/vector/lib/vector-alerts-store";
import { notificationForFire, shouldSystemNotify } from "@/features/vector/lib/vector-notify";
import { enableVectorNotifications, notifyPermission, presentSystemNotification } from "@/features/vector/lib/vector-notify-client";
import { deriveVectorRegime, type VectorRegime } from "@/features/vector/lib/vector-regime";
import { deriveWallProximity, type WallProximity } from "@/features/vector/lib/vector-wall-proximity";
import { deriveGammaMagnet, type GammaMagnet } from "@/features/vector/lib/vector-gamma-magnet";
import { scoreTopWalls, type WallIntegrity } from "@/features/vector/lib/vector-wall-integrity";
import type { VectorWallEvent } from "@/features/vector/lib/vector-wall-events";
import { VECTOR_DEFAULT_TICKER } from "@/features/vector/lib/vector-ticker";
import { useVectorHorizonSnapshot } from "@/features/vector/lib/use-vector-horizon-snapshot";

const VectorChart = dynamic(
  () => import("@/features/vector/components/VectorChart").then((m) => m.VectorChart),
  {
    ssr: false,
    loading: () => (
      <div
        className="flex min-h-[min(72vh,640px)] items-center justify-center rounded-xl border border-cyan-500/20 bg-black/40 text-sm text-cyan-300"
        role="status"
        aria-live="polite"
      >
        Loading chart…
      </div>
    ),
  }
);

const CANDLE_STALE_MS = 10_000;

type Props = {
  ticker: string;
  initialBars: VectorBar[];
  initialWalls: VectorWalls | null;
  initialVexWalls: VectorWalls | null;
  initialWallHistory: WallHistorySample[];
  initialGammaFlip: number | null;
  initialVexFlip: number | null;
  initialDarkPoolLevels: VectorDarkPoolLevel[];
  sessionYmd: string;
  liveSession: boolean;
};

function formatSessionLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 17, 0, 0));
  return dt.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
  });
}

/** /vector page frame — multi-ticker chart + universe scanner. */
export function VectorPageShell({
  ticker,
  initialBars,
  initialWalls,
  initialVexWalls,
  initialWallHistory,
  initialGammaFlip,
  initialVexFlip,
  initialDarkPoolLevels,
  sessionYmd,
  liveSession,
}: Props) {
  const router = useRouter();
  const sessionLabel = formatSessionLabel(sessionYmd);
  const [streamUpdatedAt, setStreamUpdatedAt] = useState<number | null>(null);
  const [wallEvents, setWallEvents] = useState<VectorWallEvent[]>([]);
  const [lens, setLens] = useState<VectorWallLens>("gex");
  // Mirror the chart's DTE horizon so the GEX ladder re-scopes to the same expiries the walls use.
  // Must match VectorChart's default ("weekly") — this copy drives the GEX ladder's scope label +
  // fetch. When it defaulted to "all" while the chart defaulted to weekly, the ladder's first paint
  // showed the near-term aggregate against a weekly-scoped chart until hydration converged them.
  const [dteHorizon, setDteHorizon] = useState<VectorDteHorizon>("weekly");
  const [now, setNow] = useState<number | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const activeTicker = ticker || VECTOR_DEFAULT_TICKER;

  // THE shared per-(ticker, horizon) snapshot — one fetch cycle (walls+flip, ladder rows,
  // max-pain, expected-move together, one asOf) every 15s in RTH. The chart's displayed levels,
  // the GEX ladder, and the terminal all consume THIS object, so the three surfaces can never
  // show different instants' numbers ("one story" — see vector-horizon-snapshot.ts).
  const horizonSnapshot = useVectorHorizonSnapshot(activeTicker, dteHorizon, liveSession);

  // Seed the regime from the SSR snapshot so the banner is right on first paint;
  // VectorChart streams live updates via onRegimeChange during a session.
  const [regime, setRegime] = useState<VectorRegime>(() =>
    deriveVectorRegime({
      spot: initialBars.length ? initialBars[initialBars.length - 1]!.close : null,
      gammaFlip: initialGammaFlip,
      topCallWall: initialWalls?.callWalls?.[0]?.strike ?? null,
      topPutWall: initialWalls?.putWalls?.[0]?.strike ?? null,
    })
  );
  const [proximity, setProximity] = useState<WallProximity | null>(() =>
    deriveWallProximity({
      spot: initialBars.length ? initialBars[initialBars.length - 1]!.close : null,
      walls: initialWalls,
      gammaFlip: initialGammaFlip,
    })
  );
  const [confluence, setConfluence] = useState<string[] | null>(null);
  // Always-on technicals lines (VWAP/EMA/RSI/MACD/pocket/structure) — narrated by the terminal even
  // when the member hasn't toggled the overlays on the chart.
  const [technicals, setTechnicals] = useState<string[]>([]);
  // Options-implied EXPECTED MOVE callouts (±1σ/2σ range) — narrated by the terminal, horizon-scoped
  // (#15 cone, slice 3a). Empty when the chain has no real ATM IV to price the move.
  const [expectedMove, setExpectedMove] = useState<string[]>([]);
  // Alerts (in-page delivery): the member's rules (persisted per ticker), recent fires (for the
  // panel + terminal), and the transient toast for the newest fire.
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [recentAlerts, setRecentAlerts] = useState<FiredAlert[]>([]);
  const [toast, setToast] = useState<FiredAlert | null>(null);
  // OS-notification opt-in for this device (delivery slice 2). `notifyEnabled` is the member's
  // intent (persisted); `notifyPerm` mirrors the browser permission so the panel can show the real
  // state (granted / denied / needs-prompt). Both are read after mount to stay SSR-safe.
  const [notifyEnabled, setNotifyEnabled] = useState(false);
  const [notifyPerm, setNotifyPerm] = useState<NotificationPermission>("default");
  const [magnet, setMagnet] = useState<GammaMagnet | null>(() =>
    deriveGammaMagnet({
      spot: initialBars.length ? initialBars[initialBars.length - 1]!.close : null,
      walls: initialWalls,
      posture: deriveVectorRegime({
        spot: initialBars.length ? initialBars[initialBars.length - 1]!.close : null,
        gammaFlip: initialGammaFlip,
        topCallWall: initialWalls?.callWalls?.[0]?.strike ?? null,
        topPutWall: initialWalls?.putWalls?.[0]?.strike ?? null,
      }).posture,
    })
  );
  const [wallIntegrity, setWallIntegrity] = useState<{
    call: WallIntegrity | null;
    put: WallIntegrity | null;
  }>(() => scoreTopWalls(initialWalls, initialWallHistory));

  useEffect(() => {
    if (!liveSession) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [liveSession]);

  // Load the member's saved alert rules whenever the ticker changes (and clear the recent history so
  // one ticker's fires don't bleed into another). Persisted per ticker in localStorage.
  useEffect(() => {
    setAlertRules(loadAlertRules(activeTicker));
    setRecentAlerts([]);
    setToast(null);
  }, [activeTicker]);

  // Auto-dismiss the toast a few seconds after the newest fire.
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(id);
  }, [toast]);

  // Hydrate the OS-notification opt-in + live browser permission after mount (localStorage/Notification
  // are client-only). If the member had opted in but later revoked permission in the browser, the
  // panel reflects that mismatch rather than silently pretending alerts will ring.
  useEffect(() => {
    setNotifyEnabled(loadNotifyEnabled());
    setNotifyPerm(notifyPermission());
  }, []);

  // Toggle OS notifications for this device. Enabling prompts for permission (and opportunistically
  // registers a web-push subscription when VAPID is configured — inert otherwise). We only persist
  // the opt-in when permission actually lands 'granted', so a dismissed/denied prompt doesn't leave
  // the toggle stuck "on" with no way for banners to fire.
  const handleToggleNotify = async () => {
    if (notifyEnabled) {
      setNotifyEnabled(false);
      saveNotifyEnabled(false);
      return;
    }
    const perm = await enableVectorNotifications();
    setNotifyPerm(perm);
    const on = perm === "granted";
    setNotifyEnabled(on);
    saveNotifyEnabled(on);
  };

  const persistRules = (next: AlertRule[]) => {
    setAlertRules(next);
    saveAlertRules(activeTicker, next);
  };
  const handleAddRule = (kind: AlertKind, tolerancePct?: number) =>
    persistRules([...alertRules, buildAlertRule(alertRules, activeTicker, kind, tolerancePct)]);
  const handleToggleRule = (id: string) =>
    persistRules(alertRules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
  const handleRemoveRule = (id: string) => persistRules(alertRules.filter((r) => r.id !== id));
  const handleAlertsFired = (fired: FiredAlert[]) => {
    if (!fired.length) return;
    setRecentAlerts((prev) => [...fired].reverse().concat(prev).slice(0, 20));
    setToast(fired[fired.length - 1]!);
    // OS notification (slice 2) — only when the member opted in, granted permission, and the tab is
    // HIDDEN. Permission is read live (not the possibly-stale `notifyPerm`) so a mid-session revoke is
    // honoured. When the tab is visible the toast + terminal already cover it; the OS channel is for
    // the tabbed-away case. `tag`-based dedup in the payload collapses repeated ticks at one level.
    const hidden = typeof document !== "undefined" && document.hidden;
    if (shouldSystemNotify({ enabled: notifyEnabled, permission: notifyPermission(), hidden })) {
      for (const f of fired) void presentSystemNotification(notificationForFire(f));
    }
  };

  const candleAgeSec =
    liveSession && streamUpdatedAt != null && now != null
      ? Math.max(0, Math.floor((now - streamUpdatedAt) / 1000))
      : null;
  const freshnessStatus = !liveSession
    ? "cached"
    : streamUpdatedAt == null
      ? "syncing"
      : candleAgeSec != null && candleAgeSec > CANDLE_STALE_MS / 1000
        ? "stale"
        : "live";

  const kicker =
    activeTicker === "SPX" ? "Live SPX chart" : `Live ${activeTicker} chart`;

  // Compact page title cluster — folded INTO the chart toolbar row (far left) so the header and the
  // timeframe/indicator controls share one line, reclaiming the vertical space the old full-width
  // PageHeader + separate regime block ate. Product decision per member request: maximise chart area.
  const chartLead = (
    <div className="flex items-center gap-2 pr-1">
      <ProductMark product="vector" size={22} animated={false} />
      <span className="font-mono text-sm font-bold uppercase tracking-[0.18em] text-cyan-100">Vector</span>
      <span className="hidden font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-400/60 md:inline">
        · {kicker}
      </span>
      <VectorTickerSelect ticker={activeTicker} />
    </div>
  );
  const chartFreshness = (
    <FreshnessChip
      status={freshnessStatus}
      asOf={liveSession && streamUpdatedAt ? new Date(streamUpdatedAt) : null}
      label={liveSession ? "Live session" : `${sessionLabel} close`}
    />
  );

  return (
    <PageShell fullBleed className="vector-page-shell">
      <div className="px-2 pt-2 sm:px-4 xl:px-6">
        {/* Chart is the hero — it leads the page. The title/ticker/freshness are folded into the
            chart toolbar row, and the regime banner sits just above the canvas. The universe scanner
            is a secondary, collapsible panel below. */}
        <div className="vector-chart-terminal-grid">
          {/* Thin LEFT rail: the per-strike GEX ladder (few rows, dense) — moved off the right so the
              chart gets the centre and the desk terminal owns the full right column. */}
          <div className="vector-ladder-rail">
            <VectorGexLadder
              ticker={activeTicker}
              initialSpot={initialBars.length ? initialBars[initialBars.length - 1]!.close : null}
              dteHorizon={dteHorizon}
              snapshot={horizonSnapshot}
            />
          </div>
          <div className="vector-chart-terminal-chart min-w-0">
            <VectorChart
              // Ticker switches are client-side searchParams navigations — they
              // re-render in place and do NOT remount unkeyed client components.
              // VectorChart seeds bars/walls/SSE from initial props via refs and its
              // mount-only effect owns the EventSource, so without this key a switch
              // to NVDA kept streaming and displaying SPX candles under the NVDA
              // header. Keying forces a clean remount with the new ticker's SSR seed.
              key={activeTicker}
              ticker={activeTicker}
              initialBars={initialBars}
              initialWalls={initialWalls}
              initialVexWalls={initialVexWalls}
              initialWallHistory={initialWallHistory}
              initialGammaFlip={initialGammaFlip}
              initialVexFlip={initialVexFlip}
              initialDarkPoolLevels={initialDarkPoolLevels}
              sessionYmd={sessionYmd}
              liveSession={liveSession}
              onFreshness={liveSession ? setStreamUpdatedAt : undefined}
              onWallEventsChange={setWallEvents}
              onLensChange={setLens}
              onRegimeChange={setRegime}
              onProximityChange={setProximity}
              onMagnetChange={setMagnet}
              onConfluenceChange={setConfluence}
              onWallIntegrityChange={setWallIntegrity}
              onDteHorizonChange={setDteHorizon}
              onTechnicalsChange={setTechnicals}
              onExpectedMoveChange={setExpectedMove}
              horizonSnapshot={horizonSnapshot}
              alertRules={alertRules}
              onAlertsFired={handleAlertsFired}
              leadSlot={chartLead}
              trailSlot={chartFreshness}
              regimeSlot={<VectorRegimeBanner regime={regime} />}
            />
          </div>
          {/* Full RIGHT column: the desk terminal narration — the main thing that scrolls, so it
              gets the width and height (ladder moved to the thin left rail above). */}
          <div className="vector-terminal-rail">
            <VectorDeskTerminal
              ticker={activeTicker}
              lens={lens}
              wallEvents={wallEvents}
              liveSession={liveSession}
              streamUpdatedAt={streamUpdatedAt}
              snapshotAsOf={horizonSnapshot?.asOf ?? null}
              proximity={proximity}
              magnet={magnet}
              confluence={confluence}
              technicals={technicals}
              expectedMove={expectedMove}
              alerts={recentAlerts.slice(0, 5).map((f) => f.message)}
              wallIntegrity={wallIntegrity}
            />
            <VectorAlertsPanel
              ticker={activeTicker}
              rules={alertRules}
              recent={recentAlerts}
              onAdd={handleAddRule}
              onToggle={handleToggleRule}
              onRemove={handleRemoveRule}
              notifyEnabled={notifyEnabled}
              notifyPermission={notifyPerm}
              onToggleNotify={handleToggleNotify}
            />
          </div>
        </div>

        {/* Transient toast for the newest fired alert (in-page delivery; Web Push lands in slice 2). */}
        {toast && (
          <div className="vector-alert-toast" role="status" aria-live="polite">
            <span className="vector-alert-toast-dot" aria-hidden="true" />
            <span className="vector-alert-toast-msg">🔔 {toast.message}</span>
            <button type="button" className="vector-alert-toast-x" onClick={() => setToast(null)} aria-label="Dismiss">
              ✕
            </button>
          </div>
        )}

        <details className="vector-scanner-panel" open={scannerOpen}>
          <summary
            className="vector-scanner-summary"
            onClick={(e) => {
              e.preventDefault();
              setScannerOpen((v) => !v);
            }}
          >
            <span className="vector-scanner-summary-label">Universe scanner</span>
            <span className="vector-scanner-summary-hint">
              {scannerOpen ? "Hide" : "Gamma structure across the liquid universe"}
            </span>
          </summary>
          <div className="vector-scanner-body">
            <VectorScanner
              activeTicker={activeTicker}
              onSelect={(t) =>
                router.push(t === VECTOR_DEFAULT_TICKER ? "/vector" : `/vector?ticker=${encodeURIComponent(t)}`)
              }
            />
          </div>
        </details>
      </div>
    </PageShell>
  );
}

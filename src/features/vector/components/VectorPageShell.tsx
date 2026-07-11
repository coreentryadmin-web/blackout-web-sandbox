"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PageShell, PageHeader, FreshnessChip } from "@/components/ui";
import { ProductMark } from "@/components/marks/ProductMark";
import type { VectorBar } from "@/features/vector/components/VectorChart";
import type { VectorDarkPoolLevel, VectorWalls } from "@/lib/api";
import type { WallHistorySample, VectorWallLens } from "@/features/vector/lib/vector-wall-history";
import { VectorTickerSelect } from "@/features/vector/components/VectorTickerSelect";
import { VectorScanner } from "@/features/vector/components/VectorScanner";
import { VectorDeskTerminal } from "@/features/vector/components/VectorDeskTerminal";
import { VectorRegimeBanner } from "@/features/vector/components/VectorRegimeBanner";
import { deriveVectorRegime, type VectorRegime } from "@/features/vector/lib/vector-regime";
import { deriveWallProximity, type WallProximity } from "@/features/vector/lib/vector-wall-proximity";
import type { VectorWallEvent } from "@/features/vector/lib/vector-wall-events";
import { VECTOR_DEFAULT_TICKER } from "@/features/vector/lib/vector-ticker";

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
  const [now, setNow] = useState<number | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const activeTicker = ticker || VECTOR_DEFAULT_TICKER;

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

  useEffect(() => {
    if (!liveSession) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [liveSession]);

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

  return (
    <PageShell fullBleed className="vector-page-shell">
      <div className="px-2 sm:px-4 xl:px-6">
        <PageHeader
          kicker={kicker}
          title="Vector"
          badge={<ProductMark product="vector" size={40} animated={false} />}
          actions={
            <div className="flex flex-wrap items-center gap-3">
              <VectorTickerSelect ticker={activeTicker} />
              <FreshnessChip
                status={freshnessStatus}
                asOf={liveSession && streamUpdatedAt ? new Date(streamUpdatedAt) : null}
                label={liveSession ? "Live session" : `${sessionLabel} close`}
              />
            </div>
          }
        />
        {/* Gamma regime read — the plain-English "what this positioning means"
            strip. Leads the chart so the member frames the walls correctly. */}
        <div className="mt-3">
          <VectorRegimeBanner regime={regime} />
        </div>
        {/* Chart is the hero — it leads the page. The universe scanner is a
            secondary, collapsible panel below (it used to occupy the entire
            first viewport, pushing the actual chart below the fold). */}
        <div className="mt-3 vector-chart-terminal-grid">
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
            />
          </div>
          <VectorDeskTerminal
            ticker={activeTicker}
            lens={lens}
            wallEvents={wallEvents}
            liveSession={liveSession}
            streamUpdatedAt={streamUpdatedAt}
            proximity={proximity}
          />
        </div>

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

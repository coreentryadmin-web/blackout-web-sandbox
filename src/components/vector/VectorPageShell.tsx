"use client";

import { useEffect, useState } from "react";
import { PageShell, PageHeader, FreshnessChip } from "@/components/ui";
import { ProductMark } from "@/components/marks/ProductMark";
import { VectorChart, type VectorBar } from "@/components/vector/VectorChart";
import type { VectorDarkPoolLevel, VectorWalls } from "@/lib/api";
import type { WallHistorySample } from "@/lib/providers/vector-wall-history";

const CANDLE_STALE_MS = 10_000;

type Props = {
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

/** /vector page frame — mirrors the other tool shells' (e.g. NighthawkPageShell) PageShell/PageHeader/ProductMark structure. */
export function VectorPageShell({
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
  const sessionLabel = formatSessionLabel(sessionYmd);
  const [streamUpdatedAt, setStreamUpdatedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const subtitle = liveSession
    ? "SPX live chart · 1m/3m/5m/15m · GEX/VEX wall beads · flip + dark-pool guides."
    : `Showing ${sessionLabel} session — scrub replay to watch GEX and VEX walls form through the day.`;

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

  return (
    <PageShell fullBleed className="vector-page-shell">
      <div className="px-2 sm:px-4 xl:px-6">
        <PageHeader
          kicker="Live SPX chart"
          title="Vector"
          subtitle={subtitle}
          badge={<ProductMark product="vector" size={44} animated={false} />}
          actions={
            <FreshnessChip
              status={freshnessStatus}
              asOf={liveSession && streamUpdatedAt ? new Date(streamUpdatedAt) : null}
              label={liveSession ? "Live session" : "Session close"}
            />
          }
        />
        <div className="mt-5">
          <VectorChart
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
          />
        </div>
      </div>
    </PageShell>
  );
}

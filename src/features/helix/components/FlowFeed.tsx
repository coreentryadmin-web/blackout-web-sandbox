"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { clsx } from "clsx";
import {
  fetchFlows, fetchEarningsCalendar, fetchDarkPoolPrints,
  createFlowEventSource, fmtPremium,
  type FlowAlert, type DarkPoolRow,
} from "@/lib/api";
import { computeFlowStrikeStacks } from "@/lib/largo/flow-strike-stacks";
import { getSector } from "@/lib/sector-map";
import { HelixFlowTable } from "@/features/helix/components/HelixFlowTable";
import { HelixCommandBar } from "@/features/helix/components/HelixCommandBar";
import {
  HELIX_INDEX_TICKERS,
  matchesDteFilter,
  type HelixDteFilter,
  type HelixTableDensity,
} from "@/features/helix/lib/helix-table-columns";
import { daysToExpiry } from "@/features/helix/lib/helix-flow-format";
import { FlowBrief } from "@/features/helix/components/FlowBrief";
import { NetPremiumLeaderboard } from "@/features/helix/components/NetPremiumLeaderboard";
import { StrikeStackDetector } from "@/features/helix/components/StrikeStackDetector";
import dynamic from "next/dynamic";
// Code-split: recharts lives only inside FlowMomentumChart, so lazy-load it
// (ssr:false) to keep recharts out of the initial /flows client chunk. The
// chart already renders client-side once >=2 samples exist, so deferring it is
// behavior-identical; the loading placeholder matches its 72px container.
const FlowMomentumChart = dynamic(
  () => import("@/features/helix/components/FlowMomentumChart").then((m) => m.FlowMomentumChart),
  { ssr: false, loading: () => <div className="flow-panel"><div className="flow-panel-header"><span className="flow-panel-title">Cumulative Net Prem (running)</span></div><div className="px-1 pt-2 pb-1"><div className="h-[72px]"><Skeleton width="100%" height={72} rounded="md" /></div></div></div> },
);
import { DarkPoolPanel } from "@/features/helix/components/DarkPoolPanel";
import { TickerDrawer } from "@/features/helix/components/TickerDrawer";
import { ContractDrilldownDrawer } from "@/features/helix/components/ContractDrilldownDrawer";
import { SplitFlowRadar, type SplitFlowEntry } from "@/features/helix/components/SplitFlowRadar";
import { VelocityRadar, type VelocityEntry } from "@/features/helix/components/VelocityRadar";
import { SectorFlowPanel, type SectorFlowEntry } from "@/features/helix/components/SectorFlowPanel";
import { NightHawkFlowPanel, type NightHawkPlayWithFlow } from "@/features/helix/components/NightHawkFlowPanel";
import { WatchlistBar } from "@/features/helix/components/WatchlistBar";
import { useWatchlist } from "@/hooks/useWatchlist";
import { Skeleton } from "@/components/ui";
import type { NightHawkEdition } from "@/features/nighthawk/lib/types";
import { useIosNativeShell } from "@/hooks/useIosNativeShell";
import { IosNativeSegment } from "@/components/ios/IosNativeSegment";
import { IosSectionHeader } from "@/components/ios/IosSectionHeader";
import { IosNativeChipRail } from "@/components/ios/IosNativeChipRail";

const PREMIUM_PRESETS = [200_000, 500_000, 1_000_000, 20_000_000] as const;
// Audit gap #16: the client floor MUST match the server ingest floor (flow-persist
// MIN_PREMIUM, default UW_FLOW_MIN_PREMIUM = $200K). A $100K floor was dead UI — no
// row below $200K is ever persisted, so requesting them returned nothing. Keep this
// in sync with UW_FLOW_MIN_PREMIUM if that env is lowered server-side.
const FLOOR_PREMIUM = 200_000;
const WHALE_PREMIUM = 1_000_000;
type TypeFilter = "ALL" | "CALL" | "PUT";
const FLOW_POLL_MS   = 30_000;
const REPLAY_TICK_MS = 450;

// Audit gap #6: a usable alerted_at timestamp. parseUwFlowAlert now emits "" (and the
// persist layer null) when UW gave no real time — those must be EXCLUDED from the LIVE
// badge + sorted last, never coerced to now() (which faked a fresh tape). Returns the
// epoch ms, or null when the row has no trustworthy time.
function alertedAtMs(a: { alerted_at?: string | null }): number | null {
  if (!a.alerted_at) return null;
  const ms = new Date(a.alerted_at).getTime();
  return Number.isFinite(ms) ? ms : null;
}

// Audit gap #13: dedup on the canonical alert_id the persist layer used for the
// Postgres ON-CONFLICT. SSE rows now carry alert_id; DB-served REST rows do not, so we
// fall back to the seconds-precision composite for cross-path (REST↔SSE) matching. The
// SSE path registers BOTH keys so a reconnect can't slip a duplicate past either one.
function flowCompositeKey(a: { ticker: string; strike: number; option_type: string; alerted_at?: string | null }): string {
  return `${a.ticker}|${a.strike}|${a.option_type}|${String(a.alerted_at ?? "").slice(0, 19)}`;
}
function flowAlertId(a: { alert_id?: string }): string | null {
  return a.alert_id ? `id:${a.alert_id}` : null;
}

// Bug 14: synthetic beep for whale prints (>$1M) using Web Audio API
function playWhaleBeep() {
  if (typeof AudioContext === "undefined") return;
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch { /* AudioContext unavailable in this environment */ }
}

function exportCSV(alerts: FlowAlert[]) {
  try {
    const header = "Ticker,Type,Strike,Expiry,Premium,Fill,DTE,Score,Route,Alert Rule,Alerted At\n";
    const rows = alerts.map((a) =>
      [a.ticker, a.option_type, a.strike, a.expiry, a.premium, a.fill_price ?? "",
       a.dte ?? "", a.score ?? "", a.route ?? "", a.alert_rule ?? "", a.alerted_at].join(",")
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `helix-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error("[FlowFeed] CSV export failed:", e);
    alert("Export failed — check console for details.");
  }
}

export function FlowFeed() {
  // Data
  const [alerts, setAlerts]               = useState<FlowAlert[]>([]);
  const nativeShell = useIosNativeShell();
  const [iosView, setIosView] = useState<"tape" | "analytics">("tape");
  const [helixToolsOpen, setHelixToolsOpen] = useState(false);
  const [loading, setLoading]             = useState(true);
  const [live, setLive]                   = useState(false);
  // Filters
  const [minPremium, setMinPremium]       = useState(200_000);
  const [typeFilter, setTypeFilter]       = useState<TypeFilter>("ALL");
  const [whalesOnly, setWhalesOnly]         = useState(false);
  const [dteFilter, setDteFilter]           = useState<HelixDteFilter>("all");
  const [indicesOnly, setIndicesOnly]       = useState(false);
  const [density, setDensity]               = useState<HelixTableDensity>("standard");
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [tickerFilter, setTickerFilter]   = useState("");
  // UI
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  // Store the FULL clicked print, not just ticker/strike/expiry — the drilldown window
  // renders that print's own real payload (premium, fill, spot-at-fill, OI/IV/OTM/DTE,
  // rule tags, gamma-wall proximity), then fetches aggregate contract activity on top.
  const [selectedContract, setSelectedContract] = useState<FlowAlert | null>(null);
  // P2: saved-tickers watchlist (localStorage-backed, client-only)
  const watchlist = useWatchlist();
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  const [showMorePanels, setShowMorePanels] = useState(false);
  const [replayMode, setReplayMode]         = useState(false);
  const [replayAlerts, setReplayAlerts]     = useState<FlowAlert[]>([]);
  // Bug 12: replay speed control
  const [replaySpeed, setReplaySpeed]       = useState<number>(1);
  // Bug 14: audio toggle
  const [audioEnabled, setAudioEnabled]     = useState(false);
  const audioEnabledRef                     = useRef(false);

  // Feature 7: earnings calendar
  const [earningsMap, setEarningsMap] = useState<Record<string, string>>({});
  // Feature 2: dark pool prints for coordination signal
  const [darkPoolPrints, setDarkPoolPrints] = useState<DarkPoolRow[]>([]);
  // Feature 12: Night Hawk edition for flow conviction
  const [nighthawkEdition, setNighthawkEdition] = useState<NightHawkEdition | null>(null);

  const seenRef         = useRef(new Set<string>());
  const loadGenerationRef = useRef(0);
  const replaySourceRef = useRef<FlowAlert[]>([]);
  const replayIdxRef    = useRef(0);
  const replayTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  // Bug 14: keep ref in sync so SSE closure always reads current value
  useEffect(() => { audioEnabledRef.current = audioEnabled; }, [audioEnabled]);

  // Feature 7: earnings calendar (cached 12h server-side). Refresh on an interval so a
  // long-open session picks up calendar changes without a manual reload (was mount-only).
  useEffect(() => {
    const load = () =>
      fetchEarningsCalendar().then(setEarningsMap).catch((e) => console.warn("[FlowFeed] earnings fetch:", e));
    load();
    const id = setInterval(load, 30 * 60_000);
    return () => clearInterval(id);
  }, []);

  // Feature 2: dark pool prints for coordination detection (refresh every 60s)
  useEffect(() => {
    const load = () =>
      fetchDarkPoolPrints({ min_premium: 500_000 })
        .then((d) => setDarkPoolPrints(d.prints ?? []))
        .catch((e) => console.warn("[FlowFeed] dark-pool fetch:", e));
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  // Feature 12: Night Hawk latest edition.
  // Auto-refresh every 120s (mirrors NightHawkFeed's SWR refreshInterval) so the
  // edition is picked up across the ~4:30/5:30pm ET cron boundary — the prior
  // bare mount-only fetch left /flows frozen on a stale (often empty) edition.
  useEffect(() => {
    const load = () =>
      fetch("/api/market/nighthawk/edition", { credentials: "same-origin", cache: "no-store" })
        .then((r) => r.ok ? r.json() : null)
        .then((d: NightHawkEdition | null) => { if (d?.plays) setNighthawkEdition(d); })
        .catch((e) => console.warn("[FlowFeed] nighthawk edition fetch:", e));
    load();
    const id = setInterval(load, 120_000);
    return () => clearInterval(id);
  }, []);

  // Derived counts for filter pills — single pass over alerts instead of two
  // full filter() scans, and one memo recompute per SSE message instead of two.
  // (Both still depend on `alerts`; a new alert legitimately changes the counts,
  // so they must recompute — but we do it once, in O(n), not twice.)
  const applyTapeFilters = useCallback(
    (base: FlowAlert[], { includeType = true }: { includeType?: boolean } = {}) => {
      let rows = base.filter((a) => a.premium >= Math.max(FLOOR_PREMIUM, minPremium));
      if (tickerFilter) rows = rows.filter((a) => a.ticker === tickerFilter.toUpperCase());
      if (watchlistOnly && watchlist.watchlistSet.size > 0) {
        rows = rows.filter((a) => watchlist.watchlistSet.has(a.ticker));
      }
      if (whalesOnly) rows = rows.filter((a) => a.premium >= WHALE_PREMIUM);
      if (indicesOnly) {
        rows = rows.filter((a) =>
          (HELIX_INDEX_TICKERS as readonly string[]).includes(a.ticker)
        );
      }
      if (dteFilter !== "all") {
        rows = rows.filter((a) => {
          const dte = a.dte ?? daysToExpiry(a.expiry);
          return matchesDteFilter(dte, dteFilter);
        });
      }
      if (includeType && typeFilter !== "ALL") {
        rows = rows.filter((a) => a.option_type === typeFilter);
      }
      return rows;
    },
    [
      minPremium,
      tickerFilter,
      watchlistOnly,
      watchlist.watchlistSet,
      whalesOnly,
      indicesOnly,
      dteFilter,
      typeFilter,
    ]
  );

  // Filter-scoped counts for CALL/PUT/ALL pills — match active tape filters except side.
  const countSource = useMemo(
    () => applyTapeFilters(replayMode ? replayAlerts : alerts, { includeType: false }),
    [applyTapeFilters, replayMode, replayAlerts, alerts]
  );

  const { callCount, putCount, allCount } = useMemo(() => {
    let call = 0, put = 0;
    for (const a of countSource) {
      if (a.option_type === "CALL") call++;
      else if (a.option_type === "PUT") put++;
    }
    return { callCount: call, putCount: put, allCount: call + put };
  }, [countSource]);

  // Bug 9: limit input to recent 500 alerts for strike-stack computation performance
  const compoundTickers = useMemo<Set<string>>(() => {
    const stacks = computeFlowStrikeStacks(alerts.slice(0, 500), { minAlerts: 2, limit: 20 });
    return new Set(stacks.map((s) => s.ticker));
  }, [alerts]);

  // Feature 6: detect opposing call+put flow within 30-min window (>= $500K each leg)
  const splitFlowMap = useMemo<Map<string, SplitFlowEntry>>(() => {
    const now       = Date.now();
    const WINDOW_MS = 30 * 60 * 1000;
    const MIN_LEG   = 500_000;
    const byTicker  = new Map<string, { callPrem: number; putPrem: number }>();

    for (const alert of alerts) {
      // Gap #6: a row with no trustworthy alerted_at must be EXCLUDED from the 30-min
      // split window — not silently kept (NaN compare fell through the old guard) where
      // it could fabricate an opposing-flow signal out of an undated print.
      const ms = alertedAtMs(alert);
      if (ms == null || now - ms > WINDOW_MS) continue;
      const cur = byTicker.get(alert.ticker) ?? { callPrem: 0, putPrem: 0 };
      if (alert.option_type === "CALL") cur.callPrem += alert.premium;
      else if (alert.option_type === "PUT") cur.putPrem += alert.premium;
      byTicker.set(alert.ticker, cur);
    }

    const result = new Map<string, SplitFlowEntry>();
    for (const [ticker, { callPrem, putPrem }] of Array.from(byTicker)) {
      if (callPrem >= MIN_LEG && putPrem >= MIN_LEG) {
        const total   = callPrem + putPrem;
        const callPct = Math.round((callPrem / total) * 100);
        result.set(ticker, {
          ticker,
          callPremium: callPrem,
          putPremium:  putPrem,
          callPct,
          total,
          direction: callPct >= 60 ? "bullish" : callPct <= 40 ? "bearish" : "mixed",
        });
      }
    }
    return result;
  }, [alerts]);

  const splitFlowTickers = useMemo(() => new Set(splitFlowMap.keys()), [splitFlowMap]);
  const splitFlowEntries = useMemo(
    () => Array.from(splitFlowMap.values()).sort((a, b) => b.total - a.total),
    [splitFlowMap]
  );

  // Feature 7: earnings days until event (ticker → days, only ≤ 30d shown)
  const earningsDays = useMemo<Record<string, number>>(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const out: Record<string, number> = {};
    for (const [ticker, dateStr] of Object.entries(earningsMap)) {
      const d    = new Date(dateStr + "T00:00:00");
      const diff = Math.floor((d.getTime() - today.getTime()) / 86_400_000);
      if (diff >= 0 && diff <= 30) out[ticker] = diff;
    }
    return out;
  }, [earningsMap]);

  // Feature 1: velocity spike detection — prints per 15min vs prior 15min window
  const { velocityEntries, velocitySpikeTickers } = useMemo(() => {
    const now      = Date.now();
    const R_MS     = 15 * 60 * 1000; // recent window
    const P_MS     = 30 * 60 * 1000; // prior window end
    const byTicker = new Map<string, { recent: number; prior: number; recentPremium: number }>();

    for (const alert of alerts) {
      // Velocity must use the REAL alert time (event_at), not alerted_at — a
      // just-ingested stale print has alerted_at≈now and would fake a spike. Prints
      // with no known event_at (UW gave no timestamp) are skipped, not assumed recent.
      if (!alert.event_at) continue;
      const age = now - new Date(alert.event_at).getTime();
      if (!Number.isFinite(age)) continue;
      const cur = byTicker.get(alert.ticker) ?? { recent: 0, prior: 0, recentPremium: 0 };
      if (age <= R_MS) {
        cur.recent++;
        cur.recentPremium += alert.premium;
      } else if (age <= P_MS) {
        cur.prior++;
      }
      byTicker.set(alert.ticker, cur);
    }

    const spikes: VelocityEntry[] = [];
    for (const [ticker, { recent, prior, recentPremium }] of Array.from(byTicker)) {
      const ratio = recent / Math.max(1, prior);
      if (recent >= 2 && ratio >= 3) {
        spikes.push({ ticker, recent, prior, ratio, recentPremium });
      }
    }
    spikes.sort((a, b) => b.ratio - a.ratio);

    return {
      velocityEntries: spikes.slice(0, 8),
      velocitySpikeTickers: new Set(spikes.map((e) => e.ticker)),
    };
  }, [alerts]);

  // Feature 2: coordinated signal — dark pool block + options sweep on same ticker within 5 min
  const coordinatedTickers = useMemo<Set<string>>(() => {
    if (!darkPoolPrints.length) return new Set();
    const WINDOW_MS = 5 * 60 * 1000;
    const coordinated = new Set<string>();

    for (const alert of alerts) {
      // Gap #6: raw new Date(alerted_at) was NaN for undated rows, so abs(NaN) > WINDOW
      // is always false and COORD never fired. Use alertedAtMs (the file's helper) and
      // skip rows with no trustworthy time — they can't be time-correlated to a block.
      const alertTime = alertedAtMs(alert);
      if (alertTime == null) continue;
      const hasBlock = darkPoolPrints.some(
        (dp) =>
          dp.ticker === alert.ticker &&
          Math.abs(new Date(dp.executed_at).getTime() - alertTime) <= WINDOW_MS
      );
      if (hasBlock) coordinated.add(alert.ticker);
    }
    return coordinated;
  }, [alerts, darkPoolPrints]);

  // Feature 11: sector rotation — aggregate flow premium by sector
  const sectorFlowEntries = useMemo<SectorFlowEntry[]>(() => {
    const map = new Map<string, { callPremium: number; putPremium: number }>();

    for (const alert of alerts) {
      const sector = getSector(alert.ticker);
      const cur = map.get(sector) ?? { callPremium: 0, putPremium: 0 };
      if (alert.option_type === "CALL") cur.callPremium += alert.premium;
      else if (alert.option_type === "PUT") cur.putPremium += alert.premium;
      // gap-#6: UNKNOWN/typeless prints count toward NEITHER side (never fabricate a put)
      map.set(sector, cur);
    }

    return Array.from(map.entries())
      .map(([sector, { callPremium, putPremium }]) => {
        const total   = callPremium + putPremium;
        const callPct = total > 0 ? Math.round((callPremium / total) * 100) : 50;
        return { sector, callPremium, putPremium, total, callPct };
      })
      .filter((e) => e.total >= 100_000)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [alerts]);

  // Feature 12: Night Hawk plays enriched with flow conviction from the 7d tape.
  // R-46: pre-group alerts by ticker in one O(n) pass so each play lookup below is
  // O(1) — eliminates the original O(n·m) where n=alerts.length, m=plays.length.
  const { nighthawkPlaysWithFlow, hawkTickers } = useMemo(() => {
    if (!nighthawkEdition?.plays?.length) {
      return { nighthawkPlaysWithFlow: [] as NightHawkPlayWithFlow[], hawkTickers: new Set<string>() };
    }

    // Build a ticker → alerts Map in one pass so each play does an O(1) Map.get()
    // instead of scanning the full alerts array with filter() × 3.
    const alertsByTicker = new Map<string, { callPremium: number; putPremium: number; topPrint: number; count: number }>();
    for (const a of alerts) {
      const e = alertsByTicker.get(a.ticker) ?? { callPremium: 0, putPremium: 0, topPrint: 0, count: 0 };
      if (a.option_type === "CALL") e.callPremium += a.premium;
      else if (a.option_type === "PUT") e.putPremium += a.premium;
      if (a.premium > e.topPrint) e.topPrint = a.premium;
      e.count += 1;
      alertsByTicker.set(a.ticker, e);
    }

    const playsWithFlow: NightHawkPlayWithFlow[] = nighthawkEdition.plays.map((play) => {
      const agg = alertsByTicker.get(play.ticker) ?? { callPremium: 0, putPremium: 0, topPrint: 0, count: 0 };
      const { callPremium, putPremium, topPrint, count: printCount } = agg;
      const totalPremium = callPremium + putPremium;

      const isLong = play.direction?.toLowerCase().includes("long") ||
                     play.direction?.toLowerCase().includes("bull");
      const flowCallPct    = totalPremium > 0 ? callPremium / totalPremium : 0.5;
      const flowAgreement  = isLong ? flowCallPct >= 0.55 : flowCallPct <= 0.45;

      const conviction = totalPremium >= 2_000_000 && flowAgreement ? "strong"
        : totalPremium >= 500_000 ? "moderate"
        : totalPremium > 0       ? "weak"
        : "none";

      return {
        ...play,
        flowData: { callPremium, putPremium, totalPremium, topPrint, printCount, flowAgreement, conviction },
      } as NightHawkPlayWithFlow;
    });

    return {
      nighthawkPlaysWithFlow: playsWithFlow,
      hawkTickers: new Set(nighthawkEdition.plays.map((p) => p.ticker)),
    };
  }, [nighthawkEdition, alerts]);

  // ── Data loading ──────────────────────────────────────────────────────────
  const loadFlows = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    try {
      const d = await fetchFlows({ min_premium: Math.max(FLOOR_PREMIUM, minPremium), ticker: tickerFilter || undefined });
      if (generation !== loadGenerationRef.current) return;
      // Bug 1 + gap #13: rebuild seenRef from REST so SSE can't re-add duplicates after a
      // reconnect. Seed BOTH the canonical alert_id (when the row carries one) and the
      // composite fallback, so an incoming SSE echo matches on whichever key it shares.
      const seeded = new Set<string>();
      for (const a of d.flows as Array<FlowAlert & { alert_id?: string }>) {
        const id = flowAlertId(a);
        if (id) seeded.add(id);
        seeded.add(flowCompositeKey(a));
      }
      seenRef.current = seeded;
      setAlerts(d.flows);
      setLive(true);
    } catch {
      setLive(false);
    } finally {
      setLoading(false);
    }
  }, [minPremium, tickerFilter]);

  useEffect(() => { setLoading(true); loadFlows(); }, [loadFlows]);

  useEffect(() => {
    let poll: ReturnType<typeof setInterval> | null = null;
    const go   = () => { if (!poll) poll = setInterval(loadFlows, FLOW_POLL_MS); };
    const stop = () => { if (poll) { clearInterval(poll); poll = null; } };

    const conn = createFlowEventSource(
      (alert) => {
        // Gap #13: prefer the canonical alert_id (matches the persist ON-CONFLICT id);
        // the composite is the cross-path fallback that tolerates sub-second drift vs the
        // DB-served REST rows (which carry no alert_id). A hit on EITHER key is a dupe.
        const widened = alert as FlowAlert & { alert_id?: string };
        const idKey = flowAlertId(widened);
        const compositeKey = flowCompositeKey(alert);
        if ((idKey && seenRef.current.has(idKey)) || seenRef.current.has(compositeKey)) return;
        if (idKey) seenRef.current.add(idKey);
        seenRef.current.add(compositeKey);
        // Trim seenRef when it grows large; keep newest 1000 to prevent unbounded memory growth
        if (seenRef.current.size > 2000) {
          const entries = Array.from(seenRef.current);
          seenRef.current = new Set(entries.slice(-1000));
        }
        setAlerts((prev) => [alert, ...prev]);
        setLive(true);
        // Bug 14: play beep for whale prints when audio is enabled
        if (audioEnabledRef.current && alert.premium >= 1_000_000) playWhaleBeep();
      },
      { onOpen: () => { setLive(true); stop(); }, onClose: () => { setLive(false); go(); loadFlows(); } }
    );
    if (conn) return () => { conn.close(); stop(); };
    go();
    return () => stop();
  }, [loadFlows]);

  // ── Replay ────────────────────────────────────────────────────────────────
  const startReplay = useCallback(() => {
    if (!alerts.length) return;
    const sorted = [...alerts].sort((a, b) => new Date(a.alerted_at).getTime() - new Date(b.alerted_at).getTime());
    replaySourceRef.current = sorted;
    replayIdxRef.current    = 0;
    setReplayAlerts([]);
    setReplayMode(true);
    if (replayTimerRef.current) clearInterval(replayTimerRef.current);
    replayTimerRef.current = setInterval(() => {
      const idx = replayIdxRef.current;
      const src = replaySourceRef.current;
      if (idx >= src.length) { if (replayTimerRef.current) clearInterval(replayTimerRef.current); return; }
      setReplayAlerts((prev) => [src[idx], ...prev]);
      replayIdxRef.current = idx + 1;
    }, REPLAY_TICK_MS / Math.max(0.1, replaySpeed));
  }, [alerts, replaySpeed]);

  // Bug 12: restart replay interval when speed changes mid-replay
  useEffect(() => {
    if (!replayMode) return;
    if (replayTimerRef.current) clearInterval(replayTimerRef.current);
    const src = replaySourceRef.current;
    replayTimerRef.current = setInterval(() => {
      const idx = replayIdxRef.current;
      if (idx >= src.length) { if (replayTimerRef.current) clearInterval(replayTimerRef.current); return; }
      setReplayAlerts((prev) => [src[idx], ...prev]);
      replayIdxRef.current = idx + 1;
    }, REPLAY_TICK_MS / Math.max(0.1, replaySpeed));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replaySpeed, replayMode]);

  const stopReplay = useCallback(() => {
    if (replayTimerRef.current) { clearInterval(replayTimerRef.current); replayTimerRef.current = null; }
    setReplayMode(false);
    setReplayAlerts([]);
  }, []);

  useEffect(() => () => { if (replayTimerRef.current) clearInterval(replayTimerRef.current); }, []);

  const displayAlerts = useMemo(() => {
    const base = replayMode ? replayAlerts : alerts;
    const filtered = applyTapeFilters(base);
    return [...filtered].sort((a, b) => {
      const am = alertedAtMs(a);
      const bm = alertedAtMs(b);
      if (am == null && bm == null) return 0;
      if (am == null) return 1;
      if (bm == null) return -1;
      return bm - am;
    });
  }, [replayMode, replayAlerts, alerts, applyTapeFilters]);

  // Tape freshness — newest print age drives an honest LIVE/STALE badge.
  // Connection success alone is NOT data freshness: a stale tape over a weekend
  // or a dead ingest must read STALE, not green LIVE.
  // Gap #6: derive "newest" from the freshest row with a TRUSTWORTHY alerted_at —
  // never from a row whose time UW omitted (those would otherwise read as epoch 0 /
  // NaN and either falsely age the tape or mask a genuinely stale one).
  const newestAt = useMemo(() => {
    let max = 0;
    for (const a of displayAlerts) {
      const ms = alertedAtMs(a);
      if (ms != null && ms > max) max = ms;
    }
    return max;
  }, [displayAlerts]);
  // Age ticker — without this the "Ns ago" label and the 5-min Stale flip only
  // advance when a new flow event arrives, so during quiet periods the displayed
  // age freezes (and a tape can read "Live" past the stale threshold). A 10s timer
  // re-renders ONLY this label off the already-held newestAt — no network fetch.
  // 10s precision is sufficient: the stale threshold is 5 min and the age label
  // rounds to the nearest second/minute anyway.
  const [ageTick, setAgeTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setAgeTick((t) => t + 1), 10_000);
    return () => clearInterval(id);
  }, []);
  const dataAgeMs = useMemo(
    () => (newestAt ? Date.now() - newestAt : null),
    // ageTick is intentional: it is the heartbeat that re-evaluates Date.now().
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [newestAt, ageTick],
  );
  const dataStale = dataAgeMs != null && dataAgeMs > 5 * 60_000;
  const newestAgeLabel =
    dataAgeMs == null
      ? "—"
      : dataAgeMs < 60_000
        ? `${Math.round(dataAgeMs / 1000)}s ago`
        : dataAgeMs < 3_600_000
          ? `${Math.round(dataAgeMs / 60_000)}m ago`
          : `${Math.round(dataAgeMs / 3_600_000)}h ago`;

  const flowTapeProps = {
    flows: displayAlerts,
    live,
    loading,
    density,
    typeFilter,
    tickerFilter,
    hasData: alerts.length > 0,
    filteredCount: displayAlerts.length,
    compoundTickers,
    onTickerClick: setSelectedTicker,
    onContractClick: (flow: FlowAlert) => setSelectedContract(flow),
    replayMode,
    splitFlowTickers,
    earningsDays,
    velocitySpikeTickers,
    coordinatedTickers,
    hawkTickers,
    watchlistTickers: watchlist.watchlistSet,
    onToggleStar: watchlist.toggle,
  };

  const analyticsRail = (
    <>
      {nativeShell ? (
        <IosSectionHeader
          label="Analytics"
          action={{
            label: showMorePanels ? "Fewer panels" : "More panels",
            onClick: () => setShowMorePanels((v) => !v),
          }}
        />
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="helix-pro-rail-section-label">Analytics</span>
          <button
            type="button"
            onClick={() => setShowMorePanels((v) => !v)}
            className="helix-pro-tool-btn"
          >
            {showMorePanels ? "Fewer panels" : "More panels"}
          </button>
        </div>
      )}
      <NetPremiumLeaderboard alerts={alerts} loading={loading} />
      <StrikeStackDetector alerts={alerts} onSelectTicker={setSelectedTicker} />
      <DarkPoolPanel />
      {showMorePanels && (
        <>
          <VelocityRadar entries={velocityEntries} onTickerClick={setSelectedTicker} />
          <NightHawkFlowPanel
            plays={nighthawkPlaysWithFlow}
            editionFor={nighthawkEdition?.edition_for}
            onTickerClick={setSelectedTicker}
          />
          <SplitFlowRadar entries={splitFlowEntries} onTickerClick={setSelectedTicker} />
          <SectorFlowPanel entries={sectorFlowEntries} />
          <FlowMomentumChart alerts={alerts} />
        </>
      )}
    </>
  );

  return (
    <div className="desk-layout helix-desk helix-pro-desk helix-desk-terminal">
      {nativeShell && <FlowBrief />}

      {/* ── Watchlist rail (P2) ─────────────────────────────────────────── */}
      {!nativeShell && (
        <WatchlistBar
          watchlist={watchlist.watchlist}
          activeTicker={tickerFilter}
          onSelect={(t) => setTickerFilter(t)}
          onRemove={watchlist.remove}
          onClear={() => { watchlist.clear(); setWatchlistOnly(false); }}
        />
      )}

      {nativeShell && (
        <IosNativeSegment
          value={iosView}
          onChange={setIosView}
          accent="#bf5fff"
          aria-label="HELIX lens"
          className="ios-native-desk-segment"
          segments={[
            { id: "tape", label: "Live tape" },
            { id: "analytics", label: "Analytics" },
          ]}
        />
      )}

      {nativeShell && watchlist.watchlist.length > 0 && (
        <IosNativeChipRail
          ariaLabel="Watchlist"
          value={tickerFilter}
          onChange={setTickerFilter}
          chips={[
            { id: "", label: "ALL" },
            ...watchlist.watchlist.map((t) => ({ id: t, label: t })),
          ]}
        />
      )}

      {/* ── Filter bar ──────────────────────────────────────────────────── */}
      {nativeShell ? (
        <div
          className={clsx(
            "helix-native-toolbar",
            nativeShell && iosView !== "tape" && "ios-native-panel-hidden"
          )}
        >
          <IosSectionHeader
            label="Tape filters"
            action={{
              label: helixToolsOpen ? "Hide tools" : "More tools",
              onClick: () => setHelixToolsOpen((v) => !v),
            }}
          />
          <div className="helix-native-toolbar-row">
            <div className="flow-seg-group">
              {(["ALL", "CALL", "PUT"] as TypeFilter[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTypeFilter(t)}
                  className={clsx(
                    "flow-seg-btn",
                    typeFilter === t &&
                      (t === "CALL"
                        ? "flow-seg-btn-active-call"
                        : t === "PUT"
                          ? "flow-seg-btn-active-put"
                          : "flow-seg-btn-active-all")
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
            <input
              value={tickerFilter}
              onChange={(e) => {
                const val = e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6);
                setTickerFilter(val);
              }}
              placeholder="Ticker"
              aria-label="Search ticker"
              maxLength={6}
              className="font-mono font-bold rounded-lg border bg-[rgba(8,9,14,0.85)] outline-none tracking-widest uppercase border-[rgba(0,230,118,0.35)] text-[#00e676] placeholder:text-[rgba(0,230,118,0.35)]"
            />
          </div>
          <div className="helix-native-toolbar-row">
            <div className="flow-seg-group">
              {PREMIUM_PRESETS.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setMinPremium(v)}
                  className={clsx("flow-seg-btn", minPremium === v && "flow-seg-btn-active-all")}
                >
                  {v >= 1_000_000 ? `$${v / 1_000_000}M+` : `$${v / 1000}K+`}
                </button>
              ))}
            </div>
          </div>
          {helixToolsOpen ? (
            <div className="helix-native-toolbar-tools">
              <button
                type="button"
                onClick={replayMode ? stopReplay : startReplay}
                disabled={!replayMode && alerts.length === 0}
                className={clsx(
                  "font-mono text-[10px] font-semibold px-3 py-[5px] rounded-lg border transition-all",
                  replayMode
                    ? "border-gold/70 text-gold bg-gold/15"
                    : "border-[rgba(0,230,118,0.3)] text-[#00e676]"
                )}
              >
                {replayMode ? "■ Stop" : "▶ Replay"}
              </button>
              {replayMode &&
                [0.5, 1, 2].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setReplaySpeed(s)}
                    className={clsx(
                      "font-mono text-[10px] px-1.5 py-[3px] rounded border",
                      replaySpeed === s
                        ? "bg-gold/20 text-gold border-gold/60"
                        : "text-cyan-400 border-white/10"
                    )}
                  >
                    {s}×
                  </button>
                ))}
              <button
                type="button"
                onClick={() => setAudioEnabled((v) => !v)}
                className={clsx(
                  "font-mono text-[10px] font-semibold px-2 py-[5px] rounded-lg border",
                  audioEnabled ? "border-purple/60 text-purple-light bg-purple/15" : "border-white/10 text-cyan-400"
                )}
              >
                {audioEnabled ? "Audio on" : "Audio"}
              </button>
              <button
                type="button"
                onClick={() => setWatchlistOnly((v) => !v)}
                disabled={watchlist.watchlist.length === 0}
                className={clsx(
                  "font-mono text-[10px] font-semibold px-2 py-[5px] rounded-lg border disabled:opacity-30",
                  watchlistOnly ? "border-gold/70 text-gold bg-gold/15" : "border-cyan-800/40 text-cyan-400"
                )}
              >
                ★ Watch
              </button>
              <button
                type="button"
                onClick={() => exportCSV(displayAlerts)}
                disabled={displayAlerts.length === 0}
                className="font-mono text-[10px] font-semibold px-2 py-[5px] rounded-lg border border-white/10 text-cyan-400 disabled:opacity-30"
              >
                Export CSV
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <HelixCommandBar
          minPremium={minPremium}
          onMinPremiumChange={setMinPremium}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          callCount={callCount}
          putCount={putCount}
          allCount={allCount}
          tickerFilter={tickerFilter}
          onTickerFilterChange={setTickerFilter}
          whalesOnly={whalesOnly}
          onWhalesOnlyChange={setWhalesOnly}
          dteFilter={dteFilter}
          onDteFilterChange={setDteFilter}
          indicesOnly={indicesOnly}
          onIndicesOnlyChange={setIndicesOnly}
          watchlistOnly={watchlistOnly}
          onWatchlistOnlyChange={setWatchlistOnly}
          watchlistCount={watchlist.watchlist.length}
          density={density}
          onDensityChange={setDensity}
          analyticsOpen={analyticsOpen}
          onAnalyticsOpenChange={setAnalyticsOpen}
          replayMode={replayMode}
          onReplayToggle={replayMode ? stopReplay : startReplay}
          replaySpeed={replaySpeed}
          onReplaySpeedChange={setReplaySpeed}
          audioEnabled={audioEnabled}
          onAudioToggle={() => setAudioEnabled((v) => !v)}
          onExportCsv={() => exportCSV(displayAlerts)}
          exportDisabled={displayAlerts.length === 0}
          loading={loading}
          live={live}
          dataStale={dataStale}
          displayCount={displayAlerts.length}
          newestAgeLabel={newestAgeLabel}
          replayDisabled={!replayMode && alerts.length === 0}
        />
      )}

      {/* ── Main grid — table-first; analytics optional ─────────────────── */}
      <div
        className={clsx(
          "helix-desk-terminal-grid",
          !analyticsOpen && !nativeShell && "helix-desk-terminal-grid--tape-max",
          nativeShell && iosView !== "tape" && "ios-native-panel-hidden",
          nativeShell && iosView === "tape" && "ios-native-panel-visible"
        )}
      >
        <div
          key={nativeShell ? iosView : "tape"}
          className="helix-desk-tape-col helix-ios-tape-col"
        >
          <HelixFlowTable {...flowTapeProps} />
        </div>
        {(analyticsOpen || (nativeShell && iosView === "analytics")) && (
          <div
            key={nativeShell ? iosView : "analytics"}
            className={clsx(
              "helix-desk-analytics-rail helix-ios-analytics-col helix-pro-rail",
              nativeShell && iosView !== "analytics" && "ios-native-panel-hidden",
              nativeShell && iosView === "analytics" && "ios-native-panel-visible"
            )}
          >
            {analyticsRail}
          </div>
        )}
      </div>

      {/* Ticker drawer — all prints for symbol */}
      <TickerDrawer
        ticker={selectedTicker}
        typeFilter={typeFilter}
        onClose={() => setSelectedTicker(null)}
        isStarred={selectedTicker ? watchlist.watchlistSet.has(selectedTicker) : false}
        onToggleStar={watchlist.toggle}
      />

      {/* Contract drilldown — per-leg volume/OI/fill history (FLOWCHECKER-style) */}
      <ContractDrilldownDrawer
        flow={selectedContract}
        onClose={() => setSelectedContract(null)}
        onViewTicker={(t) => {
          setSelectedContract(null);
          setSelectedTicker(t);
        }}
      />

      {/* Persistent compliance disclaimer (matches SPX / GEX wording) */}
      <p className="helix-pro-disclaimer">
        Educational. Not advice. You decide.
      </p>
    </div>
  );
}

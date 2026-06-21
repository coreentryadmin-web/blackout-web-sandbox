"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import { fetchFlows, createFlowEventSource, fmtPremium, type FlowAlert } from "@/lib/api";
import { computeFlowStrikeStacks } from "@/lib/largo/flow-strike-stacks";
import { FlowAlertStream } from "@/components/desk/FlowAlertStream";
import { FlowBrief } from "@/components/desk/FlowBrief";
import { NetPremiumLeaderboard } from "@/components/desk/NetPremiumLeaderboard";
import { StrikeStackDetector } from "@/components/desk/StrikeStackDetector";
import { FlowMomentumChart } from "@/components/desk/FlowMomentumChart";
import { DarkPoolPanel } from "@/components/desk/DarkPoolPanel";
import { TickerDrawer } from "@/components/desk/TickerDrawer";

const PREMIUM_PRESETS = [200_000, 500_000, 1_000_000, 20_000_000] as const;
const FLOOR_PREMIUM = 100_000;
type TypeFilter = "ALL" | "CALL" | "PUT";
const FLOW_POLL_MS   = 30_000;
const REPLAY_TICK_MS = 450;

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

// Bug 15: CSV export of current tape
function exportCSV(alerts: FlowAlert[]) {
  const header = "Ticker,Type,Strike,Expiry,Premium,DTE,Score,Route,Alert Rule,Alerted At\n";
  const rows = alerts.map((a) =>
    [a.ticker, a.option_type, a.strike, a.expiry, a.premium,
     a.dte ?? "", a.score ?? "", a.route ?? "", a.alert_rule ?? "", a.alerted_at].join(",")
  ).join("\n");
  const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `helix-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function FlowFeed() {
  // Data
  const [alerts, setAlerts]               = useState<FlowAlert[]>([]);
  const [loading, setLoading]             = useState(true);
  const [live, setLive]                   = useState(false);
  // Filters
  const [minPremium, setMinPremium]       = useState(200_000);
  const [typeFilter, setTypeFilter]       = useState<TypeFilter>("ALL");
  const [tickerFilter, setTickerFilter]   = useState("");
  // UI
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [replayMode, setReplayMode]         = useState(false);
  const [replayAlerts, setReplayAlerts]     = useState<FlowAlert[]>([]);
  // Bug 12: replay speed control
  const [replaySpeed, setReplaySpeed]       = useState<number>(1);
  // Bug 14: audio toggle
  const [audioEnabled, setAudioEnabled]     = useState(false);
  const audioEnabledRef                     = useRef(false);

  const seenRef         = useRef(new Set<string>());
  const replaySourceRef = useRef<FlowAlert[]>([]);
  const replayIdxRef    = useRef(0);
  const replayTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  // Bug 14: keep ref in sync so SSE closure always reads current value
  useEffect(() => { audioEnabledRef.current = audioEnabled; }, [audioEnabled]);

  // Derived counts for filter pills
  const callCount = useMemo(() => alerts.filter((a) => a.option_type === "CALL").length, [alerts]);
  const putCount  = useMemo(() => alerts.filter((a) => a.option_type === "PUT").length, [alerts]);

  // Bug 9: limit input to recent 500 alerts for strike-stack computation performance
  const compoundTickers = useMemo<Set<string>>(() => {
    const stacks = computeFlowStrikeStacks(alerts.slice(0, 500), { minAlerts: 2, limit: 20 });
    return new Set(stacks.map((s) => s.ticker));
  }, [alerts]);

  // ── Data loading ──────────────────────────────────────────────────────────
  const loadFlows = useCallback(async () => {
    try {
      const d = await fetchFlows({ min_premium: Math.max(FLOOR_PREMIUM, minPremium), ticker: tickerFilter || undefined });
      // Bug 1: rebuild seenRef from REST data so SSE can't add duplicates after reconnect
      seenRef.current = new Set(
        d.flows.map((a: FlowAlert) => `${a.ticker}|${a.strike}|${a.option_type}|${String(a.alerted_at).slice(0, 19)}`)
      );
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
        // Bug 1: seconds-precision key tolerates sub-second timestamp drift between SSE and DB
        const id = `${alert.ticker}|${alert.strike}|${alert.option_type}|${String(alert.alerted_at).slice(0, 19)}`;
        if (seenRef.current.has(id)) return;
        seenRef.current.add(id);
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
    }, REPLAY_TICK_MS / replaySpeed);
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
    }, REPLAY_TICK_MS / replaySpeed);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replaySpeed, replayMode]);

  const stopReplay = useCallback(() => {
    if (replayTimerRef.current) { clearInterval(replayTimerRef.current); replayTimerRef.current = null; }
    setReplayMode(false);
    setReplayAlerts([]);
  }, []);

  useEffect(() => () => { if (replayTimerRef.current) clearInterval(replayTimerRef.current); }, []);

  const displayAlerts = useMemo(() => {
    let base = replayMode ? replayAlerts : alerts;
    base = base.filter((a) => a.premium >= Math.max(FLOOR_PREMIUM, minPremium));
    if (tickerFilter) base = base.filter((a) => a.ticker === tickerFilter.toUpperCase());
    return [...base].sort((a, b) => b.premium - a.premium);
  }, [replayMode, replayAlerts, alerts, tickerFilter, minPremium]);

  return (
    <div className="desk-layout flex flex-col gap-4">
      {/* ── AI Brief ────────────────────────────────────────────────────── */}
      <FlowBrief alerts={alerts} />

      {/* ── Filter bar ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Premium presets */}
        <span className="font-mono text-[9px] tracking-[0.3em] uppercase font-bold hidden sm:block" style={{color:"#00e566",textShadow:"0 0 8px rgba(0,229,102,0.6)"}}>MIN</span>
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

        {/* Type filter */}
        <div className="flow-seg-group">
          {(["ALL", "CALL", "PUT"] as TypeFilter[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(t)}
              className={clsx(
                "flow-seg-btn",
                typeFilter === t && (
                  t === "CALL" ? "flow-seg-btn-active-call" :
                  t === "PUT"  ? "flow-seg-btn-active-put"  :
                                 "flow-seg-btn-active-all"
                )
              )}
            >
              {t}
              {t === "CALL" && <span className="flow-count-pill">{callCount}</span>}
              {t === "PUT"  && <span className="flow-count-pill">{putCount}</span>}
              {t === "ALL"  && <span className="flow-count-pill">{alerts.length}</span>}
            </button>
          ))}
        </div>

        {/* Bug 18: ticker input — sanitized to uppercase letters only, max 6 chars */}
        <div className="relative">
          <input
            value={tickerFilter}
            onChange={(e) => {
              const val = e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6);
              setTickerFilter(val);
            }}
            placeholder="TICKER"
            maxLength={6}
            className={clsx(
              "font-mono text-[13px] font-bold px-4 py-2 rounded-lg border bg-zinc-950 outline-none w-32 tracking-widest uppercase",
              "border-[rgba(0,255,102,0.35)] text-[#00e566] placeholder:text-[rgba(0,229,102,0.35)]",
              "focus:border-[rgba(0,255,102,0.8)] focus:ring-2 focus:ring-[rgba(0,255,102,0.15)] transition-all"
            )}
            style={{ textShadow: tickerFilter ? "0 0 10px rgba(0,229,102,0.6)" : "none" }}
          />
          <AnimatePresence>
            {tickerFilter && (
              <motion.button
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                type="button"
                onClick={() => setTickerFilter("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 font-mono text-sm font-bold"
              >
                ×
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {/* Replay button */}
        <button
          type="button"
          onClick={replayMode ? stopReplay : startReplay}
          disabled={!replayMode && alerts.length === 0}
          className={clsx(
            "font-mono text-[10px] font-semibold px-3 py-[5px] rounded-lg border transition-all",
            replayMode
              ? "border-amber-600/70 text-amber-300 bg-amber-950/50 hover:bg-amber-950/70"
              : "border-[rgba(0,255,102,0.3)] text-[#00e566] hover:text-[#39ff85] hover:border-[rgba(0,255,102,0.6)] disabled:opacity-30 disabled:cursor-not-allowed"
          )}
        >
          {replayMode ? "■ Stop" : "▶ Replay"}
        </button>

        {/* Bug 12: replay speed control — only visible during replay */}
        <AnimatePresence>
          {replayMode && (
            <motion.div
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              exit={{ opacity: 0, width: 0 }}
              className="flex gap-0.5 overflow-hidden"
            >
              {[0.5, 1, 2].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setReplaySpeed(s)}
                  className={clsx(
                    "font-mono text-[9px] px-1.5 py-[3px] rounded transition-colors whitespace-nowrap",
                    replaySpeed === s
                      ? "bg-amber-800/60 text-amber-200 border border-amber-700/60"
                      : "text-zinc-600 hover:text-zinc-400 bg-zinc-900 border border-zinc-800"
                  )}
                >
                  {s}×
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bug 14: audio alert toggle */}
        <button
          type="button"
          onClick={() => setAudioEnabled((v) => !v)}
          title="Toggle audio alert for whale prints (>$1M)"
          className={clsx(
            "font-mono text-[9px] font-semibold px-2 py-[5px] rounded-lg border transition-all",
            audioEnabled
              ? "border-violet-600/60 text-violet-300 bg-violet-950/40"
              : "border-zinc-800 text-zinc-600 hover:text-zinc-400 hover:border-zinc-700"
          )}
        >
          {audioEnabled ? "AUDIO ON" : "AUDIO"}
        </button>

        {/* Bug 15: CSV export */}
        <button
          type="button"
          onClick={() => exportCSV(displayAlerts)}
          disabled={displayAlerts.length === 0}
          className="font-mono text-[9px] font-semibold px-2 py-[5px] rounded-lg border border-zinc-800 text-zinc-600 hover:text-zinc-400 hover:border-zinc-700 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          title="Export current tape to CSV"
        >
          CSV
        </button>

        {/* Right: stats + live indicator */}
        <div className="ml-auto flex items-center gap-4">
          <AnimatePresence mode="wait">
            <motion.span
              key={`${alerts.length}-${loading}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              className="font-mono text-[10px] text-zinc-300 hidden sm:block"
            >
              {loading ? "Scanning…" : `${alerts.length} alerts · ${fmtPremium(displayAlerts[0]?.premium ?? 0)} latest`}
            </motion.span>
          </AnimatePresence>

          {/* Live indicator */}
          <div className="flex items-center gap-2">
            <div className="flow-live-dot">
              <span className={clsx(
                "w-1.5 h-1.5 rounded-full block relative z-10",
                live ? "bg-emerald-400" : "bg-zinc-700"
              )} />
            </div>
            <span className={clsx(
              "font-mono text-[9px] tracking-widest uppercase",
              live ? "text-emerald-500" : "text-zinc-700"
            )}>
              {live ? "Live" : "Offline"}
            </span>
          </div>
        </div>
      </div>

      {/* ── Main grid ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Flow tape — 8 cols */}
        <div className="xl:col-span-8">
          <FlowAlertStream
            flows={displayAlerts}
            live={live}
            loading={loading}
            typeFilter={typeFilter}
            tickerFilter={tickerFilter}
            hasData={alerts.length > 0}
            compoundTickers={compoundTickers}
            onTickerClick={setSelectedTicker}
            replayMode={replayMode}
          />
        </div>

        {/* Right column — 4 cols */}
        <div className="xl:col-span-4 flex flex-col gap-3">
          <NetPremiumLeaderboard alerts={alerts} />
          <StrikeStackDetector alerts={alerts} onSelectTicker={setSelectedTicker} />
          <FlowMomentumChart alerts={alerts} />
          <DarkPoolPanel />
        </div>
      </div>

      {/* Ticker drawer — Bug 13: typeFilter passed so drawer matches tape */}
      <TickerDrawer ticker={selectedTicker} typeFilter={typeFilter} onClose={() => setSelectedTicker(null)} />
    </div>
  );
}

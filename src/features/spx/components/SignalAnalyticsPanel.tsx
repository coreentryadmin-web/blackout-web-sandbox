"use client";

import { useState, useEffect, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SummaryStats {
  total_observations: number;
  observations_with_outcomes: number;
  overall_accuracy: number;
  avg_score: number;
  date_range: { from: string; to: string };
}

interface SignalCorrelation {
  label: string;
  fire_count: number;
  avg_weight: number;
  accuracy_pct: number;
  baseline_accuracy: number;
  edge: number;
  bullish_accuracy: number;
  bearish_accuracy: number;
}

interface ScoreBand {
  band: string;
  count: number;
  accuracy_pct: number;
  avg_move_30m: number;
}

interface SessionWindow {
  window: string;
  count: number;
  accuracy_pct: number;
  avg_score: number;
  avg_move_30m: number;
}

interface GateBlock {
  gate: string;
  block_count: number;
  block_pct: number;
}

interface Observation {
  id: string;
  observed_at: string;
  price: number;
  score: number;
  grade: string;
  direction: string | null;
  engine_action: string;
  session_window: string;
  factors: Array<{ label: string; weight: number }>;
  gates_blocked: Array<{ gate: string; detail: string }>;
  outcome_move: number | null;
  direction_correct: boolean | null;
}

interface HourlyAccuracy {
  hour: number;
  count: number;
  accuracy_pct: number;
}

interface SignalAnalyticsData {
  summary: SummaryStats;
  signal_correlations: SignalCorrelation[];
  score_band_performance: ScoreBand[];
  session_window_performance: SessionWindow[];
  gate_block_frequency: GateBlock[];
  recent_observations: Observation[];
  hourly_accuracy: HourlyAccuracy[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function accuracyColor(pct: number): string {
  if (pct > 55) return "text-emerald-400";
  if (pct >= 50) return "text-yellow-400";
  return "text-red-400";
}

function edgeColor(edge: number): string {
  if (edge > 5) return "text-emerald-400";
  if (edge >= 2) return "text-yellow-400";
  return "text-white/40";
}

function gradeColor(grade: string): string {
  switch (grade) {
    case "A+": case "A": return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    case "B+": case "B": return "bg-cyan-500/20 text-cyan-400 border-cyan-500/30";
    case "C+": case "C": return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    default: return "bg-red-500/20 text-red-400 border-red-500/30";
  }
}

function actionColor(action: string): string {
  switch (action) {
    case "APPROVE_BUY": case "APPROVE_SELL": return "text-emerald-400";
    case "WATCHING": return "text-yellow-400";
    default: return "text-white/40";
  }
}

function actionLabel(action: string): string {
  if (action === "APPROVE_BUY") return "BUY";
  if (action === "APPROVE_SELL") return "SELL";
  if (action === "WATCHING") return "WATCH";
  return action.replace(/_/g, " ");
}

function sessionWindowLabel(w: string): string {
  switch (w) {
    case "morning_orb": return "Morning ORB";
    case "lunch_chop": return "Lunch Chop";
    case "afternoon": return "Afternoon";
    case "power_hour": return "Power Hour";
    default: return w.replace(/_/g, " ");
  }
}

function sessionWindowClass(w: string): string {
  if (w === "morning_orb" || w === "power_hour") return "text-cyan-400";
  if (w === "lunch_chop") return "text-yellow-400";
  return "text-white";
}

function formatHour(h: number): string {
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${h12}${suffix}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
  } catch {
    return iso;
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value, sub, valueClass }: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
}) {
  return (
    <div className="bg-black/40 border border-white/10 rounded-xl p-4 flex flex-col gap-1">
      <span className="text-xs text-white/40 uppercase tracking-widest font-mono">{label}</span>
      <span className={`text-2xl font-mono font-bold ${valueClass ?? "text-white"}`}>{value}</span>
      {sub && <span className="text-xs text-white/40 font-mono">{sub}</span>}
    </div>
  );
}

function AccuracyBar({ pct }: { pct: number }) {
  const color = pct > 55 ? "bg-emerald-500" : pct >= 50 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className={`text-xs font-mono ${accuracyColor(pct)}`}>{pct.toFixed(1)}%</span>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-black/40 border border-white/10 rounded-xl p-4 h-20" />
        ))}
      </div>
      <div className="bg-black/40 border border-white/10 rounded-xl h-48" />
      <div className="bg-black/40 border border-white/10 rounded-xl h-40" />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
      <div className="text-4xl font-mono text-white/10">◈</div>
      <p className="text-white/40 font-mono text-sm">Start RTH to begin collecting signal data</p>
      <p className="text-white/20 font-mono text-xs">Minimum 10 observations required for analytics</p>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function SignalAnalyticsPanel() {
  const [days, setDays] = useState<7 | 14 | 30>(7);
  const [data, setData] = useState<SignalAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/signal-analytics?days=${days}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setLastRefresh(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [days]);

  // Auto-refresh: new signal observations log continuously during RTH, so a one-shot
  // load went stale until someone hit the manual "↻ Refresh" button. Poll every 60s
  // (this is a rolling N-day aggregate, not tick-level data — no need for a faster
  // cadence) and refetch on window focus, same pattern as the other live panels.
  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const isEmpty = !loading && !error && data != null && data.summary.total_observations < 10;

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-1 bg-black/40 border border-white/10 rounded-lg p-1">
          {([7, 14, 30] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1 rounded text-xs font-mono transition-colors ${
                days === d
                  ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                  : "text-white/40 hover:text-white/70"
              }`}
            >
              {d}D
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="text-xs text-white/30 font-mono">
              {lastRefresh.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-1.5 bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-mono rounded hover:bg-cyan-500/20 transition-colors disabled:opacity-50"
          >
            {loading ? "Loading…" : "↻ Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm font-mono">
          Error: {error}
        </div>
      )}

      {loading && <Skeleton />}
      {!loading && !error && isEmpty && <EmptyState />}

      {!loading && !error && data && !isEmpty && (
        <div className="space-y-6">

          {/* ─── Section 1: Summary Bar ──────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Total Observations"
              value={data.summary.total_observations.toLocaleString()}
              sub={`${data.summary.observations_with_outcomes} with outcome`}
            />
            <StatCard
              label="Overall Accuracy"
              value={`${data.summary.overall_accuracy.toFixed(1)}%`}
              valueClass={accuracyColor(data.summary.overall_accuracy)}
              sub={data.summary.observations_with_outcomes > 0 ? `of ${data.summary.observations_with_outcomes} closed` : undefined}
            />
            <StatCard
              label="Avg Score"
              value={data.summary.avg_score.toFixed(2)}
              sub="composite signal score"
            />
            <StatCard
              label="Date Range"
              value={`${formatDate(data.summary.date_range.from)}–${formatDate(data.summary.date_range.to)}`}
              sub={`${days}-day window`}
            />
          </div>

          {/* ─── Section 2: Signal Correlation Table ─────────────────────── */}
          <div className="bg-black/40 border border-white/10 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-white/10 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xs font-mono text-white uppercase tracking-widest">Signal Correlation</h3>
                <p className="text-xs text-white/30 font-mono mt-0.5">
                  Edge = accuracy when signal fired vs baseline. Positive = signal has real alpha.
                </p>
              </div>
              <span className="text-xs text-white/30 font-mono shrink-0">sorted by |edge|</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="text-left px-5 py-2 text-white/30 font-normal">Signal</th>
                    <th className="text-right px-3 py-2 text-white/30 font-normal">Fires</th>
                    <th className="text-right px-3 py-2 text-white/30 font-normal">Avg Wt</th>
                    <th className="text-right px-5 py-2 text-white/30 font-normal">Edge</th>
                    <th className="text-right px-3 py-2 text-white/30 font-normal">Bull Acc</th>
                    <th className="text-right px-5 py-2 text-white/30 font-normal">Bear Acc</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.signal_correlations]
                    .sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge))
                    .map((s) => (
                      <tr key={s.label} className="border-b border-white/5 hover:bg-white/[0.02]">
                        <td className="px-5 py-2.5 text-white">{s.label}</td>
                        <td className="px-3 py-2.5 text-right text-white/60">{s.fire_count}</td>
                        <td className="px-3 py-2.5 text-right text-white/60">
                          {s.avg_weight >= 0 ? "+" : ""}{s.avg_weight.toFixed(2)}
                        </td>
                        <td className={`px-5 py-2.5 text-right font-bold ${edgeColor(s.edge)}`}>
                          {s.edge >= 0 ? "+" : ""}{s.edge.toFixed(1)}%
                        </td>
                        <td className={`px-3 py-2.5 text-right ${accuracyColor(s.bullish_accuracy)}`}>
                          {s.bullish_accuracy.toFixed(1)}%
                        </td>
                        <td className={`px-5 py-2.5 text-right ${accuracyColor(s.bearish_accuracy)}`}>
                          {s.bearish_accuracy.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ─── Section 3: Score Band Performance ───────────────────────── */}
          <div className="bg-black/40 border border-white/10 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-white/10">
              <h3 className="text-xs font-mono text-white uppercase tracking-widest">Score Band Performance</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="text-left px-5 py-2 text-white/30 font-normal">Band</th>
                    <th className="text-right px-3 py-2 text-white/30 font-normal">Count</th>
                    <th className="text-left px-5 py-2 text-white/30 font-normal">Accuracy</th>
                    <th className="text-right px-5 py-2 text-white/30 font-normal">Avg Move (pts)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.score_band_performance.map((b) => (
                    <tr key={b.band} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="px-5 py-2.5 text-white">{b.band}</td>
                      <td className="px-3 py-2.5 text-right text-white/60">{b.count}</td>
                      <td className="px-5 py-2.5">
                        <AccuracyBar pct={b.accuracy_pct} />
                      </td>
                      <td className={`px-5 py-2.5 text-right ${b.avg_move_30m >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {b.avg_move_30m >= 0 ? "+" : ""}{b.avg_move_30m.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ─── Section 4: Session Window Performance ────────────────────── */}
          <div className="bg-black/40 border border-white/10 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-white/10">
              <h3 className="text-xs font-mono text-white uppercase tracking-widest">Session Window Performance</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="text-left px-5 py-2 text-white/30 font-normal">Window</th>
                    <th className="text-right px-3 py-2 text-white/30 font-normal">Obs</th>
                    <th className="text-right px-3 py-2 text-white/30 font-normal">Accuracy</th>
                    <th className="text-right px-3 py-2 text-white/30 font-normal">Avg Score</th>
                    <th className="text-right px-5 py-2 text-white/30 font-normal">Avg 30m Move</th>
                  </tr>
                </thead>
                <tbody>
                  {data.session_window_performance.map((w) => (
                    <tr key={w.window} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className={`px-5 py-2.5 font-medium ${sessionWindowClass(w.window)}`}>
                        {sessionWindowLabel(w.window)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-white/60">{w.count}</td>
                      <td className={`px-3 py-2.5 text-right ${accuracyColor(w.accuracy_pct)}`}>
                        {w.accuracy_pct.toFixed(1)}%
                      </td>
                      <td className="px-3 py-2.5 text-right text-white/60">{w.avg_score.toFixed(2)}</td>
                      <td className={`px-5 py-2.5 text-right ${w.avg_move_30m >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {w.avg_move_30m >= 0 ? "+" : ""}{w.avg_move_30m.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ─── Section 5: Gate Block Frequency ─────────────────────────── */}
          <div className="bg-black/40 border border-white/10 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-white/10">
              <h3 className="text-xs font-mono text-white uppercase tracking-widest">Gate Block Frequency</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="text-left px-5 py-2 text-white/30 font-normal">Gate</th>
                    <th className="text-right px-3 py-2 text-white/30 font-normal">Blocks</th>
                    <th className="text-left px-5 py-2 text-white/30 font-normal">Block Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.gate_block_frequency]
                    .sort((a, b) => b.block_pct - a.block_pct)
                    .map((g) => (
                      <tr key={g.gate} className="border-b border-white/5 hover:bg-white/[0.02]">
                        <td className="px-5 py-2.5 text-white">{g.gate}</td>
                        <td className="px-3 py-2.5 text-right text-white/60">{g.block_count}</td>
                        <td className="px-5 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-20 h-1.5 bg-white/10 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full bg-red-500/60"
                                style={{ width: `${Math.min(g.block_pct, 100)}%` }}
                              />
                            </div>
                            <span className="text-white/60">{g.block_pct.toFixed(1)}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ─── Section 6: Recent Observations Feed ──────────────────────── */}
          <div className="bg-black/40 border border-white/10 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-white/10">
              <h3 className="text-xs font-mono text-white uppercase tracking-widest">
                Recent Observations
                <span className="ml-2 text-white/30">last {data.recent_observations.length}</span>
              </h3>
            </div>
            <div className="overflow-y-auto max-h-96 overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead className="sticky top-0 bg-black/80 backdrop-blur-sm">
                  <tr className="border-b border-white/5">
                    <th className="text-left px-5 py-2 text-white/30 font-normal">Time</th>
                    <th className="text-right px-2 py-2 text-white/30 font-normal">Score</th>
                    <th className="text-center px-2 py-2 text-white/30 font-normal">Grade</th>
                    <th className="text-left px-3 py-2 text-white/30 font-normal">Action</th>
                    <th className="text-left px-3 py-2 text-white/30 font-normal">Dir</th>
                    <th className="text-left px-5 py-2 text-white/30 font-normal">Top Factors</th>
                    <th className="text-right px-5 py-2 text-white/30 font-normal">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent_observations.map((obs) => {
                    const outcomeColor =
                      obs.outcome_move === null
                        ? "text-white/30"
                        : obs.direction_correct
                        ? "text-emerald-400"
                        : "text-red-400";
                    return (
                      <tr key={obs.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                        <td className="px-5 py-2 text-white/40 whitespace-nowrap">{formatTime(obs.observed_at)}</td>
                        <td className="px-2 py-2 text-right text-white">{obs.score}</td>
                        <td className="px-2 py-2 text-center">
                          <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-bold ${gradeColor(obs.grade)}`}>
                            {obs.grade}
                          </span>
                        </td>
                        <td className={`px-3 py-2 ${actionColor(obs.engine_action)}`}>{actionLabel(obs.engine_action)}</td>
                        <td className="px-3 py-2 text-white">
                          {obs.direction === "long" ? "▲" : obs.direction === "short" ? "▼" : "—"}
                        </td>
                        <td className="px-5 py-2 text-white/50 max-w-xs truncate">
                          {obs.factors.slice(0, 3).map((f) => f.label).join(", ")}
                        </td>
                        <td className={`px-5 py-2 text-right ${outcomeColor}`}>
                          {obs.outcome_move !== null
                            ? `${obs.outcome_move >= 0 ? "+" : ""}${obs.outcome_move.toFixed(2)}`
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ─── Section 7: Time-of-Day Accuracy ─────────────────────────── */}
          <div className="bg-black/40 border border-white/10 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-white/10">
              <h3 className="text-xs font-mono text-white uppercase tracking-widest">Time-of-Day Accuracy</h3>
            </div>
            <div className="px-5 py-4 overflow-x-auto">
              <div className="flex items-end gap-1.5 min-w-max h-24">
                {data.hourly_accuracy.map((h) => {
                  const barPct = Math.min(h.accuracy_pct, 100);
                  const barColor =
                    h.accuracy_pct > 55
                      ? "bg-emerald-500"
                      : h.accuracy_pct >= 50
                      ? "bg-yellow-500"
                      : "bg-red-500";
                  return (
                    <div key={h.hour} className="flex flex-col items-center gap-1 w-10 group relative">
                      {/* Tooltip */}
                      <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-black/90 border border-white/10 rounded px-2 py-1 text-[10px] text-white/80 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                        {h.count} obs — {h.accuracy_pct.toFixed(1)}%
                      </div>
                      <div className="w-full flex-1 flex items-end">
                        <div
                          className={`w-full rounded-t ${barColor} transition-all`}
                          style={{ height: `${(barPct / 100) * 64}px` }}
                        />
                      </div>
                      <span className="text-[10px] text-white/30 font-mono">{formatHour(h.hour)}</span>
                    </div>
                  );
                })}
              </div>
              {data.hourly_accuracy.length === 0 && (
                <p className="text-xs text-white/30 font-mono py-4">No hourly data available</p>
              )}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}

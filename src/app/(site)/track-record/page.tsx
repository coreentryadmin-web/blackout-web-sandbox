"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import {
  PageShell,
  PageHeader,
  Badge,
  Card,
  EmptyState,
  Skeleton,
  Stat,
} from "@/components/ui";

// ─── Types ───────────────────────────────────────────────────────────────────

// Shape returned by /api/track-record
interface SpxStats {
  total: number;
  wins: number;
  losses: number;
  winRatePct: number | null;
}

interface NhStats {
  total: number;
  wins: number;
  losses: number;
  winRatePct: number | null;
  avgWinnerPct: number | null;
  avgLoserPct: number | null;
  profitFactor: number | null;
}

interface TrackRecordPayload {
  spxSlayer: SpxStats;
  nightHawk: NhStats;
  methodology: string;
  liveData?: boolean;
  available?: boolean;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "empty" }
  | { kind: "ready"; data: TrackRecordPayload };

// ─── Helpers ─────────────────────────────────────────────────────────────────

const POLL_MS = 60_000;

function fmt(n: number | null | undefined, suffix = "%"): string {
  if (n == null) return "—";
  return `${n}${suffix}`;
}

function profitFactorTone(pf: number | null): string {
  if (pf == null) return "text-mute";
  if (pf >= 2) return "text-cyan-400";
  if (pf >= 1) return "text-sky-300";
  return "text-red-400";
}

// ─── Embed snippet ────────────────────────────────────────────────────────────

const EMBED_SNIPPET = `<iframe src="https://www.blackouttrades.com/embed/track-record" width="400" height="200" frameborder="0" style="border-radius:12px;overflow:hidden;" />`;

// ─── Component ────────────────────────────────────────────────────────────────

export default function TrackRecordPage() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const loadedOnce = useRef(false);
  const inFlight = useRef(false);
  const pending = useRef(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (inFlight.current) {
      pending.current = true;
      return;
    }
    inFlight.current = true;
    try {
      let runAgain = true;
      while (runAgain) {
        pending.current = false;
        try {
          const res = await fetch("/api/track-record", { cache: "no-store" });
          if (!res.ok) {
            setState({ kind: "error", message: `HTTP ${res.status}` });
          } else {
            const json: TrackRecordPayload = await res.json();
            if (json.available === false) {
              setState({ kind: "error", message: "Service unavailable" });
            } else {
              const hasData =
                (json.spxSlayer?.total ?? 0) > 0 ||
                (json.nightHawk?.total ?? 0) > 0;
              setState(hasData ? { kind: "ready", data: json } : { kind: "empty" });
            }
          }
        } catch {
          setState({ kind: "error", message: "Failed to load" });
        }
        loadedOnce.current = true;
        runAgain = pending.current;
      }
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const handleCopy = () => {
    void navigator.clipboard.writeText(EMBED_SNIPPET).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const isLoading = state.kind === "loading" && !loadedOnce.current;

  return (
    <PageShell>
      <div className="mx-auto max-w-3xl px-4 pb-12 pt-6">
        <PageHeader
          kicker="◆ VERIFIED PERFORMANCE"
          title="TRACK RECORD"
          subtitle="Live signal results — recorded at generation time, scored automatically"
          actions={
            <Badge tone="bull" dot>
              Live
            </Badge>
          }
          className="mb-6"
        />

        {/* ── Loading ── */}
        {isLoading && (
          <div className="space-y-4">
            <Skeleton height={120} />
            <Skeleton height={120} />
          </div>
        )}

        {/* ── Error ── */}
        {state.kind === "error" && (
          <EmptyState
            icon="◆"
            title="Could not load track record"
            description={state.message}
          />
        )}

        {/* ── Empty / building ── */}
        {state.kind === "empty" && (
          <EmptyState
            icon="◆"
            title="Track record is building"
            description="Live signals are being recorded and scored in real time. Check back after the first trading day."
          />
        )}

        {/* ── Ready ── */}
        {state.kind === "ready" && (
          <div className="space-y-5">
            {/* SPX Slayer card */}
            <Card padding="sm">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-sky-300">
                    SPX Slayer
                  </p>
                  <p className="font-syne text-base font-semibold text-white">
                    0DTE Signal Results
                  </p>
                </div>
                <Badge tone="sky" size="sm">
                  T+30 Checkpoint
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat
                  label="Win Rate"
                  value={fmt(state.data.spxSlayer.winRatePct)}
                  tone="accent"
                  display
                  className="col-span-2 sm:col-span-1"
                />
                <Stat
                  label="Total Signals"
                  value={state.data.spxSlayer.total}
                  tone="neutral"
                />
                <Stat
                  label="Wins"
                  value={state.data.spxSlayer.wins}
                  tone="bull"
                />
                <Stat
                  label="Losses"
                  value={state.data.spxSlayer.losses}
                  tone="bear"
                />
              </div>

            </Card>

            {/* Night Hawk card */}
            <Card padding="sm">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-sky-300">
                    Night Hawk
                  </p>
                  <p className="font-syne text-base font-semibold text-white">
                    Overnight Setup Results
                  </p>
                </div>
                <Badge tone="sky" size="sm">
                  EOD Checkpoint
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Stat
                  label="Win Rate"
                  value={fmt(state.data.nightHawk.winRatePct)}
                  tone="accent"
                  display
                  className="col-span-2 sm:col-span-1"
                />
                <Stat
                  label="Avg Winner"
                  value={fmt(state.data.nightHawk.avgWinnerPct)}
                  tone="bull"
                />
                <Stat
                  label="Avg Loser"
                  value={fmt(state.data.nightHawk.avgLoserPct)}
                  tone="bear"
                />
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Total" value={state.data.nightHawk.total} tone="neutral" />
                <Stat label="Wins" value={state.data.nightHawk.wins} tone="bull" />
                <Stat label="Losses" value={state.data.nightHawk.losses} tone="bear" />

                {/* Profit Factor with dynamic color */}
                <div className="flex flex-col gap-0.5 rounded-xl border border-white/10 bg-[rgba(8,9,14,0.5)] p-4 backdrop-blur">
                  <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-mute">
                    Profit Factor
                  </span>
                  <span
                    className={clsx(
                      "t-num text-2xl font-bold leading-none",
                      profitFactorTone(state.data.nightHawk.profitFactor)
                    )}
                  >
                    {state.data.nightHawk.profitFactor != null
                      ? state.data.nightHawk.profitFactor.toFixed(2)
                      : "—"}
                  </span>
                </div>
              </div>

            </Card>

            {/* Methodology disclaimer */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-sky-300">
                Methodology
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-mute">
                {state.data.methodology ??
                  "All signals recorded at generation time. T+30 checkpoint for SPX Slayer, EOD for Night Hawk. This is live data from our signal engine — no cherry-picking, no survivorship bias."}
              </p>
              {!state.data.liveData && (
                <p className="mt-1 font-mono text-[10px] text-gold">
                  Showing cached snapshot — live scoring in progress.
                </p>
              )}
            </div>

            {/* Embed snippet */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-sky-300">
                Embed on Your Site
              </p>
              <pre className="overflow-x-auto rounded-lg border border-white/[0.06] bg-[#08080e] p-3 font-mono text-[11px] text-cyan-400">
                {EMBED_SNIPPET}
              </pre>
              <button
                onClick={handleCopy}
                className={clsx(
                  "mt-2 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors",
                  copied
                    ? "border-bull/30 bg-bull/10 text-bull"
                    : "border-white/10 bg-white/[0.04] text-mute hover:border-cyan-400/30 hover:text-cyan-400"
                )}
              >
                {copied ? "Copied!" : "Copy snippet"}
              </button>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  PageShell,
  PageHeader,
  Card,
  EmptyState,
  Button,
  FreshnessChip,
} from "@/components/ui";
import type { FreshnessStatus } from "@/components/ui/FreshnessChip";
import { TrackRecordSkeleton } from "./TrackRecordSkeleton";
import { TrackRecordProductCard } from "./TrackRecordProductCard";
import {
  TRACK_RECORD_EMBED_SNIPPET,
  TRACK_RECORD_POLL_MS,
} from "./format";
import type { TrackRecordLoadState, TrackRecordPayload } from "./types";

function freshnessForPayload(data: TrackRecordPayload, fetchedAt: Date): FreshnessStatus {
  if (data.liveData === false) return "cached";
  const ageMs = Date.now() - fetchedAt.getTime();
  if (ageMs > TRACK_RECORD_POLL_MS * 2) return "stale";
  return "live";
}

export function TrackRecordView() {
  const [state, setState] = useState<TrackRecordLoadState>({ kind: "loading" });
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
              setState(
                hasData
                  ? { kind: "ready", data: json, fetchedAt: new Date() }
                  : { kind: "empty" }
              );
            }
          }
        } catch {
          setState({ kind: "error", message: "Failed to load track record" });
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
    const timer = setInterval(() => void load(), TRACK_RECORD_POLL_MS);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const handleCopy = () => {
    void navigator.clipboard.writeText(TRACK_RECORD_EMBED_SNIPPET).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const isInitialLoad = state.kind === "loading" && !loadedOnce.current;

  const headerFreshness: FreshnessStatus =
    state.kind === "ready"
      ? freshnessForPayload(state.data, state.fetchedAt)
      : state.kind === "loading"
        ? "syncing"
        : "offline";

  const headerAsOf = state.kind === "ready" ? state.fetchedAt : null;

  return (
    <PageShell>
      <div className="content-rail mx-auto max-w-3xl pb-12 pt-2">
        <PageHeader
          kicker="Verified performance"
          title="Track record"
          subtitle="Signal results recorded at generation time and scored automatically — no cherry-picking."
          actions={
            <FreshnessChip status={headerFreshness} asOf={headerAsOf} />
          }
          className="mb-8"
        />

        {isInitialLoad && <TrackRecordSkeleton />}

        {state.kind === "error" && (
          <EmptyState
            title="Could not load track record"
            description={state.message}
            action={
              <Button variant="outline" size="sm" onClick={() => void load()}>
                Try again
              </Button>
            }
          />
        )}

        {state.kind === "empty" && (
          <EmptyState
            title="Track record is building"
            description="Signals are being recorded and scored in real time. Check back after the first trading session with closed outcomes."
          />
        )}

        {state.kind === "ready" && (
          <div className="space-y-5">
            <TrackRecordProductCard
              product="spx"
              productLabel="SPX Slayer"
              title="0DTE signal results"
              checkpoint="T+30 checkpoint"
              stats={state.data.spxSlayer}
              variant="spx"
            />

            <TrackRecordProductCard
              product="nighthawk"
              productLabel="Night Hawk"
              title="Overnight setup results"
              checkpoint="EOD checkpoint"
              stats={state.data.nightHawk}
              variant="nighthawk"
            />

            <Card padding="sm" accent="none">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-secondary">
                Methodology
              </p>
              <p className="mt-2 text-sm leading-relaxed text-mute">
                {state.data.methodology ??
                  "All signals recorded at generation time. T+30 checkpoint for SPX Slayer, EOD for Night Hawk. Includes all signals — no cherry-picking or survivorship bias."}
              </p>
              {state.data.liveData === false && (
                <p className="mt-2 font-mono text-[10px] text-gold">
                  Showing cached snapshot while live scoring catches up.
                </p>
              )}
            </Card>

            <Card padding="sm" accent="none">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-secondary">
                Embed on your site
              </p>
              <pre className="mt-3 overflow-x-auto rounded-lg border border-white/[0.08] bg-void-deep p-3 font-mono text-[11px] text-cyan-400">
                {TRACK_RECORD_EMBED_SNIPPET}
              </pre>
              <Button
                variant="ghost"
                size="sm"
                className="mt-3"
                onClick={handleCopy}
                aria-live="polite"
              >
                {copied ? "Copied" : "Copy snippet"}
              </Button>
            </Card>
          </div>
        )}
      </div>
    </PageShell>
  );
}

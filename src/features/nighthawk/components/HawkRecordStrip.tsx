"use client";

import type { NightHawkRecordResponse } from "@/features/nighthawk/lib/types";
import { TRACK_RECORD_MIN_SAMPLE } from "@/components/track-record/format";

type HawkRecordStripProps = {
  record: NightHawkRecordResponse | undefined;
  loading?: boolean;
};

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="nighthawk-metric-pill">
      <span className="nighthawk-metric-pill-label">{label}</span>
      <span className="nighthawk-metric-pill-value">{value}</span>
    </span>
  );
}

export function HawkRecordStrip({ record, loading }: HawkRecordStripProps) {
  if (loading) {
    return (
      <div className="nighthawk-record-strip" role="status">
        <span className="nighthawk-record-label">Hawk record</span>
        <span className="nighthawk-record-value">Syncing outcomes…</span>
      </div>
    );
  }

  // Gate ratio stats behind the shared minimum sample, not just zero: a strip showing
  // "Target hit 0%" (or 100%) off a handful of resolved plays reads as a confident
  // record when it's noise. Same threshold as the track-record page's SPX card, so the
  // two products apply one disclosure standard (audit MEDIUM: NH showed raw tiny-sample
  // stats while SPX gated behind "Collecting data").
  if (!record?.available || record.total_resolved < TRACK_RECORD_MIN_SAMPLE) {
    const resolved = record?.total_resolved ?? 0;
    return (
      <div className="nighthawk-record-strip" role="status">
        <span className="nighthawk-record-label">Hawk record</span>
        <span className="nighthawk-record-value">
          Building track record — outcomes resolve after each session
          {resolved > 0 ? ` · ${resolved}/${TRACK_RECORD_MIN_SAMPLE} resolved` : ""}
          {record?.pending_count ? ` · ${record.pending_count} pending` : ""}
        </span>
      </div>
    );
  }

  return (
    <div className="nighthawk-record-strip" role="status">
      <span className="nighthawk-record-label">{record.window_days}d track record</span>
      <div className="nighthawk-record-metrics">
        <MetricPill label="Resolved" value={String(record.total_resolved)} />
        <MetricPill label="Target hit" value={`${record.win_rate_pct}%`} />
        <MetricPill label="Profitable" value={`${record.profitable_rate_pct}%`} />
        <MetricPill
          label="Avg return"
          value={`${record.avg_return_pct >= 0 ? "+" : ""}${record.avg_return_pct}%`}
        />
      </div>
    </div>
  );
}

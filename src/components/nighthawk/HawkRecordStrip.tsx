"use client";

import type { NightHawkRecordResponse } from "@/lib/nighthawk/types";

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

  if (!record?.available || record.total_resolved === 0) {
    return (
      <div className="nighthawk-record-strip" role="status">
        <span className="nighthawk-record-label">Hawk record</span>
        <span className="nighthawk-record-value">
          Building track record — outcomes resolve after each session
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

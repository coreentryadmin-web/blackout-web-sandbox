"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { NighthawkMetrics } from "@/lib/nighthawk/analytics";
import type { NighthawkPublishPreview } from "@/lib/nighthawk/publish-preview";
import {
  ActionButton,
  DataTable,
  DeckPanel,
  EmptyDeck,
  HorzBar,
  MegaStat,
  SectionDeck,
  TabCommandHero,
  WinRateRing,
  pct,
} from "@/components/admin/AdminUi";

const WINDOW_OPTIONS = [7, 30, 90] as const;

function fmtReturn(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function fmtDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const rem = Math.round(sec % 60);
  return `${min}m ${rem}s`;
}

function fmtPublishedAt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function winRateStyle(rate: number): CSSProperties {
  const clamped = Math.max(0, Math.min(1, rate));
  const red = Math.round(239 * (1 - clamped) + 34 * clamped);
  const green = Math.round(68 * (1 - clamped) + 197 * clamped);
  return { color: `rgb(${red}, ${green}, 80)` };
}

function EditionWinRateTrend({ editions }: { editions: NighthawkMetrics["by_edition"] }) {
  if (editions.length === 0) {
    return <EmptyDeck title="No edition data yet" hint="Trend fills as editions resolve." />;
  }

  const width = 640;
  const height = 160;
  const pad = { top: 20, right: 16, bottom: 32, left: 36 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const points = editions.map((e, i) => ({
    ...e,
    x: pad.left + (editions.length === 1 ? plotW / 2 : (i / (editions.length - 1)) * plotW),
    y: pad.top + plotH - e.win_rate * plotH,
  }));

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  return (
    <div className="admin-nh-trend-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="admin-nh-trend" role="img" aria-label="Target-hit rate by edition">
        <line
          x1={pad.left}
          y1={pad.top + plotH}
          x2={pad.left + plotW}
          y2={pad.top + plotH}
          className="admin-nh-scatter-axis"
        />
        <line
          x1={pad.left}
          y1={pad.top}
          x2={pad.left}
          y2={pad.top + plotH}
          className="admin-nh-scatter-axis"
        />
        {[0.25, 0.5, 0.75, 1].map((tick) => (
          <line
            key={tick}
            x1={pad.left}
            y1={pad.top + plotH - tick * plotH}
            x2={pad.left + plotW}
            y2={pad.top + plotH - tick * plotH}
            className="admin-nh-trend-grid"
          />
        ))}
        <path d={path} className="admin-nh-trend-line" fill="none" />
        {points.map((p) => (
          <circle key={p.edition_for} cx={p.x} cy={p.y} r={4} className="admin-nh-trend-dot">
            <title>
              {p.edition_for}: {pct(p.win_rate)} · {p.n} plays · {fmtReturn(p.avg_return_pct)}
            </title>
          </circle>
        ))}
      </svg>
      <div className="admin-nh-trend-labels">
        {editions.map((e) => (
          <span key={e.edition_for} className="admin-nh-trend-label">
            {e.edition_for.slice(5)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function AdminNightHawkDashboard() {
  const [windowDays, setWindowDays] = useState<(typeof WINDOW_OPTIONS)[number]>(30);
  const [data, setData] = useState<NighthawkMetrics | null>(null);
  const [preview, setPreview] = useState<NighthawkPublishPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    setError(null);
    try {
      const [metricsRes, previewRes] = await Promise.all([
        fetch(`/api/admin/nighthawk/analytics?window=${windowDays}`, { cache: "no-store" }),
        fetch("/api/admin/nighthawk/publish-preview", { cache: "no-store" }),
      ]);
      if (!metricsRes.ok) throw new Error(metricsRes.status === 403 ? "Not authorized" : `HTTP ${metricsRes.status}`);
      setData((await metricsRes.json()) as NighthawkMetrics);
      if (previewRes.ok) {
        setPreview((await previewRes.json()) as NighthawkPublishPreview);
      } else if (previewRes.status !== 404) {
        setPreview(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [windowDays]);

  useEffect(() => {
    void load(true);
    const id = setInterval(() => void load(false), 30_000);
    return () => clearInterval(id);
  }, [load]);

  const convictionRows = useMemo(
    () => (data?.by_conviction ?? []).filter((row) => row.n > 0),
    [data]
  );

  if (loading && !data) {
    return <p className="admin-muted">Loading Night Hawk analytics…</p>;
  }

  if (error && !data) {
    return <EmptyDeck title="Night Hawk analytics unavailable" hint={error} />;
  }

  if (!data) return null;

  return (
    <div className="admin-nh-dashboard">
      <TabCommandHero
        kicker="Night Hawk · Analytics"
        title="Playbook"
        titleAccent="outcomes"
        subtitle={`Last ${data.window_days} days · ${data.total_resolved} resolved · ${data.pending_count} pending`}
        actions={
          <div className="admin-nh-window-tabs">
            {WINDOW_OPTIONS.map((days) => (
              <ActionButton
                key={days}
                variant={windowDays === days ? "primary" : undefined}
                onClick={() => setWindowDays(days)}
              >
                {days}d
              </ActionButton>
            ))}
          </div>
        }
        rings={
          <>
            <WinRateRing
              value={data.win_rate}
              label="Target-hit rate"
              sub={`${Math.round(data.win_rate * data.total_resolved)} targets`}
              tone="bull"
              size={120}
            />
            <WinRateRing
              value={Math.max(0, Math.min(1, (data.avg_return_pct + 10) / 20))}
              label="Avg return"
              sub={fmtReturn(data.avg_return_pct)}
              tone={data.avg_return_pct >= 0 ? "bull" : "bear"}
              size={120}
            />
            <WinRateRing
              value={data.total_resolved > 0 ? Math.min(1, data.total_resolved / 100) : 0}
              label="Resolved"
              sub={String(data.total_resolved)}
              tone="cyan"
              size={120}
            />
            <WinRateRing
              value={data.pending_count > 0 ? Math.min(1, data.pending_count / 20) : 0}
              label="Pending"
              sub={String(data.pending_count)}
              tone="amber"
              size={120}
            />
          </>
        }
      />

      {error && <p className="admin-error">{error}</p>}

      <DeckPanel title="Latest edition" accent="cyan" defaultOpen storageKey="nh-publish-preview">
        {!preview ? (
          <EmptyDeck title="No published edition yet" hint="Preview appears after the 5:30 PM ET build." />
        ) : (
          <div className="admin-nh-preview">
            <div className="admin-mega-grid admin-nh-stats-row">
              <MegaStat label="Edition" value={preview.edition_for} tone="cyan" />
              <MegaStat label="Published" value={fmtPublishedAt(preview.published_at)} tone="neutral" />
              <MegaStat label="Build time" value={fmtDuration(preview.build_duration_ms)} tone="neutral" />
              <MegaStat
                label="Job status"
                value={preview.job?.status ?? "—"}
                sub={preview.job?.stage ?? undefined}
                tone={preview.job?.status === "published" ? "bull" : preview.error ? "bear" : "amber"}
              />
              <MegaStat label="Plays" value={String(preview.play_count)} tone="neutral" />
            </div>
            {preview.recap_headline && (
              <p className="admin-nh-preview-headline">{preview.recap_headline}</p>
            )}
            {preview.error && <p className="admin-error">{preview.error}</p>}
            {preview.unvetted_fallback && (
              <p className="admin-nh-preview-flag">Unvetted fallback — critic rejected all plays</p>
            )}
            {preview.critic_notes.length > 0 && (
              <p className="admin-muted admin-nh-preview-notes">
                Critic: {preview.critic_notes.slice(0, 2).join(" · ")}
              </p>
            )}
            {preview.plays.length > 0 ? (
              <DataTable>
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th>Score</th>
                    <th>Conviction</th>
                    <th>Direction</th>
                    <th>Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.plays.map((play) => (
                    <tr key={play.ticker}>
                      <td className="admin-td-strong">{play.ticker}</td>
                      <td>{play.score}</td>
                      <td>{play.conviction}</td>
                      <td>{play.direction}</td>
                      <td>{play.unvetted_fallback ? "unvetted fallback" : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            ) : (
              <EmptyDeck title="No plays in this edition." />
            )}
          </div>
        )}
      </DeckPanel>

      <section className="admin-mega-grid admin-nh-stats-row">
        <MegaStat
          label="Profitable rate"
          value={pct(data.profitable_rate)}
          sub="Close better than entry"
          tone="bull"
        />
        <MegaStat label="Winners avg" value={fmtReturn(data.avg_winner_return_pct)} tone="bull" />
        <MegaStat label="Losers avg" value={fmtReturn(data.avg_loser_return_pct)} tone="bear" />
        <MegaStat label="Loss rate" value={pct(data.loss_rate)} sub={`${Math.round(data.loss_rate * data.total_resolved)} stops`} tone="bear" />
        <MegaStat label="Open rate" value={pct(data.open_rate)} sub="Neither target nor stop" tone="neutral" />
        <MegaStat
          label="Ambiguous rate"
          value={pct(data.ambiguous_rate)}
          sub={`${Math.round(data.ambiguous_rate * data.total_resolved)} both hit`}
          tone="amber"
        />
      </section>

      <DeckPanel title="Conviction validation" accent="violet" defaultOpen storageKey="nh-conviction">
        {convictionRows.length === 0 ? (
          <EmptyDeck title="No conviction-tier data yet." />
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th>Conviction</th>
                <th>N</th>
                <th>Target-hit rate</th>
                <th>Avg return</th>
              </tr>
            </thead>
            <tbody>
              {convictionRows.map((row) => (
                <tr key={row.conviction}>
                  <td className="admin-td-strong">{row.conviction}</td>
                  <td>{row.n}</td>
                  <td className="admin-td-strong" style={winRateStyle(row.win_rate)}>
                    {pct(row.win_rate)}
                  </td>
                  <td className={row.avg_return_pct >= 0 ? "admin-td-bull" : "admin-td-bear"}>
                    {fmtReturn(row.avg_return_pct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </DeckPanel>

      <DeckPanel title="Score bucket validation" accent="bull" defaultOpen storageKey="nh-score">
        {data.by_score_bucket.every((b) => b.n === 0) ? (
          <EmptyDeck title="No score bucket data yet." />
        ) : (
          <div className="admin-nh-buckets">
            {data.by_score_bucket.map((b) => (
              <HorzBar
                key={b.bucket}
                label={b.bucket}
                value={b.win_rate}
                max={1}
                tone="bull"
                right={`${b.n} plays · ${pct(b.win_rate)}`}
              />
            ))}
          </div>
        )}
      </DeckPanel>

      <div className="admin-nh-grid">
        <DeckPanel title="Direction" accent="cyan" defaultOpen storageKey="nh-direction">
          {data.by_direction.every((d) => d.n === 0) ? (
            <EmptyDeck title="No directional data yet." />
          ) : (
            <DataTable>
              <thead>
                <tr>
                  <th>Direction</th>
                  <th>N</th>
                  <th>Target-hit rate</th>
                  <th>Avg return</th>
                </tr>
              </thead>
              <tbody>
                {data.by_direction
                  .filter((d) => d.n > 0)
                  .map((row) => (
                    <tr key={row.direction}>
                      <td className="admin-td-strong">{row.direction}</td>
                      <td>{row.n}</td>
                      <td style={winRateStyle(row.win_rate)}>{pct(row.win_rate)}</td>
                      <td className={row.avg_return_pct >= 0 ? "admin-td-bull" : "admin-td-bear"}>
                        {fmtReturn(row.avg_return_pct)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </DataTable>
          )}
        </DeckPanel>

        <DeckPanel title="Sector" accent="amber" defaultOpen storageKey="nh-sector">
          {data.by_sector.length === 0 ? (
            <EmptyDeck title="No sector data yet" hint="Sector tags populate from dossiers when editions publish." />
          ) : (
            <DataTable>
              <thead>
                <tr>
                  <th>Sector</th>
                  <th>N</th>
                  <th>Target-hit rate</th>
                  <th>Avg return</th>
                </tr>
              </thead>
              <tbody>
                {data.by_sector.map((row) => (
                  <tr key={row.sector}>
                    <td className="admin-td-strong">{row.sector}</td>
                    <td>{row.n}</td>
                    <td style={winRateStyle(row.win_rate)}>{pct(row.win_rate)}</td>
                    <td className={row.avg_return_pct >= 0 ? "admin-td-bull" : "admin-td-bear"}>
                      {fmtReturn(row.avg_return_pct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </DeckPanel>
      </div>

      <SectionDeck accent="violet">
        <DeckPanel title="Target-hit rate by edition" accent="violet" defaultOpen storageKey="nh-edition-trend">
          <EditionWinRateTrend editions={data.by_edition} />
        </DeckPanel>
      </SectionDeck>
    </div>
  );
}

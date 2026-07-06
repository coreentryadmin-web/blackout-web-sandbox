"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { NighthawkMetrics } from "@/lib/nighthawk/analytics";
import type { NighthawkPublishPreview } from "@/lib/nighthawk/publish-preview";
import type { NightHawkEdition } from "@/lib/nighthawk/types";
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
  // Value-driven heat ramp interpolating between brand bear (#ff2d55) at the
  // low end and brand bull (#00e676) at the high end.
  const clamped = Math.max(0, Math.min(1, rate));
  const red = Math.round(255 * (1 - clamped) + 0 * clamped);
  const green = Math.round(45 * (1 - clamped) + 230 * clamped);
  const blue = Math.round(85 * (1 - clamped) + 118 * clamped);
  return { color: `rgb(${red}, ${green}, ${blue})` };
}

function EditionWinRateTrend({ editions }: { editions: NighthawkMetrics["by_edition"] }) {
  if (editions.length === 0) {
    return <EmptyDeck title="No edition data yet" hint="Trend fills as editions resolve." />;
  }

  const width = 640;
  const height = 180;
  const pad = { top: 20, right: 16, bottom: 36, left: 48 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const points = editions.map((e, i) => ({
    ...e,
    x: pad.left + (editions.length === 1 ? plotW / 2 : (i / (editions.length - 1)) * plotW),
    y: pad.top + plotH - e.win_rate * plotH,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  // Area fill under the line for a richer look
  const areaPath = `${linePath} L ${points[points.length - 1]?.x ?? 0} ${pad.top + plotH} L ${points[0]?.x ?? 0} ${pad.top + plotH} Z`;

  const yTicks = [0, 0.25, 0.5, 0.75, 1] as const;

  return (
    <div className="admin-nh-trend-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="admin-nh-trend" role="img" aria-label="Target-hit rate by edition">
        <defs>
          <linearGradient id="nh-area-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00e676" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#00e676" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Grid lines + Y-axis labels */}
        {yTicks.map((tick) => {
          const cy = pad.top + plotH - tick * plotH;
          return (
            <g key={tick}>
              <line x1={pad.left} y1={cy} x2={pad.left + plotW} y2={cy} className="admin-nh-trend-grid" />
              <text x={pad.left - 6} y={cy + 4} className="admin-nh-trend-axis-label" textAnchor="end">
                {Math.round(tick * 100)}%
              </text>
            </g>
          );
        })}

        {/* Axes */}
        <line x1={pad.left} y1={pad.top + plotH} x2={pad.left + plotW} y2={pad.top + plotH} className="admin-nh-scatter-axis" />
        <line x1={pad.left} y1={pad.top} x2={pad.left} y2={pad.top + plotH} className="admin-nh-scatter-axis" />

        {/* 50% benchmark line */}
        <line x1={pad.left} y1={pad.top + plotH * 0.5} x2={pad.left + plotW} y2={pad.top + plotH * 0.5}
          stroke="#7dd3fc" strokeWidth="1" strokeDasharray="4 3" opacity="0.4" />

        {/* Area fill */}
        {points.length > 1 && <path d={areaPath} fill="url(#nh-area-grad)" />}

        {/* Trend line */}
        <path d={linePath} className="admin-nh-trend-line" fill="none" />

        {/* Data points */}
        {points.map((p) => (
          <circle key={p.edition_for} cx={p.x} cy={p.y} r={5} className="admin-nh-trend-dot">
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

type OptionsWsStatus = {
  enabled: boolean;
  total_contracts: number;
  marks_in_memory: number;
  capacity?: number;
  shards: { id: number; contracts: number; ws_state: string; authenticated: boolean; auth_failed?: boolean }[];
};

/** Live status strip for the Night's Watch options WebSocket (live option marks). */
function OptionsWsStrip({ status }: { status: OptionsWsStatus }) {
  const shards = status.shards ?? [];
  const openAuthed = shards.filter((s) => s.ws_state === "OPEN" && s.authenticated).length;
  const enabled = !!status.enabled;
  const streaming = enabled && openAuthed > 0;
  const label = !enabled
    ? "OFF — set OPTIONS_WS_ENABLED=1"
    : streaming
      ? "STREAMING"
      : status.total_contracts > 0
        ? "CONNECTING…"
        : "ARMED · idle (no open positions)";
  const tone = !enabled ? "bg-mute" : streaming ? "bg-bull" : "bg-gold";
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-white/10 bg-[rgba(8,9,14,0.6)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em]">
      <span className="flex items-center gap-1.5">
        <span className={`inline-block h-2 w-2 rounded-full ${tone}`} aria-hidden />
        <span className="text-sky-300">Live marks · Options WS</span>
      </span>
      <span className="text-white">{label}</span>
      <span className="text-sky-300/80">{status.total_contracts ?? 0} contracts</span>
      <span className="text-sky-300/80">{status.marks_in_memory ?? 0} marks</span>
      <span className="text-sky-300/80">
        {openAuthed}/{shards.length} conn
      </span>
    </div>
  );
}

/**
 * Build a publish-preview view from the PUBLISHED edition when /api/admin/nighthawk/publish-preview
 * is unavailable (404 / route error). The public edition endpoint reads the same row the user page
 * sees, so this keeps the admin "Latest edition" panel in sync with reality (#77). Returns null only
 * when there is genuinely no published edition to show. Job/build-time/critic fields the preview API
 * carries are not on the public payload, so they degrade to null — the core (edition_for, plays,
 * recap headline, play count) is faithful.
 */
async function loadPreviewFromEdition(): Promise<NighthawkPublishPreview | null> {
  try {
    const res = await fetch("/api/market/nighthawk/edition", { cache: "no-store" });
    if (!res.ok) return null;
    const edition = (await res.json()) as NightHawkEdition;
    if (!edition.available) return null;
    const plays = Array.isArray(edition.plays) ? edition.plays : [];
    return {
      edition_for: edition.edition_for ?? "—",
      published_at: edition.published_at,
      build_duration_ms: null,
      job: edition.published_at
        ? { status: "published", stage: edition.recap_only ? "recap-only" : "published", error: null }
        : null,
      recap_headline: edition.recap_headline,
      play_count: plays.length,
      plays: plays.map((play) => ({
        ticker: String(play.ticker ?? "").toUpperCase(),
        score: Number(play.score ?? 0),
        conviction: String(play.conviction ?? ""),
        direction: String(play.direction ?? ""),
        unvetted_fallback: false,
      })),
      critic_notes: [],
      unvetted_fallback: false,
      error: null,
    };
  } catch {
    return null;
  }
}

export function AdminNightHawkDashboard() {
  const [windowDays, setWindowDays] = useState<(typeof WINDOW_OPTIONS)[number]>(30);
  const [data, setData] = useState<NighthawkMetrics | null>(null);
  const [preview, setPreview] = useState<NighthawkPublishPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const [wsStatus, setWsStatus] = useState<OptionsWsStatus | null>(null);

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    setError(null);
    try {
      const [metricsRes, previewRes, wsRes] = await Promise.all([
        fetch(`/api/admin/nighthawk/analytics?window=${windowDays}`, { cache: "no-store" }),
        fetch("/api/admin/nighthawk/publish-preview", { cache: "no-store" }),
        fetch("/api/admin/options-socket", { cache: "no-store" }),
      ]);
      if (!metricsRes.ok) throw new Error(metricsRes.status === 403 ? "Not authorized" : `HTTP ${metricsRes.status}`);
      setData((await metricsRes.json()) as NighthawkMetrics);
      if (previewRes.ok) {
        setPreview((await previewRes.json()) as NighthawkPublishPreview);
      } else {
        // publish-preview unavailable (404 / route error). Fall back to the PUBLISHED edition so the
        // "Latest edition" panel still reflects reality (#77) instead of showing "no edition yet" while
        // the user-facing page already serves a recap. The public edition endpoint reads the same row.
        const fallback = await loadPreviewFromEdition();
        setPreview(fallback);
      }
      // Live Options-WS status (secondary — never fails the dashboard load).
      setWsStatus(wsRes.ok ? ((await wsRes.json().catch(() => null)) as OptionsWsStatus | null) : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [windowDays]);

  const runNow = useCallback(async () => {
    setRunning(true);
    setRunMsg("Running the edition pipeline… Claude builds can take a few minutes — re-run to resume.");
    try {
      const res = await fetch("/api/admin/nighthawk/run", { method: "POST" });
      if (res.status === 401 || res.status === 403) {
        setRunMsg("✗ Admin session expired — refresh the page (Ctrl+Shift+R) and sign in again, then click Run now.");
        return;
      }
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        job_status?: string;
        current_stage?: string | null;
        plays_count?: number;
        edition_for?: string;
        error?: string;
        detail?: string;
      };
      if (json.job_status === "published") {
        setRunMsg(`✓ Published ${json.edition_for ?? ""} — ${json.plays_count ?? 0} plays.`);
      } else if (!res.ok || json.ok === false) {
        setRunMsg(`✗ ${json.error ?? json.detail ?? `HTTP ${res.status}`}${json.error && json.detail ? ` — ${json.detail}` : ""}`);
      } else {
        setRunMsg(`… ${json.current_stage ?? json.job_status ?? "in progress"} — click Run again to resume.`);
      }
      void load(false);
    } catch (err) {
      setRunMsg(`✗ ${err instanceof Error ? err.message : "Run failed"}`);
    } finally {
      setRunning(false);
    }
  }, [load]);

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
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton variant="primary" onClick={() => void runNow()} disabled={running}>
              {running ? "Running…" : "▶ Run now"}
            </ActionButton>
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
              value={(() => {
                // Dynamic ±range so the ring never pins at 0 or 1 for extreme values.
                // Use whichever is larger: |avg_return_pct| or 5, capped at 20.
                const range = Math.min(20, Math.max(5, Math.abs(data.avg_return_pct) * 1.5));
                return Math.max(0, Math.min(1, (data.avg_return_pct + range) / (range * 2)));
              })()}
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

      {runMsg && <p className="admin-muted" style={{ marginTop: 8 }}>{runMsg}</p>}

      {wsStatus && <OptionsWsStrip status={wsStatus} />}

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

      <DeckPanel title="Funnel · Rejection rate" accent="amber" defaultOpen storageKey="nh-funnel">
        <div className="admin-mega-grid admin-nh-stats-row">
          <MegaStat
            label="Candidates considered"
            value={String(data.funnel.candidates_count)}
            sub={`Last ${data.funnel.window_days} days`}
            tone="neutral"
          />
          <MegaStat label="Published" value={String(data.funnel.published_count)} tone="bull" />
          <MegaStat label="Rejected" value={String(data.funnel.rejected_count)} tone="bear" />
          <MegaStat
            label="Rejection rate"
            value={pct(data.funnel.rejection_rate)}
            sub="Rejected ÷ candidates considered"
            tone={data.funnel.rejection_rate >= 0.5 ? "bear" : "amber"}
          />
        </div>
        {data.funnel.by_stage.length === 0 ? (
          <EmptyDeck
            title="No rejections in this window."
            hint="Every scored candidate that reached a decision was published."
          />
        ) : (
          <div className="admin-nh-buckets">
            {data.funnel.by_stage.map((s) => (
              <HorzBar
                key={s.stage}
                label={s.label}
                value={s.n}
                max={data.funnel.rejected_count}
                tone="bear"
                right={`${s.n} · ${pct(data.funnel.rejected_count > 0 ? s.n / data.funnel.rejected_count : 0)}`}
              />
            ))}
          </div>
        )}
      </DeckPanel>

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

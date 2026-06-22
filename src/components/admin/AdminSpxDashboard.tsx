"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { clsx } from "clsx";
import type { SpxAdminDashboardPayload } from "@/lib/admin-spx-dashboard";
import type { PlayOutcomeRow } from "@/lib/spx-play-outcomes";
import { AdminSpxTerminal } from "@/components/admin/AdminSpxTerminal";
import {
  ActionButton,
  ClaudeVerdictCard,
  ConfirmationsCard,
  ConfirmModal,
  DataTable,
  DeckPanel,
  EmptyDeck,
  FilterSearch,
  FilterSelect,
  GlassPanel,
  HorzBar,
  JsonBlock,
  KvTiles,
  LivePill,
  MegaStat,
  MetricChip,
  MtfHybridCard,
  OutcomeBadge,
  PnlChart,
  SectionDeck,
  TabCommandHero,
  WinRateRing,
  pct,
} from "@/components/admin/AdminUi";

type SectionId =
  | "overview"
  | "terminal"
  | "live"
  | "desk"
  | "lotto"
  | "outcomes"
  | "signals"
  | "analytics"
  | "config";

const SECTIONS: Array<{ id: SectionId; label: string; icon: string }> = [
  { id: "terminal", label: "Terminal", icon: "▸" },
  { id: "overview", label: "Overview", icon: "◎" },
  { id: "live", label: "Live Engine", icon: "⚡" },
  { id: "desk", label: "Desk Intel", icon: "◈" },
  { id: "lotto", label: "Lotto", icon: "◆" },
  { id: "outcomes", label: "Outcomes", icon: "▣" },
  { id: "signals", label: "Signals", icon: "◉" },
  { id: "analytics", label: "Analytics", icon: "◐" },
  { id: "config", label: "Config", icon: "⚙" },
];

function parseSection(value: string | null): SectionId {
  if (
    value === "overview" ||
    value === "terminal" ||
    value === "live" ||
    value === "desk" ||
    value === "lotto" ||
    value === "outcomes" ||
    value === "signals" ||
    value === "analytics" ||
    value === "config"
  ) {
    return value;
  }
  return "terminal";
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function OverviewSection({ data }: { data: SpxAdminDashboardPayload }) {
  const play = data.play;
  const stats = data.analytics.outcome_stats;
  const c = data.confluence;

  return (
    <SectionDeck accent="bull">
      <div className="admin-spx-hero admin-spx-hero-v2">
        <div className="admin-spx-hero-glow" aria-hidden />
        <div>
          <p className="admin-spx-hero-kicker">
            {data.desk.market.label ?? "SPX"} · {data.desk.market.open ? "OPEN" : "CLOSED"}
          </p>
          <h2 className="admin-spx-hero-title">
            {play?.action ?? c?.direction?.toUpperCase() ?? "SCANNING"}
            {play?.direction ? ` · ${play.direction.toUpperCase()}` : ""}
          </h2>
          <p className="admin-spx-hero-sub">{play?.headline ?? c?.headline ?? "Awaiting live engine tick"}</p>
        </div>
        <div className="admin-spx-hero-stats">
          <div className="admin-spx-hero-stat-block">
            <p className="admin-deck-kicker">SPX</p>
            <p className="admin-spx-hero-price">{data.desk.price_action.price as number}</p>
          </div>
          <div className="admin-spx-hero-stat-block">
            <p className="admin-deck-kicker">Grade</p>
            <p className="admin-spx-hero-grade">{play?.grade ?? c?.grade ?? "—"}</p>
          </div>
          <div className="admin-spx-hero-stat-block">
            <p className="admin-deck-kicker">Score</p>
            <p className="admin-spx-hero-grade">{play?.score ?? c?.score ?? "—"}</p>
          </div>
        </div>
      </div>

      <section className="admin-mega-grid admin-spx-stat-grid">
        <MegaStat
          label="Win rate"
          value={pct(stats.overall.win_rate)}
          sub={`${stats.overall.wins}W · ${stats.overall.losses}L`}
          tone="bull"
          bar={stats.overall.win_rate * 100}
        />
        <MegaStat label="Closed" value={String(stats.total_closed)} sub={`${stats.days_of_data.toFixed(0)}d data`} tone="cyan" />
        <MegaStat
          label="Avg PnL"
          value={`${data.analytics.avg_pnl_pts >= 0 ? "+" : ""}${data.analytics.avg_pnl_pts.toFixed(1)}`}
          tone={data.analytics.avg_pnl_pts >= 0 ? "bull" : "bear"}
          trend={data.analytics.avg_pnl_pts >= 0 ? "up" : data.analytics.avg_pnl_pts < 0 ? "down" : "flat"}
        />
        <MegaStat label="Signals today" value={String(data.analytics.signals_today)} tone="violet" />
        <MegaStat label="Flow alerts" value={String(data.analytics.flow_alerts_today)} tone="amber" />
        <MegaStat label="Lotto" value={data.lotto.today?.phase ?? data.lotto.record?.phase ?? "—"} tone="violet" />
      </section>

      {data.analytics.insights.length > 0 && (
        <GlassPanel title="Desk insights" accent="bull" kicker="Live telemetry">
          <ul className="admin-insight-list admin-insight-list-pro">
            {data.analytics.insights.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </GlassPanel>
      )}
    </SectionDeck>
  );
}

function LiveEngineSection({
  data,
  onRunMutate,
}: {
  data: SpxAdminDashboardPayload;
  onRunMutate?: () => void;
}) {
  const play = data.play;
  if (!play) {
    return (
      <EmptyDeck
        title="Live engine not loaded"
        hint="Click Run live engine (dry run) above to preview play state safely, or use Run with mutation to write real orders."
      />
    );
  }

  const gateTone = play.gates.passed ? "bull" : "bear";

  return (
    <SectionDeck>
      {/* EDGE-10: Prominent mutate button with market-hours callout. */}
      {onRunMutate && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
          <ActionButton onClick={onRunMutate} variant="primary">
            Run with mutation (real orders)
          </ActionButton>
          <span className="admin-warn" style={{ fontSize: "0.8rem" }}>
            This path writes BUY/SELL to DB and fires Discord. Requires a second confirmation.
          </span>
        </div>
      )}
      <DeckPanel title="Play state" storageKey="spx-play-state" defaultOpen badge={`${play.phase} · ${play.action}`} accent="cyan">
        <KvTiles
          data={{
            phase: play.phase,
            action: play.action,
            direction: play.direction,
            grade: play.grade,
            score: play.score,
            confidence: play.confidence,
            session_phase: play.session_phase,
            as_of: play.as_of,
            headline: play.headline,
            thesis: play.thesis,
          }}
        />
      </DeckPanel>

      <DeckPanel title="Gates" storageKey="spx-gates" defaultOpen badge={play.gates.passed ? "PASSED" : "BLOCKED"} accent={gateTone}>
        {play.gates.play_idea && <p className="admin-spx-idea">{play.gates.play_idea}</p>}
        <p className="admin-deck-subtitle">Blocks ({play.gates.blocks.length})</p>
        <ul className="admin-tag-list admin-tag-list-bear">
          {play.gates.blocks.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
        <p className="admin-deck-subtitle mt-4">Warnings ({play.gates.warnings.length})</p>
        <ul className="admin-tag-list admin-tag-list-warn">
          {play.gates.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
        <MetricChip label="Entry mode" value={play.gates.entry_mode} tone="cyan" />
      </DeckPanel>

      <DeckPanel title="Confluence factors" badge={String(play.factors.length)} accent="violet">
        <DataTable>
          <thead>
            <tr>
              <th>Factor</th>
              <th>Weight</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {play.factors.map((f) => (
              <tr key={`${f.label}-${f.detail}`}>
                <td className="admin-td-strong">{f.label}</td>
                <td className={f.weight > 0 ? "admin-td-bull" : f.weight < 0 ? "admin-td-bear" : ""}>
                  {f.weight > 0 ? "+" : ""}
                  {f.weight}
                </td>
                <td>{f.detail}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </DeckPanel>

      {play.confirmations && (
        <DeckPanel title="Confirmations" badge={`${play.confirmations.passed_count}/${play.confirmations.total}`} accent="bull">
          <ConfirmationsCard
            passed={play.confirmations.passed}
            passed_count={play.confirmations.passed_count}
            total={play.confirmations.total}
            checks={play.confirmations.checks}
          />
        </DeckPanel>
      )}
      {play.mtf && (
        <DeckPanel title="MTF hybrid" badge={play.mtf.ok ? "OK" : "FAIL"} accent={play.mtf.ok ? "bull" : "bear"}>
          <MtfHybridCard
            ok={play.mtf.ok}
            summary={play.mtf.summary}
            failure_reason={play.mtf.failure_reason}
            t1_trigger={play.mtf.t1_trigger}
            t2_confirm_3m={play.mtf.t2_confirm_3m}
            t3_regime_5m={play.mtf.t3_regime_5m}
            soft_5m={play.mtf.soft_5m}
          />
        </DeckPanel>
      )}
      {play.technicals && (
        <DeckPanel title="Technicals" accent="cyan" defaultOpen>
          <KvTiles data={play.technicals as Record<string, unknown>} />
        </DeckPanel>
      )}
      {play.claude && (
        <DeckPanel
          title="Claude verdict"
          storageKey="spx-claude"
          badge={play.claude.verdict}
          accent={play.claude.direction_mismatch ? "bear" : "violet"}
        >
          {play.claude.direction_mismatch && (
            <div className="admin-warn admin-stale-banner" style={{ marginBottom: "0.75rem" }}>
              <p style={{ fontWeight: 700, marginBottom: "0.4rem" }}>
                ⚠ DIRECTION MISMATCH — Claude: &ldquo;{play.claude.direction}&rdquo; · Confluence: &ldquo;{data.confluence?.direction}&rdquo;
              </p>
              <p style={{ fontSize: "0.78rem", marginBottom: "0.5rem", opacity: 0.85 }}>
                Claude and the confluence model disagree. Choose one of the following actions:
              </p>
              <ul style={{ fontSize: "0.77rem", paddingLeft: "1.2rem", lineHeight: 1.7, opacity: 0.9 }}>
                <li><strong>Defer Claude</strong> — trust the quant confluence score; Claude's thesis may lag recent price action.</li>
                <li><strong>Defer Confluence</strong> — trust Claude's macro/narrative read; useful in news-driven regimes.</li>
                <li><strong>Abort play</strong> — disagreement at the model layer is a valid gate block; skip this setup entirely.</li>
                <li><strong>Re-run engine</strong> — if data is stale (&gt;90s), refresh and check whether the mismatch resolves.</li>
              </ul>
            </div>
          )}
          <ClaudeVerdictCard
            verdict={play.claude.verdict}
            thesis={play.claude.thesis}
            source={play.claude.source}
            approved={play.claude.approved}
          />
        </DeckPanel>
      )}
      {play.open_play && (
        <DeckPanel title="Open play" defaultOpen badge={play.open_play.direction} accent="amber">
          <JsonBlock value={play.open_play} />
        </DeckPanel>
      )}
      {play.watch && (
        <DeckPanel title="Watch state" badge={play.watch.promote_ready ? "PROMOTE READY" : "WATCHING"} accent={play.watch.promote_ready ? "bull" : "amber"}>
          {play.watch.promote_ready ? (
            <p className="admin-spx-idea" style={{ color: "rgb(52,211,153)", marginBottom: "0.5rem" }}>
              ✓ All promote conditions satisfied — run live engine (dry run) to preview the promoted play.
            </p>
          ) : (
            <p className="admin-spx-idea" style={{ marginBottom: "0.5rem" }}>
              Watching for promote signal. Conditions not yet met — check confluence score, gate blocks above.
            </p>
          )}
          <KvTiles data={play.watch as unknown as Record<string, unknown>} />
        </DeckPanel>
      )}
      {play.option_ticket && (
        <DeckPanel title="Option ticket" accent="cyan">
          <JsonBlock value={play.option_ticket} />
        </DeckPanel>
      )}
      <DeckPanel title="Session meta" accent="cyan">
        <JsonBlock value={data.state.session_meta} />
      </DeckPanel>
      {data.state.watch && (
        <DeckPanel title="Watch record" accent="amber">
          <JsonBlock value={data.state.watch} />
        </DeckPanel>
      )}
    </SectionDeck>
  );
}

function DeskSection({ data }: { data: SpxAdminDashboardPayload }) {
  const d = data.desk;
  return (
    <SectionDeck>
      <DeckPanel title="Price action" defaultOpen accent="cyan">
        <KvTiles data={d.price_action} />
      </DeckPanel>
      <DeckPanel title="Moving averages" accent="violet">
        <KvTiles data={d.moving_averages} />
      </DeckPanel>
      <DeckPanel title="Internals" accent="bull">
        <KvTiles data={d.internals} />
      </DeckPanel>
      <DeckPanel title="Volatility" accent="amber">
        <KvTiles data={d.volatility as Record<string, unknown>} />
      </DeckPanel>
      <DeckPanel
        title="Dealer GEX"
        defaultOpen
        badge={`${(d.dealer_gex.walls as unknown[])?.length ?? 0} walls`}
        accent="bull"
      >
        <KvTiles
          data={{
            gex_net: d.dealer_gex.gex_net,
            gex_king: d.dealer_gex.gex_king,
            max_pain: d.dealer_gex.max_pain,
            gamma_flip: d.dealer_gex.gamma_flip,
            gamma_regime: d.dealer_gex.gamma_regime,
          }}
        />
        <DataTable className="mt-4">
          <thead>
            <tr>
              <th>Strike</th>
              <th>Kind</th>
              <th>Net GEX</th>
              <th>Dist</th>
            </tr>
          </thead>
          <tbody>
            {((d.dealer_gex.walls as Array<Record<string, unknown>>) ?? []).map((w) => (
              <tr key={String(w.strike)}>
                <td className="admin-td-strong">{String(w.strike)}</td>
                <td>{String(w.kind)}</td>
                <td className="admin-td-bull">{String(w.net_gex)}</td>
                <td>{String(w.distance_pts)}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </DeckPanel>
      <DeckPanel title="Flow & tide" accent="cyan">
        <KvTiles data={d.flow as Record<string, unknown>} />
      </DeckPanel>
      <DeckPanel title="Levels" badge={String(d.levels.length)} accent="violet">
        <DataTable>
          <thead>
            <tr>
              <th>Label</th>
              <th>Value</th>
              <th>Kind</th>
              <th>Dist%</th>
            </tr>
          </thead>
          <tbody>
            {d.levels.map((l) => (
              <tr key={l.label}>
                <td className="admin-td-strong">{l.label}</td>
                <td>{l.value}</td>
                <td>{l.kind}</td>
                <td>{l.distance_pct?.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </DeckPanel>
      <DeckPanel title="Unified tape" badge={String(d.tape.length)} accent="amber">
        <DataTable tall>
          <thead>
            <tr>
              <th>Time</th>
              <th>Side</th>
              <th>Label</th>
              <th>Premium</th>
            </tr>
          </thead>
          <tbody>
            {d.tape.map((t) => (
              <tr key={`${t.time}-${t.label}`}>
                <td>{fmtTime(t.time)}</td>
                <td className={t.side === "call" ? "admin-td-bull" : t.side === "put" ? "admin-td-bear" : ""}>
                  {t.side}
                </td>
                <td>{t.label}</td>
                <td className="admin-td-strong">{t.premium?.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </DeckPanel>
      <DeckPanel title="Macro & news" accent="violet">
        <JsonBlock value={{ macro: d.macro_events, news: d.news_headlines }} />
      </DeckPanel>
      <DeckPanel title="Confluence snapshot" accent="bull">
        <JsonBlock value={data.confluence} />
      </DeckPanel>
    </SectionDeck>
  );
}

function LottoSection({ data }: { data: SpxAdminDashboardPayload }) {
  const lotto = data.lotto.today;
  return (
    <SectionDeck>
      {lotto ? (
        <DeckPanel title="Live lotto" defaultOpen badge={lotto.phase} accent="violet">
          <JsonBlock value={lotto} />
        </DeckPanel>
      ) : (
        <EmptyDeck title="No live lotto state" hint="Run live engine to load lotto evaluation." />
      )}
      {data.lotto.record && (
        <DeckPanel title="Lotto record (DB)" accent="cyan">
          <JsonBlock value={data.lotto.record} />
        </DeckPanel>
      )}
      <DeckPanel title="Today's history" badge={String(data.lotto.history.length)} accent="violet">
        <DataTable tall>
          <thead>
            <tr>
              <th>Pick</th>
              <th>Phase</th>
              <th>Dir</th>
              <th>Strike</th>
              <th>Outcome</th>
              <th>Headline</th>
            </tr>
          </thead>
          <tbody>
            {data.lotto.history.map((r) => (
              <tr key={r.id}>
                <td>{r.pick_index}</td>
                <td>{r.phase}</td>
                <td>{r.direction}</td>
                <td className="admin-td-strong">{r.strike}</td>
                <td>{r.outcome ? <OutcomeBadge outcome={r.outcome} /> : "—"}</td>
                <td className="admin-td-truncate">{r.headline ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </DeckPanel>
    </SectionDeck>
  );
}

function OutcomesSection({ rows }: { rows: PlayOutcomeRow[] }) {
  const [grade, setGrade] = useState("all");
  const [path, setPath] = useState("all");
  const [outcome, setOutcome] = useState("all");
  const [exit, setExit] = useState("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);

  const grades = useMemo(() => ["all", ...Array.from(new Set(rows.map((r) => r.grade)))], [rows]);
  const exits = useMemo(
    () => ["all", ...Array.from(new Set(rows.map((r) => r.exit_action ?? "UNKNOWN")))],
    [rows]
  );

  const closed = rows.filter((r) => r.outcome !== "open");
  const filtered = useMemo(() => {
    return closed.filter((r) => {
      if (grade !== "all" && r.grade !== grade) return false;
      if (path !== "all" && r.entry_path !== path) return false;
      if (outcome !== "all" && r.outcome !== outcome) return false;
      if (exit !== "all" && (r.exit_action ?? "UNKNOWN") !== exit) return false;
      if (search && !r.headline.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [closed, grade, path, outcome, exit, search]);

  const wins = filtered.filter((r) => r.outcome === "win").length;
  const winRate = filtered.length ? wins / filtered.length : 0;

  return (
    <SectionDeck>
      <div className="admin-filter-bar">
        <FilterSelect
          label="Grade"
          value={grade}
          onChange={setGrade}
          options={grades.map((g) => ({ value: g, label: g === "all" ? "All grades" : g }))}
        />
        <FilterSelect
          label="Path"
          value={path}
          onChange={setPath}
          options={[
            { value: "all", label: "All paths" },
            { value: "cold_buy", label: "Cold BUY" },
            { value: "watch_promote", label: "WATCH→ENTRY" },
          ]}
        />
        <FilterSelect
          label="Outcome"
          value={outcome}
          onChange={setOutcome}
          options={[
            { value: "all", label: "All outcomes" },
            { value: "win", label: "Win" },
            { value: "loss", label: "Loss" },
            { value: "breakeven", label: "Breakeven" },
          ]}
        />
        <FilterSelect
          label="Exit"
          value={exit}
          onChange={setExit}
          options={exits.map((e) => ({ value: e, label: e === "all" ? "All exits" : e }))}
        />
        <FilterSearch label="Search" value={search} onChange={setSearch} placeholder="Headline…" />
      </div>

      <div className="admin-outcomes-summary">
        <MegaStat label="Filtered plays" value={String(filtered.length)} sub={`of ${closed.length} closed`} tone="cyan" />
        <MegaStat label="Filter win rate" value={pct(winRate)} sub={`${wins}W in view`} tone="bull" bar={winRate * 100} />
      </div>

      <GlassPanel title="Closed play ledger" accent="bull" kicker="Click row to expand">
        <DataTable tall>
          <thead>
            <tr>
              <th />
              <th>Closed</th>
              <th>Path</th>
              <th>Grade</th>
              <th>Dir</th>
              <th>Exit</th>
              <th>Outcome</th>
              <th>PnL</th>
              <th>MFE</th>
              <th>MAE</th>
              <th>Headline</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <Fragment key={r.id}>
                <tr className="admin-spx-row-click" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                  <td>{expanded === r.id ? "▾" : "▸"}</td>
                  <td className="whitespace-nowrap">{fmtTime(r.closed_at)}</td>
                  <td>{r.entry_path === "watch_promote" ? "promote" : "cold"}</td>
                  <td className="admin-td-strong">{r.grade}</td>
                  <td>{r.direction}</td>
                  <td>{r.exit_action ?? "—"}</td>
                  <td>
                    <OutcomeBadge outcome={r.outcome} />
                  </td>
                  <td className={r.pnl_pts != null && r.pnl_pts >= 0 ? "admin-td-bull" : "admin-td-bear"}>
                    {r.pnl_pts != null ? r.pnl_pts.toFixed(1) : "—"}
                  </td>
                  <td>{r.mfe_pts.toFixed(1)}</td>
                  <td>{r.mae_pts.toFixed(1)}</td>
                  <td className="admin-td-truncate">{r.headline}</td>
                </tr>
                {expanded === r.id && (
                  <tr>
                    <td colSpan={11}>
                      <JsonBlock value={r} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </DataTable>
      </GlassPanel>
    </SectionDeck>
  );
}

function SignalsSection({ data }: { data: SpxAdminDashboardPayload }) {
  const [action, setAction] = useState("all");
  const signals = data.analytics.recent_signals;
  const actions = useMemo(() => ["all", ...Array.from(new Set(signals.map((s) => s.action)))], [signals]);
  const filtered = useMemo(
    () => (action === "all" ? signals : signals.filter((s) => s.action === action)),
    [signals, action]
  );

  return (
    <SectionDeck>
      <div className="admin-filter-bar">
        <FilterSelect
          label="Action"
          value={action}
          onChange={setAction}
          options={actions.map((a) => ({ value: a, label: a === "all" ? "All actions" : a }))}
        />
      </div>

      <div className="admin-metric-chip-row">
        {data.analytics.signal_actions_30d.map((s) => (
          <MetricChip key={s.action} label={s.action} value={String(s.count)} tone="violet" />
        ))}
      </div>

      <GlassPanel title="Signal log" accent="violet" kicker={`${filtered.length} events`}>
        <DataTable tall>
          <thead>
            <tr>
              <th>Time</th>
              <th>Action</th>
              <th>Bias</th>
              <th>Score</th>
              <th>Conf</th>
              <th>Headline</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id}>
                <td>{fmtTime(s.created_at)}</td>
                <td className="admin-td-strong">{s.action}</td>
                <td className={s.bias === "bull" ? "admin-td-bull" : s.bias === "bear" ? "admin-td-bear" : ""}>
                  {s.bias ?? "—"}
                </td>
                <td>{s.score}</td>
                <td>{s.confidence}</td>
                <td className="admin-td-truncate">{s.headline}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </GlassPanel>
    </SectionDeck>
  );
}

function AnalyticsSection({ data }: { data: SpxAdminDashboardPayload }) {
  const a = data.analytics;
  const stats = a.outcome_stats;

  return (
    <SectionDeck accent="violet">
      {a.adaptive && (
        <GlassPanel title="Adaptive gates" accent="violet" kicker="Engine learning layer">
          <p className="admin-adaptive-summary admin-adaptive-banner">{a.adaptive.summary}</p>
          <div className="admin-metric-chip-row mt-4">
            <MetricChip label="Active" value={a.adaptive.active ? "YES" : "NO"} tone={a.adaptive.active ? "bull" : "neutral"} />
            <MetricChip label="Global boost" value={`+${a.adaptive.global_min_score_boost}`} tone="cyan" />
            <MetricChip label="Promote boost" value={`+${a.adaptive.promote_min_score_boost}`} tone="violet" />
            <MetricChip label="Promote blocked" value={a.adaptive.promote_blocked ? "YES" : "NO"} tone={a.adaptive.promote_blocked ? "bear" : "bull"} />
            <MetricChip label="Claude required" value={a.adaptive.promote_requires_claude ? "YES" : "NO"} tone="amber" />
          </div>
        </GlassPanel>
      )}

      <div className="admin-analytics-rings">
        <WinRateRing value={stats.cold_buy.win_rate} label="Cold BUY" sub={`${stats.cold_buy.count} plays`} tone="bull" size={100} />
        <WinRateRing value={stats.watch_promote.win_rate} label="Promote" sub={`${stats.watch_promote.count} plays`} tone="violet" size={100} />
        <MegaStat label="Open outcomes" value={String(a.open_outcomes)} sub="still tracking" tone="amber" />
      </div>

      <div className="admin-two-col">
        <GlassPanel title="By grade" accent="bull">
          <div className="admin-bar-list">
            {a.grade_breakdown.map((g) => (
              <HorzBar
                key={g.grade}
                label={g.grade}
                value={g.win_rate}
                max={1}
                tone={g.win_rate >= 0.5 ? "bull" : "bear"}
                right={`${pct(g.win_rate)} · n=${g.count} · avg ${g.avg_pnl.toFixed(1)}`}
              />
            ))}
          </div>
        </GlassPanel>
        <GlassPanel title="Exit reason" accent="bear">
          <div className="admin-bar-list">
            {a.exit_breakdown.map((e) => (
              <HorzBar
                key={e.exit_action}
                label={e.exit_action}
                value={Math.abs(e.avg_pnl)}
                max={Math.max(1, ...a.exit_breakdown.map((x) => Math.abs(x.avg_pnl)))}
                tone={e.avg_pnl >= 0 ? "bull" : "bear"}
                right={`n=${e.count} · avg ${e.avg_pnl.toFixed(1)}`}
              />
            ))}
          </div>
        </GlassPanel>
      </div>

      <GlassPanel title="Daily rollup (ET)" accent="cyan" kicker="Session P&L">
        <PnlChart days={a.daily_rollup} />
        <DataTable className="mt-6">
          <thead>
            <tr>
              <th>Day</th>
              <th>Trades</th>
              <th>W/L</th>
              <th>Avg</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {a.daily_rollup.map((d) => (
              <tr key={d.day}>
                <td className="admin-td-strong">{d.day}</td>
                <td>{d.trades}</td>
                <td>
                  <span className="admin-td-bull">{d.wins}</span>
                  <span className="text-cyan-400"> / </span>
                  <span className="admin-td-bear">{d.losses}</span>
                </td>
                <td>{d.avg_pnl.toFixed(1)}</td>
                <td className={d.total_pnl >= 0 ? "admin-td-bull admin-td-strong" : "admin-td-bear admin-td-strong"}>
                  {d.total_pnl >= 0 ? "+" : ""}
                  {d.total_pnl.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </GlassPanel>

      <GlassPanel title="Path comparison" accent="violet">
        <div className="admin-path-compare">
          <HorzBar label="Cold BUY win rate" value={stats.cold_buy.win_rate} max={1} tone="bull" right={pct(stats.cold_buy.win_rate)} />
          <HorzBar label="Promote win rate" value={stats.watch_promote.win_rate} max={1} tone="violet" right={pct(stats.watch_promote.win_rate)} />
        </div>
      </GlassPanel>
    </SectionDeck>
  );
}

function ConfigSection({ data }: { data: SpxAdminDashboardPayload }) {
  const [group, setGroup] = useState("all");
  const groups = data.config;
  const visible = group === "all" ? groups : groups.filter((g) => g.id === group);

  return (
    <SectionDeck>
      <div className="admin-filter-bar">
        <FilterSelect
          label="Group"
          value={group}
          onChange={setGroup}
          options={[
            { value: "all", label: "All groups" },
            ...groups.map((g) => ({ value: g.id, label: g.label })),
          ]}
        />
      </div>
      {visible.map((g) => (
        <DeckPanel key={g.id} title={g.label} defaultOpen={group !== "all"} badge={String(g.items.length)} accent="cyan">
          <DataTable>
            <thead>
              <tr>
                <th>Key</th>
                <th>Effective value</th>
              </tr>
            </thead>
            <tbody>
              {g.items.map((item) => (
                <tr key={item.key}>
                  <td className="admin-api-mono admin-td-strong">{item.key}</td>
                  <td>{String(item.value)}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </DeckPanel>
      ))}
    </SectionDeck>
  );
}

export function AdminSpxDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [section, setSection] = useState<SectionId>(() => parseSection(searchParams.get("section")));
  const [data, setData] = useState<SpxAdminDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveLoading, setLiveLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState("");
  const [confirmLive, setConfirmLive] = useState(false);
  // EDGE-10: two-step confirmation for real mutations.
  const [confirmMutate, setConfirmMutate] = useState(false);

  /** Returns true if the current ET clock is within regular market hours (09:30–16:00). */
  function isMarketHours(): boolean {
    const now = new Date();
    const etStr = now.toLocaleString("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" });
    const [hStr, mStr] = etStr.split(":");
    const totalMin = Number(hStr) * 60 + Number(mStr);
    return totalMin >= 9 * 60 + 30 && totalMin < 16 * 60;
  }

  useEffect(() => {
    setSection(parseSection(searchParams.get("section")));
  }, [searchParams]);

  const goSection = useCallback(
    (next: SectionId) => {
      setSection(next);
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", "spx");
      if (next === "terminal") params.delete("section");
      else params.set("section", next);
      const qs = params.toString();
      router.replace(qs ? `/admin?${qs}` : "/admin", { scroll: false });
    },
    [router, searchParams]
  );

  useEffect(() => {
    const tick = () => {
      setClock(
        new Date().toLocaleString("en-US", {
          timeZone: "America/New_York",
          weekday: "short",
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async (live = false, dryRun = true) => {
    if (live) setLiveLoading(true);
    else setLoading(true);
    setError(null);
    try {
      let qs = live ? "?live=1" : "";
      // EDGE-10: always pass dryRun flag when running live engine.
      if (live && !dryRun) qs += "&dryRun=false";
      const res = await fetch(`/api/admin/spx/dashboard${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 403 ? "Not authorized" : `HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
      setLiveLoading(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  useEffect(() => {
    const terminal = section === "terminal";
    const ms = terminal ? 5_000 : 30_000;
    const id = setInterval(() => load(false), ms);
    return () => clearInterval(id);
  }, [load, section]);

  const stats = data?.analytics;
  const wr = stats?.outcome_stats.overall.win_rate ?? 0;
  const cold = stats?.outcome_stats.cold_buy.win_rate ?? 0;
  const promote = stats?.outcome_stats.watch_promote.win_rate ?? 0;
  const staleMs = data ? Date.now() - new Date(data.generated_at).getTime() : 0;
  const isStale = staleMs > 90_000;

  return (
    <div className="admin-spx-dashboard admin-deck-root">
      {/* Step 1 — dry-run preview confirmation (EDGE-10) */}
      <ConfirmModal
        open={confirmLive}
        title="Run live SPX engine (dry run)?"
        body={`This evaluates the play engine against live desk data in read-only mode — no BUY/SELL orders or Discord notifications will fire. To allow real mutations you will be asked to confirm a second time.${isMarketHours() ? "\n\n⚠ MARKET IS CURRENTLY OPEN (09:30–16:00 ET) — mutations below could trigger real orders." : ""}`}
        confirmLabel="Run dry-run preview"
        onCancel={() => setConfirmLive(false)}
        onConfirm={() => {
          setConfirmLive(false);
          load(true, true);
        }}
        loading={liveLoading}
      />
      {/* Step 2 — actual mutate confirmation, only reached from LiveEngineSection (EDGE-10) */}
      <ConfirmModal
        open={confirmMutate}
        title={isMarketHours() ? "⚠ MARKET OPEN — Allow real engine mutation?" : "Allow real engine mutation?"}
        body={`${isMarketHours() ? "MARKET IS OPEN (09:30–16:00 ET). " : ""}This will run the engine with mutate:true, which CAN write a real BUY/SELL to the database and fire Discord. Only confirm if you intend to open or modify a live play right now.`}
        confirmLabel="Yes — mutate live session"
        onCancel={() => setConfirmMutate(false)}
        onConfirm={() => {
          setConfirmMutate(false);
          load(true, false);
        }}
        loading={liveLoading}
      />
      <TabCommandHero
        compact={section === "terminal"}
        kicker="Blackout · SPX Engine"
        title="SPX Sniper"
        titleAccent="Command"
        subtitle="Live engine · desk intel · outcomes · signals · adaptive telemetry · full config"
        chips={
          <>
            <LivePill label={loading ? "Loading…" : data?.live_engine ? "Live engine on" : "Desk snapshot"} />
            <span className="admin-hero-chip">ET {clock}</span>
            {stats && (
              <>
                <span className="admin-hero-chip">Signals today {stats.signals_today}</span>
                <span className="admin-hero-chip">Flow alerts {stats.flow_alerts_today}</span>
                {data?.terminal && data.terminal.counts.critical + data.terminal.counts.warning > 0 && (
                  <span className="admin-hero-chip admin-hero-chip-warn">
                    {data.terminal.counts.critical} critical · {data.terminal.counts.warning} warn
                  </span>
                )}
              </>
            )}
          </>
        }
        actions={
          <>
            <ActionButton onClick={() => load(false)} disabled={loading}>
              Refresh
            </ActionButton>
            <ActionButton onClick={() => setConfirmLive(true)} disabled={liveLoading} variant="primary">
              {liveLoading ? "Running…" : "Run live engine (dry run)"}
            </ActionButton>
          </>
        }
        rings={
          stats && section !== "terminal" ? (
            <>
              <WinRateRing
                value={wr}
                label="Win rate"
                sub={`${stats.outcome_stats.overall.wins}W · ${stats.outcome_stats.overall.losses}L`}
                tone="bull"
                size={96}
              />
              <WinRateRing value={cold} label="Cold BUY" sub={`${stats.outcome_stats.cold_buy.count} trades`} tone="cyan" size={96} />
              <WinRateRing
                value={promote}
                label="Promote"
                sub={`${stats.outcome_stats.watch_promote.count} trades`}
                tone="violet"
                size={96}
              />
            </>
          ) : undefined
        }
      />

      {stats && section !== "terminal" && (
        <section className="admin-mega-grid">
          <MegaStat
            label="Closed plays"
            value={String(stats.outcome_stats.total_closed)}
            sub={`${stats.outcome_stats.days_of_data.toFixed(0)} days logged`}
            tone="neutral"
          />
          <MegaStat
            label="Avg PnL"
            value={`${stats.avg_pnl_pts >= 0 ? "+" : ""}${stats.avg_pnl_pts.toFixed(1)} pts`}
            sub={`MFE ${stats.avg_mfe_pts.toFixed(1)} · MAE ${stats.avg_mae_pts.toFixed(1)}`}
            tone={stats.avg_pnl_pts >= 0 ? "bull" : "bear"}
            trend={stats.avg_pnl_pts >= 0 ? "up" : "down"}
          />
          <MegaStat label="Open outcomes" value={String(stats.open_outcomes)} sub="Active in DB" tone="amber" />
          <MegaStat
            label="Adaptive gates"
            value={stats.adaptive?.active ? "LIVE" : "COLLECT"}
            sub={stats.adaptive?.summary?.slice(0, 48) ?? "Building sample"}
            tone="violet"
            bar={
              stats.adaptive?.active ? 100 : Math.min(100, (stats.outcome_stats.total_closed / 8) * 100)
            }
          />
        </section>
      )}

      {error && <p className="admin-error">{error}</p>}
      {isStale && (
        <p className="admin-warn admin-stale-banner">
          Desk data is stale ({Math.round(staleMs / 1000)}s old) — last refresh may have failed silently.
        </p>
      )}
      {!data?.analytics.db_configured && (
        <p className="admin-warn">DATABASE_URL not set — analytics and state may be empty or in-memory only.</p>
      )}

      <nav className="admin-deck-nav admin-deck-nav-pro">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={clsx("admin-deck-nav-tab", section === s.id && "admin-deck-nav-tab-active")}
            onClick={() => goSection(s.id)}
          >
            <span className="admin-deck-nav-icon">{s.icon}</span>
            <span>{s.label}</span>
            {s.id === "terminal" && data && data.terminal.counts.critical + data.terminal.counts.warning > 0 && (
              <span className="admin-deck-badge admin-deck-badge-warn">
                {data.terminal.counts.critical + data.terminal.counts.warning}
              </span>
            )}
          </button>
        ))}
      </nav>

      {data && (
        <div className="admin-deck-content">
          {section === "overview" && <OverviewSection data={data} />}
          {section === "terminal" && (
            <AdminSpxTerminal data={data} loading={loading} onRefresh={() => load(false)} />
          )}
          {section === "live" && <LiveEngineSection data={data} onRunMutate={() => setConfirmMutate(true)} />}
          {section === "desk" && <DeskSection data={data} />}
          {section === "lotto" && <LottoSection data={data} />}
          {section === "outcomes" && <OutcomesSection rows={data.outcomes_all} />}
          {section === "signals" && <SignalsSection data={data} />}
          {section === "analytics" && <AnalyticsSection data={data} />}
          {section === "config" && <ConfigSection data={data} />}
          {section !== "terminal" && (
            <p className="admin-api-footer">
              Updated {fmtTime(data.generated_at)}
              {data.live_engine ? " · live engine evaluated" : " · desk snapshot only"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

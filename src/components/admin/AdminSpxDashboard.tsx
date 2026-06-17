"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import type { SpxAdminDashboardPayload } from "@/lib/admin-spx-dashboard";
import type { PlayOutcomeRow } from "@/lib/spx-play-outcomes";

type SectionId =
  | "overview"
  | "live"
  | "desk"
  | "lotto"
  | "outcomes"
  | "signals"
  | "analytics"
  | "config";

const SECTIONS: Array<{ id: SectionId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "live", label: "Live Engine" },
  { id: "desk", label: "Desk Intel" },
  { id: "lotto", label: "Lotto" },
  { id: "outcomes", label: "Outcomes" },
  { id: "signals", label: "Signals" },
  { id: "analytics", label: "Analytics" },
  { id: "config", label: "Config" },
];

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
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

function StatCard({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "bull" | "bear" | "neutral" | "violet";
}) {
  return (
    <div className={clsx("admin-stat-card", `admin-stat-${tone}`)}>
      <p className="admin-stat-label">{label}</p>
      <p className="admin-stat-value">{value}</p>
      {sub && <p className="admin-stat-sub">{sub}</p>}
    </div>
  );
}

function CollapsiblePanel({
  title,
  defaultOpen = false,
  children,
  badge,
}: {
  title: string;
  defaultOpen?: boolean;
  badge?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="admin-spx-panel">
      <button type="button" className="admin-spx-panel-head" onClick={() => setOpen((v) => !v)}>
        <span className="admin-spx-panel-title">{title}</span>
        {badge && <span className="admin-spx-badge">{badge}</span>}
        <span className="admin-spx-chevron">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="admin-spx-panel-body">{children}</div>}
    </div>
  );
}

function KeyValueGrid({ data }: { data: Record<string, unknown> }) {
  return (
    <dl className="admin-spx-kv-grid">
      {Object.entries(data).map(([k, v]) => (
        <div key={k} className="admin-spx-kv-row">
          <dt>{k}</dt>
          <dd>{v == null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="admin-spx-json">{JSON.stringify(value, null, 2)}</pre>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="admin-spx-filter">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="admin-spx-select">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function OverviewSection({ data }: { data: SpxAdminDashboardPayload }) {
  const play = data.play;
  const stats = data.analytics.outcome_stats;
  const c = data.confluence;

  return (
    <div className="admin-spx-section">
      <div className="admin-spx-hero">
        <div>
          <p className="admin-spx-hero-kicker">
            {data.desk.market.label ?? "SPX"} · {data.desk.market.open ? "OPEN" : "CLOSED"}
          </p>
          <h2 className="admin-spx-hero-title">
            {play?.action ?? c?.direction?.toUpperCase() ?? "SCANNING"}
            {play?.direction ? ` · ${play.direction.toUpperCase()}` : ""}
          </h2>
          <p className="admin-spx-hero-sub">
            {play?.headline ?? c?.headline ?? "Awaiting live engine tick"}
          </p>
        </div>
        <div className="admin-spx-hero-stats">
          <div>
            <p className="admin-stat-label">SPX</p>
            <p className="admin-spx-hero-price">{data.desk.price_action.price as number}</p>
          </div>
          <div>
            <p className="admin-stat-label">Grade</p>
            <p className="admin-spx-hero-grade">{play?.grade ?? c?.grade ?? "—"}</p>
          </div>
          <div>
            <p className="admin-stat-label">Score</p>
            <p className="admin-spx-hero-grade">{play?.score ?? c?.score ?? "—"}</p>
          </div>
        </div>
      </div>

      <section className="admin-stat-grid admin-spx-stat-grid">
        <StatCard
          label="Win rate"
          value={pct(stats.overall.win_rate)}
          sub={`${stats.overall.wins}W · ${stats.overall.losses}L`}
          tone="bull"
        />
        <StatCard label="Closed" value={String(stats.total_closed)} sub={`${stats.days_of_data.toFixed(0)}d data`} />
        <StatCard
          label="Avg PnL"
          value={`${data.analytics.avg_pnl_pts >= 0 ? "+" : ""}${data.analytics.avg_pnl_pts.toFixed(1)}`}
          tone={data.analytics.avg_pnl_pts >= 0 ? "bull" : "bear"}
        />
        <StatCard label="Signals today" value={String(data.analytics.signals_today)} />
        <StatCard label="Flow alerts" value={String(data.analytics.flow_alerts_today)} />
        <StatCard
          label="Lotto"
          value={data.lotto.today?.phase ?? data.lotto.record?.phase ?? "—"}
          tone="violet"
        />
      </section>

      {data.analytics.insights.length > 0 && (
        <section className="admin-insights">
          <h2 className="admin-section-title">Insights</h2>
          <ul className="admin-insight-list">
            {data.analytics.insights.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function LiveEngineSection({ data }: { data: SpxAdminDashboardPayload }) {
  const play = data.play;
  if (!play) {
    return (
      <p className="admin-api-muted">
        Live engine not loaded — click <strong>Run live engine</strong> to evaluate play state (mutates session).
      </p>
    );
  }

  return (
    <div className="admin-spx-section">
      <CollapsiblePanel title="Play state" defaultOpen badge={`${play.phase} · ${play.action}`}>
        <KeyValueGrid
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
      </CollapsiblePanel>

      <CollapsiblePanel title="Gates" defaultOpen badge={play.gates.passed ? "PASSED" : "BLOCKED"}>
        {play.gates.play_idea && <p className="admin-spx-idea">{play.gates.play_idea}</p>}
        <p className="admin-section-title mt-2">Blocks ({play.gates.blocks.length})</p>
        <ul className="admin-spx-list admin-spx-list-error">
          {play.gates.blocks.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
        <p className="admin-section-title mt-3">Warnings ({play.gates.warnings.length})</p>
        <ul className="admin-spx-list admin-spx-list-warn">
          {play.gates.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
        <p className="admin-spx-meta">Entry mode: {play.gates.entry_mode}</p>
      </CollapsiblePanel>

      <CollapsiblePanel title="Confluence factors" badge={String(play.factors.length)}>
        <table className="admin-table">
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
                <td>{f.label}</td>
                <td className={f.weight > 0 ? "text-bull" : f.weight < 0 ? "text-bear" : ""}>
                  {f.weight > 0 ? "+" : ""}
                  {f.weight}
                </td>
                <td>{f.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CollapsiblePanel>

      {play.confirmations && (
        <CollapsiblePanel
          title="Confirmations"
          badge={`${play.confirmations.passed_count}/${play.confirmations.total}`}
        >
          <JsonBlock value={play.confirmations} />
        </CollapsiblePanel>
      )}

      {play.mtf && (
        <CollapsiblePanel title="MTF hybrid" badge={play.mtf.ok ? "OK" : "FAIL"}>
          <JsonBlock value={play.mtf} />
        </CollapsiblePanel>
      )}

      {play.technicals && (
        <CollapsiblePanel title="Technicals">
          <JsonBlock value={play.technicals} />
        </CollapsiblePanel>
      )}

      {play.claude && (
        <CollapsiblePanel title="Claude verdict" badge={play.claude.verdict}>
          <JsonBlock value={play.claude} />
        </CollapsiblePanel>
      )}

      {play.open_play && (
        <CollapsiblePanel title="Open play" defaultOpen badge={play.open_play.direction}>
          <JsonBlock value={play.open_play} />
        </CollapsiblePanel>
      )}

      {play.watch && (
        <CollapsiblePanel title="Watch state" badge={play.watch.promote_ready ? "PROMOTE READY" : "WATCH"}>
          <JsonBlock value={play.watch} />
        </CollapsiblePanel>
      )}

      {play.option_ticket && (
        <CollapsiblePanel title="Option ticket">
          <JsonBlock value={play.option_ticket} />
        </CollapsiblePanel>
      )}

      <CollapsiblePanel title="Session meta">
        <JsonBlock value={data.state.session_meta} />
      </CollapsiblePanel>

      {data.state.watch && (
        <CollapsiblePanel title="Watch record">
          <JsonBlock value={data.state.watch} />
        </CollapsiblePanel>
      )}
    </div>
  );
}

function DeskSection({ data }: { data: SpxAdminDashboardPayload }) {
  const d = data.desk;
  return (
    <div className="admin-spx-section">
      <CollapsiblePanel title="Price action" defaultOpen>
        <KeyValueGrid data={d.price_action} />
      </CollapsiblePanel>
      <CollapsiblePanel title="Moving averages">
        <KeyValueGrid data={d.moving_averages} />
      </CollapsiblePanel>
      <CollapsiblePanel title="Internals">
        <KeyValueGrid data={d.internals} />
      </CollapsiblePanel>
      <CollapsiblePanel title="Volatility">
        <KeyValueGrid data={d.volatility as Record<string, unknown>} />
      </CollapsiblePanel>
      <CollapsiblePanel title="Dealer GEX" defaultOpen badge={String((d.dealer_gex.walls as unknown[])?.length ?? 0) + " walls"}>
        <KeyValueGrid
          data={{
            gex_net: d.dealer_gex.gex_net,
            gex_king: d.dealer_gex.gex_king,
            max_pain: d.dealer_gex.max_pain,
            gamma_flip: d.dealer_gex.gamma_flip,
            gamma_regime: d.dealer_gex.gamma_regime,
          }}
        />
        <table className="admin-table mt-3">
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
                <td>{String(w.strike)}</td>
                <td>{String(w.kind)}</td>
                <td>{String(w.net_gex)}</td>
                <td>{String(w.distance_pts)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CollapsiblePanel>
      <CollapsiblePanel title="Flow & tide">
        <KeyValueGrid data={d.flow as Record<string, unknown>} />
      </CollapsiblePanel>
      <CollapsiblePanel title="Levels" badge={String(d.levels.length)}>
        <table className="admin-table">
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
                <td>{l.label}</td>
                <td>{l.value}</td>
                <td>{l.kind}</td>
                <td>{l.distance_pct?.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CollapsiblePanel>
      <CollapsiblePanel title="Unified tape" badge={String(d.tape.length)}>
        <table className="admin-table">
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
                <td>{t.side}</td>
                <td>{t.label}</td>
                <td>{t.premium?.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CollapsiblePanel>
      <CollapsiblePanel title="Macro & news">
        <JsonBlock value={{ macro: d.macro_events, news: d.news_headlines }} />
      </CollapsiblePanel>
      <CollapsiblePanel title="Confluence snapshot">
        <JsonBlock value={data.confluence} />
      </CollapsiblePanel>
    </div>
  );
}

function LottoSection({ data }: { data: SpxAdminDashboardPayload }) {
  const lotto = data.lotto.today;
  return (
    <div className="admin-spx-section">
      {lotto ? (
        <CollapsiblePanel title="Live lotto" defaultOpen badge={lotto.phase}>
          <JsonBlock value={lotto} />
        </CollapsiblePanel>
      ) : (
        <p className="admin-api-muted">Run live engine to load lotto state.</p>
      )}
      {data.lotto.record && (
        <CollapsiblePanel title="Lotto record (DB/meta)">
          <JsonBlock value={data.lotto.record} />
        </CollapsiblePanel>
      )}
      <CollapsiblePanel title="Today's history" badge={String(data.lotto.history.length)}>
        <table className="admin-table">
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
                <td>{r.strike}</td>
                <td>{r.outcome ?? "—"}</td>
                <td className="max-w-[200px] truncate">{r.headline ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CollapsiblePanel>
    </div>
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

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (r.outcome === "open") return false;
      if (grade !== "all" && r.grade !== grade) return false;
      if (path !== "all" && r.entry_path !== path) return false;
      if (outcome !== "all" && r.outcome !== outcome) return false;
      if (exit !== "all" && (r.exit_action ?? "UNKNOWN") !== exit) return false;
      if (search && !r.headline.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [rows, grade, path, outcome, exit, search]);

  return (
    <div className="admin-spx-section">
      <div className="admin-spx-filters">
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
        <label className="admin-spx-filter admin-spx-filter-search">
          <span>Search</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Headline…"
            className="admin-spx-input"
          />
        </label>
      </div>
      <p className="admin-spx-meta mb-3">{filtered.length} of {rows.filter((r) => r.outcome !== "open").length} closed plays</p>
      <div className="admin-scroll-table admin-spx-table-tall">
        <table className="admin-table">
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
                  <td>{r.grade}</td>
                  <td>{r.direction}</td>
                  <td>{r.exit_action ?? "—"}</td>
                  <td className={r.outcome === "win" ? "text-bull" : r.outcome === "loss" ? "text-bear" : ""}>
                    {r.outcome}
                  </td>
                  <td>{r.pnl_pts != null ? r.pnl_pts.toFixed(1) : "—"}</td>
                  <td>{r.mfe_pts.toFixed(1)}</td>
                  <td>{r.mae_pts.toFixed(1)}</td>
                  <td className="max-w-[180px] truncate">{r.headline}</td>
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
        </table>
      </div>
    </div>
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
    <div className="admin-spx-section">
      <div className="admin-spx-filters">
        <FilterSelect
          label="Action"
          value={action}
          onChange={setAction}
          options={actions.map((a) => ({ value: a, label: a === "all" ? "All actions" : a }))}
        />
      </div>
      <div className="admin-mini-grid mb-4">
        {data.analytics.signal_actions_30d.map((s) => (
          <span key={s.action}>
            {s.action}: {s.count}
          </span>
        ))}
      </div>
      <div className="admin-scroll-table admin-spx-table-tall">
        <table className="admin-table">
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
                <td>{s.action}</td>
                <td>{s.bias ?? "—"}</td>
                <td>{s.score}</td>
                <td>{s.confidence}</td>
                <td className="max-w-[280px] truncate">{s.headline}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AnalyticsSection({ data }: { data: SpxAdminDashboardPayload }) {
  const a = data.analytics;
  const stats = a.outcome_stats;
  return (
    <div className="admin-spx-section">
      {a.adaptive && (
        <section className="admin-panel">
          <h2 className="admin-section-title">Adaptive gates</h2>
          <p className="text-sm text-grey-300">{a.adaptive.summary}</p>
          <div className="admin-mini-grid mt-3">
            <span>Active: {a.adaptive.active ? "yes" : "no"}</span>
            <span>Global boost: +{a.adaptive.global_min_score_boost}</span>
            <span>Promote boost: +{a.adaptive.promote_min_score_boost}</span>
            <span>Promote blocked: {a.adaptive.promote_blocked ? "yes" : "no"}</span>
            <span>Promote requires Claude: {a.adaptive.promote_requires_claude ? "yes" : "no"}</span>
          </div>
        </section>
      )}
      <div className="admin-two-col">
        <section className="admin-panel">
          <h2 className="admin-section-title">By grade</h2>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Grade</th>
                <th>n</th>
                <th>Win%</th>
                <th>Avg PnL</th>
              </tr>
            </thead>
            <tbody>
              {a.grade_breakdown.map((g) => (
                <tr key={g.grade}>
                  <td>{g.grade}</td>
                  <td>{g.count}</td>
                  <td className={g.win_rate >= 0.5 ? "text-bull" : "text-bear"}>{pct(g.win_rate)}</td>
                  <td>{g.avg_pnl.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="admin-panel">
          <h2 className="admin-section-title">Exit reason</h2>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Exit</th>
                <th>n</th>
                <th>Avg PnL</th>
              </tr>
            </thead>
            <tbody>
              {a.exit_breakdown.map((e) => (
                <tr key={e.exit_action}>
                  <td>{e.exit_action}</td>
                  <td>{e.count}</td>
                  <td>{e.avg_pnl.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
      <section className="admin-panel">
        <h2 className="admin-section-title">Daily rollup (ET)</h2>
        <table className="admin-table">
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
                <td>{d.day}</td>
                <td>{d.trades}</td>
                <td>
                  {d.wins}/{d.losses}
                </td>
                <td>{d.avg_pnl.toFixed(1)}</td>
                <td className={d.total_pnl >= 0 ? "text-bull" : "text-bear"}>
                  {d.total_pnl >= 0 ? "+" : ""}
                  {d.total_pnl.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="admin-panel">
        <h2 className="admin-section-title">Path comparison</h2>
        <div className="admin-mini-grid">
          <span>Cold BUY: {pct(stats.cold_buy.win_rate)} ({stats.cold_buy.count}n)</span>
          <span>Promote: {pct(stats.watch_promote.win_rate)} ({stats.watch_promote.count}n)</span>
          <span>Open outcomes: {a.open_outcomes}</span>
        </div>
      </section>
    </div>
  );
}

function ConfigSection({ data }: { data: SpxAdminDashboardPayload }) {
  const [group, setGroup] = useState("all");
  const groups = data.config;
  const visible = group === "all" ? groups : groups.filter((g) => g.id === group);

  return (
    <div className="admin-spx-section">
      <div className="admin-spx-filters">
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
        <CollapsiblePanel key={g.id} title={g.label} defaultOpen={group !== "all"} badge={String(g.items.length)}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Effective value</th>
              </tr>
            </thead>
            <tbody>
              {g.items.map((item) => (
                <tr key={item.key}>
                  <td className="admin-api-mono">{item.key}</td>
                  <td>{String(item.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CollapsiblePanel>
      ))}
    </div>
  );
}

export function AdminSpxDashboard() {
  const [section, setSection] = useState<SectionId>("overview");
  const [data, setData] = useState<SpxAdminDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveLoading, setLiveLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (live = false) => {
    if (live) setLiveLoading(true);
    else setLoading(true);
    setError(null);
    try {
      const qs = live ? "?live=1" : "";
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
    const live = section === "live";
    const ms = live ? 10_000 : 30_000;
    const id = setInterval(() => load(live), ms);
    return () => clearInterval(id);
  }, [load, section]);

  useEffect(() => {
    if (section === "live" && data && !data.live_engine) {
      load(true);
    }
  }, [section, data, load]);

  return (
    <div className="admin-spx-dashboard">
      <header className="admin-spx-toolbar">
        <div>
          <h2 className="admin-section-title">SPX Sniper Command</h2>
          <p className="admin-sub">
            Live engine · desk intel · outcomes · signals · adaptive telemetry · full config
          </p>
        </div>
        <div className="admin-spx-toolbar-actions">
          <span className="admin-api-live">
            <span className="admin-api-live-dot" />
            {loading ? "Loading…" : data?.live_engine ? "Live engine on" : "Desk snapshot"}
          </span>
          <button type="button" className="admin-refresh-btn" onClick={() => load(false)} disabled={loading}>
            Refresh
          </button>
          <button
            type="button"
            className="admin-refresh-btn admin-spx-live-btn"
            onClick={() => load(true)}
            disabled={liveLoading}
          >
            {liveLoading ? "Running…" : "Run live engine"}
          </button>
        </div>
      </header>

      {error && <p className="admin-error">{error}</p>}
      {!data?.analytics.db_configured && (
        <p className="admin-warn">DATABASE_URL not set — analytics and state may be empty or in-memory only.</p>
      )}

      <nav className="admin-spx-section-nav">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={clsx("admin-spx-section-tab", section === s.id && "admin-spx-section-tab-active")}
            onClick={() => setSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {data && (
        <>
          {section === "overview" && <OverviewSection data={data} />}
          {section === "live" && <LiveEngineSection data={data} />}
          {section === "desk" && <DeskSection data={data} />}
          {section === "lotto" && <LottoSection data={data} />}
          {section === "outcomes" && <OutcomesSection rows={data.outcomes_all} />}
          {section === "signals" && <SignalsSection data={data} />}
          {section === "analytics" && <AnalyticsSection data={data} />}
          {section === "config" && <ConfigSection data={data} />}
          <p className="admin-api-footer">
            Updated {fmtTime(data.generated_at)}
            {data.live_engine ? " · live engine evaluated" : " · desk snapshot only"}
          </p>
        </>
      )}
    </div>
  );
}

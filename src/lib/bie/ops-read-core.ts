// Governed OPS READ tools — the PURE decision + render core (task #58). Side-effect-free so the
// three read-only ops reads (cron_runs / provider-health / cache-probe) and their honest member-
// facing rendering are exhaustively unit-testable WITHOUT touching a DB / cache / provider / clock.
//
// The server orchestrator (ops-read.ts) gathers each ops signal fail-open, hands it here as plain
// data, and these functions decide the health verdict + render it. The cardinal rule is HONESTY:
// every number is a real gathered value or an explicit "no data" — this core never fabricates a
// healthy/unhealthy verdict, never invents a timestamp for a cron that has no recorded run, and
// never emits a secret / internal hostname / raw upstream error (those are logged server-side only,
// per the /api/ready "log raw, return clean" pattern, task #66).

/** Which ops read a question is asking for. */
export type OpsReadKind = "crons" | "providers" | "caches" | "overview";

/** A coarse health verdict shared by every ops read. */
export type OpsHealth = "healthy" | "degraded" | "down" | "unknown";

/** Who the answer is for. Members get a clean one-line health badge with NO internal ops detail;
 *  admins get the full per-cron / per-provider / per-cache breakdown. Matches the #56 gating model
 *  (Largo is admin-launch-gated today) while making the member/admin split explicit for when Largo
 *  de-gates to premium members. */
export type OpsAudience = "admin" | "member";

// ---------------------------------------------------------------------------
// Query parsing — which ops read does a natural/terse question want?
// ---------------------------------------------------------------------------

const CRON_TERM_RE = /\bcrons?\b|\bscheduled jobs?\b|\bcron (?:job|run|task)s?\b|\bbackground jobs?\b/i;
const PROVIDER_TERM_RE = /\b(polygon|unusual ?whales|uw|massive|data provider|providers?|upstream)\b/i;
const CACHE_TERM_RE = /\b(cache|caches|snapshot|data|feed|numbers?)\b/i;

const OPS_CUE_RE =
  /\b(health|healthy|status|running|ran|run|stale|behind|ok|okay|up|down|fail(?:ing|ed|ure)?|working|overdue|nominal|degraded|reachable|online|offline|responding|latency|alive|fresh(?:ness)?|current|old|updated|warm|caught up|up ?to ?date)\b/i;

const PROVIDER_STATUS_RE =
  /\b(up|down|reachable|healthy|health|status|working|online|offline|responding|latency|alive|ok)\b/i;
const CACHE_FRESH_RE =
  /\b(fresh(?:ness)?|stale|current|up ?to ?date|old|updated|warm|age|status|health)\b/i;
const OVERVIEW_RE =
  /\bops (?:status|health|overview|check|report)\b|\bhealth ?check\b|\b(?:everything|all systems?|systems?|platform|infra(?:structure)?|services?) (?:ok|okay|healthy|up|running|status|health|nominal|green|fine|good)\b|\bis everything (?:ok|okay|healthy|up|running|working|green|fine)\b/i;

function asksCrons(q: string): boolean {
  return CRON_TERM_RE.test(q) && OPS_CUE_RE.test(q);
}
function asksProviders(q: string): boolean {
  // A provider named WITH a status cue ("is UW up", "is polygon down", "provider health"). The
  // status cue guard keeps a plain "polygon gamma flip" (no status word) out of the ops path.
  if (/\bprovider (?:health|status|up|down)\b/i.test(q)) return true;
  return PROVIDER_TERM_RE.test(q) && PROVIDER_STATUS_RE.test(q);
}
function asksCaches(q: string): boolean {
  return CACHE_TERM_RE.test(q) && CACHE_FRESH_RE.test(q) && !asksCrons(q);
}
function asksOverview(q: string): boolean {
  return OVERVIEW_RE.test(q);
}

/** True when the question is a governed ops read at all. */
export function isOpsReadQuestion(question: string): boolean {
  const q = question.trim();
  return asksOverview(q) || asksProviders(q) || asksCrons(q) || asksCaches(q);
}

/**
 * Pick the specific ops read. An explicit overview cue, OR a question spanning more than one
 * category ("are the crons healthy and is UW up"), yields the combined overview. Otherwise the
 * single matched category wins, with a stable precedence.
 */
export function parseOpsReadKind(question: string): OpsReadKind {
  const q = question.trim();
  if (asksOverview(q)) return "overview";
  const matched = [asksProviders(q), asksCrons(q), asksCaches(q)].filter(Boolean).length;
  if (matched > 1) return "overview";
  if (asksProviders(q)) return "providers";
  if (asksCrons(q)) return "crons";
  if (asksCaches(q)) return "caches";
  return "overview";
}

// ---------------------------------------------------------------------------
// 1) cron_runs
// ---------------------------------------------------------------------------

/** One cron's already-evaluated health, as produced by admin-cron-health.buildCronHealthSnapshot.
 *  We consume the platform's own source-of-truth status rather than re-deriving staleness. */
export type CronRunInput = {
  key: string;
  name: string;
  schedule_label: string;
  /** admin-cron-health status: healthy | warning | stale | failed | unknown. */
  status: string;
  last_run_at: string | null;
  last_status: string | null;
  age_min: number | null;
  stale_after_min: number;
  market_hours_stale: boolean;
  /** Raw last-run message — admin-only detail; already sanitized upstream (no secrets). */
  last_message?: string | null;
};

export type CronRunsGathered = {
  jobs: CronRunInput[];
  db_configured: boolean;
  logged_runs_total: number;
  /** admin-cron-health's honest note when NO runs are logged at all (DB/CRON_SECRET/handshake). */
  diagnostics_note: string | null;
  /** null when the whole snapshot read failed (fail-open) — reported as "unavailable", not healthy. */
  snapshot_available: boolean;
};

export type CronRunEval = {
  key: string;
  name: string;
  schedule_label: string;
  status: OpsHealth;
  last_run_at: string | null;
  age_min: number | null;
  /** True when this cron has NO recorded run — reported honestly, never given a fabricated time. */
  never_ran: boolean;
  stale: boolean;
  failed: boolean;
  /** Honest cadence + overdue window (NOT a fabricated next-run timestamp). */
  expected: string;
  last_message: string | null;
};

export type CronRunsResult = {
  available: boolean;
  overall: OpsHealth;
  total: number;
  healthy: number;
  stale: number;
  failed: number;
  never_ran: number;
  jobs: CronRunEval[];
  note: string | null;
};

function cronStatusToHealth(job: CronRunInput): { health: OpsHealth; never: boolean; stale: boolean; failed: boolean } {
  const s = (job.status || "").toLowerCase();
  const failed = s === "failed" || (job.last_status ?? "").toLowerCase() === "failed";
  const never = (s === "unknown" || s === "") && job.last_run_at == null;
  const stale = !failed && (s === "stale" || job.market_hours_stale === true);
  let health: OpsHealth = "healthy";
  if (failed) health = "down";
  else if (stale) health = "degraded";
  else if (never) health = "unknown";
  else if (s === "warning") health = "degraded";
  return { health, never, stale, failed };
}

function expectedLine(job: CronRunInput): string {
  // Honest: state the cadence (from the registry schedule label) + the overdue window. We do NOT
  // invent an exact next-run wall-clock time — most crons are cadence-triggered, not fixed-time.
  return `${job.schedule_label} — overdue if no run in ${job.stale_after_min}m`;
}

export function evaluateCronRuns(g: CronRunsGathered): CronRunsResult {
  if (!g.snapshot_available) {
    return {
      available: false,
      overall: "unknown",
      total: 0,
      healthy: 0,
      stale: 0,
      failed: 0,
      never_ran: 0,
      jobs: [],
      note: "Cron health snapshot is unavailable right now — I won't guess a status.",
    };
  }

  const jobs: CronRunEval[] = g.jobs.map((job) => {
    const { health, never, stale, failed } = cronStatusToHealth(job);
    return {
      key: job.key,
      name: job.name,
      schedule_label: job.schedule_label,
      status: health,
      last_run_at: job.last_run_at,
      age_min: job.age_min,
      never_ran: never,
      stale,
      failed,
      expected: expectedLine(job),
      last_message: job.last_message ?? null,
    };
  });

  const failed = jobs.filter((j) => j.failed).length;
  const stale = jobs.filter((j) => j.stale).length;
  const neverRan = jobs.filter((j) => j.never_ran).length;
  const healthy = jobs.filter((j) => j.status === "healthy").length;

  let overall: OpsHealth = "healthy";
  if (jobs.length === 0) overall = "unknown";
  else if (failed > 0) overall = "down";
  else if (stale > 0) overall = "degraded";
  else if (healthy === 0) overall = "unknown";

  // Honest note: no runs logged at all is a real state (fresh deploy / missing CRON_SECRET / DB off).
  const note =
    g.logged_runs_total === 0 ? g.diagnostics_note ?? "No cron runs have been recorded yet." : null;

  return { available: true, overall, total: jobs.length, healthy, stale, failed, never_ran: neverRan, jobs, note };
}

// ---------------------------------------------------------------------------
// 2) provider-health
// ---------------------------------------------------------------------------

/** A reachability probe result — the RAW upstream error is NOT here (logged server-side only). */
export type ProviderProbeInput = {
  provider: "polygon" | "uw";
  label: string;
  configured: boolean;
  /** True when an HTTP response was received at all (DNS+TCP+TLS+HTTP completed). */
  responded: boolean;
  /** HTTP status when responded, else null. */
  httpStatus: number | null;
  /** Round-trip latency in ms when responded, else null. */
  latencyMs: number | null;
};

export type ProviderEval = {
  provider: "polygon" | "uw";
  label: string;
  status: "up" | "down" | "unconfigured" | "unknown";
  detail: string;
  latencyMs: number | null;
};

export type ProviderHealthResult = {
  overall: OpsHealth;
  providers: ProviderEval[];
};

function evaluateProvider(p: ProviderProbeInput): ProviderEval {
  if (!p.configured) {
    return { provider: p.provider, label: p.label, status: "unconfigured", detail: "not configured", latencyMs: null };
  }
  if (!p.responded) {
    // Timeout / network error — the raw cause is logged server-side; the member-facing detail is clean.
    return { provider: p.provider, label: p.label, status: "down", detail: "no response (timeout/unreachable)", latencyMs: null };
  }
  const s = p.httpStatus ?? 0;
  if (s >= 500) return { provider: p.provider, label: p.label, status: "down", detail: `upstream error (${s})`, latencyMs: p.latencyMs };
  if (s === 401 || s === 403) return { provider: p.provider, label: p.label, status: "down", detail: "authentication issue", latencyMs: p.latencyMs };
  if (s === 429) return { provider: p.provider, label: p.label, status: "up", detail: "reachable (rate-limited)", latencyMs: p.latencyMs };
  if (s >= 200 && s < 500) return { provider: p.provider, label: p.label, status: "up", detail: "reachable", latencyMs: p.latencyMs };
  return { provider: p.provider, label: p.label, status: "unknown", detail: "indeterminate", latencyMs: p.latencyMs };
}

export function evaluateProviderHealth(probes: ProviderProbeInput[]): ProviderHealthResult {
  const providers = probes.map(evaluateProvider);
  const configured = providers.filter((p) => p.status !== "unconfigured");
  const up = configured.filter((p) => p.status === "up").length;
  const down = configured.filter((p) => p.status === "down").length;

  let overall: OpsHealth;
  if (configured.length === 0) overall = "unknown";
  else if (down === 0 && up > 0) overall = "healthy";
  else if (up === 0) overall = "down";
  else overall = "degraded";
  return { overall, providers };
}

// ---------------------------------------------------------------------------
// 3) cache-probe
// ---------------------------------------------------------------------------

/** A gathered cache-freshness reading. `key` is the internal Redis key — admin/log only, NEVER
 *  rendered to a member. Age is derived from the payload's own timestamp when the payload carries
 *  one; otherwise from the remaining-TTL vs full-TTL delta (both honest, no fabrication). */
export type CacheProbeInput = {
  label: string;
  key: string;
  present: boolean;
  ageSec: number | null;
  remainingTtlSec: number | null;
  ttlSec: number;
  /** Freshness threshold — older than this (in-window) is "stale". */
  staleAfterSec: number;
  /** True when this cache is only written during RTH (off-hours staleness is expected, not a fault). */
  marketHoursOnly: boolean;
};

export type CacheEval = {
  label: string;
  present: boolean;
  ageSec: number | null;
  status: OpsHealth;
  detail: string;
};

export type CacheProbeResult = {
  overall: OpsHealth;
  isRth: boolean;
  caches: CacheEval[];
};

function evaluateCache(c: CacheProbeInput, isRth: boolean): CacheEval {
  if (!c.present) {
    // Off-hours a market-hours-only cache legitimately expires/idles — honest "expected", not a fault.
    if (c.marketHoursOnly && !isRth) {
      return { label: c.label, present: false, ageSec: null, status: "unknown", detail: "not populated (market closed — expected)" };
    }
    return { label: c.label, present: false, ageSec: null, status: "degraded", detail: "missing" };
  }
  if (c.ageSec == null) {
    return { label: c.label, present: true, ageSec: null, status: "healthy", detail: "present (age unknown)" };
  }
  const stale = c.ageSec > c.staleAfterSec;
  if (stale && c.marketHoursOnly && !isRth) {
    return { label: c.label, present: true, ageSec: c.ageSec, status: "healthy", detail: "aged (market closed — expected)" };
  }
  if (stale) {
    return { label: c.label, present: true, ageSec: c.ageSec, status: "degraded", detail: `stale (${Math.round(c.ageSec)}s old)` };
  }
  return { label: c.label, present: true, ageSec: c.ageSec, status: "healthy", detail: `fresh (${Math.round(c.ageSec)}s old)` };
}

export function evaluateCacheProbe(caches: CacheProbeInput[], isRth: boolean): CacheProbeResult {
  const evals = caches.map((c) => evaluateCache(c, isRth));
  const anyDegraded = evals.some((e) => e.status === "degraded");
  const anyHealthy = evals.some((e) => e.status === "healthy");
  let overall: OpsHealth;
  if (evals.length === 0) overall = "unknown";
  else if (anyDegraded) overall = "degraded";
  else if (anyHealthy) overall = "healthy";
  else overall = "unknown";
  return { overall, isRth, caches: evals };
}

// ---------------------------------------------------------------------------
// Combined overview
// ---------------------------------------------------------------------------

export type OpsOverviewResult = {
  overall: OpsHealth;
  crons: CronRunsResult | null;
  providers: ProviderHealthResult | null;
  caches: CacheProbeResult | null;
};

const HEALTH_RANK: Record<OpsHealth, number> = { healthy: 0, unknown: 1, degraded: 2, down: 3 };

/** Worst-of the component verdicts — a single "down" pulls the whole overview down. */
export function combineOpsHealth(parts: Array<OpsHealth | undefined>): OpsHealth {
  const present = parts.filter((p): p is OpsHealth => p != null);
  if (present.length === 0) return "unknown";
  return present.reduce((worst, cur) => (HEALTH_RANK[cur] > HEALTH_RANK[worst] ? cur : worst), "healthy");
}

// ---------------------------------------------------------------------------
// Rendering — member badge vs admin breakdown
// ---------------------------------------------------------------------------

const HEALTH_ICON: Record<OpsHealth, string> = { healthy: "✅", degraded: "⚠️", down: "🔴", unknown: "·" };

/** The clean, no-internal-detail member badge for a verdict. Never names a cron/provider/cache. */
function memberBadge(overall: OpsHealth): string {
  switch (overall) {
    case "healthy":
      return "All BlackOut systems are operating normally.";
    case "degraded":
      return "Some background data jobs are catching up — a few numbers may be briefly delayed. The team is aware.";
    case "down":
      return "A data service is having trouble right now, so some numbers may be unavailable. The team has been alerted.";
    case "unknown":
      return "I can't confirm full system health right now.";
  }
}

function fmtAge(min: number | null): string {
  if (min == null) return "no recorded run";
  if (min < 1) return "<1m ago";
  if (min < 60) return `${Math.round(min)}m ago`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h}h ${m}m ago` : `${h}h ago`;
}

export function renderCronRuns(res: CronRunsResult, audience: OpsAudience): string {
  if (audience === "member") return memberBadge(res.overall);
  if (!res.available) return `**Cron health** — ${res.note ?? "unavailable."}`;

  const lines: string[] = [
    `**Cron health** ${HEALTH_ICON[res.overall]}`,
    "",
    `${res.total} registered · ${res.healthy} healthy · ${res.stale} stale · ${res.failed} failed${res.never_ran ? ` · ${res.never_ran} never ran` : ""}`,
  ];
  if (res.note) lines.push("", `_${res.note}_`);

  // Surface the ones that need attention first; then a compact all-clear if none.
  const attention = res.jobs.filter((j) => j.status !== "healthy");
  lines.push("");
  if (attention.length === 0) {
    lines.push("All registered crons are healthy.");
  } else {
    lines.push("**Needs attention:**");
    for (const j of attention) {
      const when = j.never_ran ? "no recorded run" : `last ${fmtAge(j.age_min)}`;
      const why = j.failed ? "FAILED" : j.stale ? "STALE" : j.never_ran ? "NEVER RAN" : j.status.toUpperCase();
      const msg = j.failed && j.last_message ? ` — ${j.last_message}` : "";
      lines.push(`- ${HEALTH_ICON[j.status]} ${j.name} (\`${j.key}\`): ${why} · ${when} · ${j.schedule_label}${msg}`);
    }
  }
  lines.push("", "_Grounded in the cron_job_runs log via admin-cron-health — real last-run status, no fabricated times._");
  return lines.join("\n");
}

export function renderProviderHealth(res: ProviderHealthResult, audience: OpsAudience): string {
  if (audience === "member") return memberBadge(res.overall);
  const lines: string[] = [`**Provider reachability** ${HEALTH_ICON[res.overall]}`, ""];
  for (const p of res.providers) {
    const icon = p.status === "up" ? "✅" : p.status === "down" ? "🔴" : "·";
    const lat = p.latencyMs != null ? ` · ${p.latencyMs}ms` : "";
    lines.push(`- ${icon} ${p.label}: ${p.detail}${lat}`);
  }
  lines.push("", "_Live reachability probe (short timeout). Keys and endpoints are never shown — raw errors are logged server-side only._");
  return lines.join("\n");
}

export function renderCacheProbe(res: CacheProbeResult, audience: OpsAudience): string {
  if (audience === "member") return memberBadge(res.overall);
  const lines: string[] = [`**Cache freshness** ${HEALTH_ICON[res.overall]}`, ""];
  for (const c of res.caches) {
    lines.push(`- ${HEALTH_ICON[c.status]} ${c.label}: ${c.detail}`);
  }
  if (!res.isRth) lines.push("", "_Market is closed — several caches idle off-hours by design; that's expected, not a fault._");
  lines.push("", "_Freshness from live cache reads (present? age vs its refresh window). No fabricated ages._");
  return lines.join("\n");
}

export function renderOpsOverview(res: OpsOverviewResult, audience: OpsAudience): string {
  if (audience === "member") return memberBadge(res.overall);
  const blocks: string[] = [`**Ops overview** ${HEALTH_ICON[res.overall]}`, ""];
  if (res.providers) blocks.push(renderProviderHealth(res.providers, "admin"), "");
  if (res.crons) blocks.push(renderCronRuns(res.crons, "admin"), "");
  if (res.caches) blocks.push(renderCacheProbe(res.caches, "admin"), "");
  return blocks.join("\n").trimEnd();
}

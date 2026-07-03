"use client";

import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";

type BieReportPayload = {
  available: boolean;
  reason?: string;
  as_of?: string;
  embeddings?: {
    configured: boolean;
    probe: { ok: true; dims: number } | { ok: false; error: string };
    retrieval_probe: Array<{ source: string; kind: string; similarity: number }>;
  };
  knowledge?: {
    total: number;
    embedded: number;
    by_kind: Array<{ kind: string; total: number; embedded: number }>;
    newest_at: string | null;
  } | null;
  db_pool?: { configured: boolean; total: number; idle: number; waiting: number } | null;
  redis?:
    | { configured: false }
    | { configured: true; connected: false; error: string }
    | { configured: true; connected: true; used_memory_mb: number; connected_clients: number; uptime_hours: number; keys: number };
  self_eval?: { text: string } | null;
  calibration?: { text: string } | null;
  discovery?: { text: string } | null;
  interactions_24h?: {
    total: number;
    routed: number;
    claude: number;
    avg_latency_router_ms: number | null;
    avg_latency_claude_ms: number | null;
  } | null;
  report_trail?: Array<{ source: string; at: string; preview: string }>;
};

function fmtEt(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ReportBlock({ title, text }: { title: string; text: string | null | undefined }) {
  if (!text) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-black/25">
      <p className="border-b border-white/10 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-sky-200">
        {title}
      </p>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-[11px] leading-relaxed text-white/75">
        {text}
      </pre>
    </div>
  );
}

/** Live self-report of the BLACKOUT Intelligence Engine: what it answered
 *  without Claude, what it verified, what it recommends changing, and what it
 *  knows — recomputed on demand from /api/admin/bie-report. */
export function AdminBiePanel() {
  const [data, setData] = useState<BieReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trailOpen, setTrailOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/bie-report", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as BieReportPayload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const emb = data?.embeddings;
  const know = data?.knowledge;
  const inter = data?.interactions_24h;
  const pool = data?.db_pool;
  const redis = data?.redis;
  const coverage =
    inter && inter.total > 0 ? Math.round((inter.routed / inter.total) * 1000) / 10 : null;

  return (
    <section
      className="admin-glass admin-deck-panel admin-glass-shimmer admin-glass-violet mb-6"
      aria-labelledby="admin-bie-heading"
    >
      <div className="admin-glass" aria-hidden />
      <p className="admin-deck-kicker">BLACKOUT Intelligence · Layer 5 self-report</p>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="admin-bie-heading" className="admin-glass-title admin-deck-title">
            Intelligence Engine
          </h2>
          <p className="mt-1 max-w-2xl font-mono text-[11px] leading-relaxed text-cyan">
            What the engine answered without Claude, what it verified, what its calibration
            harness recommends, and what its own telemetry found — recomputed live, not the
            cached daily tick.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="font-mono text-[10px] uppercase tracking-widest text-white/40">Router coverage 24h</p>
            <p className="font-syne text-2xl font-bold text-white">
              {coverage != null ? `${coverage}%` : "—"}
              {inter ? (
                <span className="ml-2 align-middle font-mono text-[10px] font-normal text-white/40">
                  {inter.routed}/{inter.total} turns
                </span>
              ) : null}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded border border-white/15 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-sky-200 transition-colors hover:border-sky-200/40 disabled:opacity-40"
          >
            {loading ? "Computing…" : "Recompute"}
          </button>
        </div>
      </div>

      <div className="admin-glass-body mt-4 space-y-4">
        {error ? (
          <p className="font-mono text-[11px] text-bear">Report failed: {error}</p>
        ) : data && !data.available ? (
          <p className="font-mono text-[11px] text-gold">{data.reason ?? "unavailable"}</p>
        ) : null}

        {/* Status chips: memory + retrieval health at a glance. */}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <div
            className={clsx(
              "rounded-lg border px-3 py-2 font-mono text-[11px]",
              emb?.probe.ok ? "border-bull/25 bg-bull/5" : "border-gold/25 bg-gold/5"
            )}
          >
            <p className="text-[10px] uppercase tracking-widest text-white/40">Embeddings (Voyage)</p>
            <p className={clsx("font-semibold", emb?.probe.ok ? "text-bull" : "text-gold")}>
              {emb == null
                ? "—"
                : emb.probe.ok
                  ? `LIVE · ${emb.probe.dims}-dim`
                  : emb.configured
                    ? `key set — ${emb.probe.error}`
                    : "awaiting VOYAGE_API_KEY"}
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 font-mono text-[11px]">
            <p className="text-[10px] uppercase tracking-widest text-white/40">Knowledge corpus</p>
            <p className="text-sky-200">
              {know ? (
                <>
                  <span className="font-semibold">{know.total}</span> chunks ·{" "}
                  <span className={clsx("font-semibold", know.embedded > 0 ? "text-bull" : "text-gold")}>
                    {know.embedded}
                  </span>{" "}
                  retrievable
                </>
              ) : (
                "—"
              )}
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 font-mono text-[11px]">
            <p className="text-[10px] uppercase tracking-widest text-white/40">Largo turns 24h</p>
            <p className="text-sky-200">
              {inter ? (
                <>
                  <span className="font-semibold text-bull">{inter.routed}</span> engine ·{" "}
                  <span className="font-semibold">{inter.claude}</span> Claude
                </>
              ) : (
                "—"
              )}
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 font-mono text-[11px]">
            <p className="text-[10px] uppercase tracking-widest text-white/40">Answer latency</p>
            <p className="text-sky-200">
              {inter?.avg_latency_router_ms != null ? `${Math.round(inter.avg_latency_router_ms)}ms` : "—"} vs{" "}
              {inter?.avg_latency_claude_ms != null ? `${Math.round(inter.avg_latency_claude_ms)}ms` : "—"}
              <span className="ml-1 text-white/40">Claude</span>
            </p>
          </div>
          <div
            className={clsx(
              "rounded-lg border px-3 py-2 font-mono text-[11px]",
              pool && pool.waiting > 0 ? "border-gold/25 bg-gold/5" : "border-white/10 bg-black/20"
            )}
          >
            <p className="text-[10px] uppercase tracking-widest text-white/40">DB pool (live)</p>
            <p className={clsx(pool && pool.waiting > 0 ? "text-gold" : "text-sky-200")}>
              {pool ? (
                <>
                  <span className="font-semibold">{pool.total}</span> total ·{" "}
                  <span className="font-semibold">{pool.idle}</span> idle
                  {pool.waiting > 0 ? (
                    <>
                      {" "}
                      · <span className="font-semibold text-gold">{pool.waiting} waiting</span>
                    </>
                  ) : null}
                </>
              ) : (
                "—"
              )}
            </p>
          </div>
          <div
            className={clsx(
              "rounded-lg border px-3 py-2 font-mono text-[11px]",
              redis?.configured && !redis.connected ? "border-gold/25 bg-gold/5" : "border-white/10 bg-black/20"
            )}
          >
            <p className="text-[10px] uppercase tracking-widest text-white/40">Redis (live)</p>
            <p className={clsx(redis?.configured && !redis.connected ? "text-gold" : "text-sky-200")}>
              {!redis || !redis.configured
                ? "not configured"
                : !redis.connected
                  ? `unreachable — ${redis.error}`
                  : `${redis.used_memory_mb}MB · ${redis.keys} keys · ${redis.connected_clients} clients`}
            </p>
          </div>
        </div>

        {/* What the engine's memory returns when asked — proof retrieval works. */}
        {emb && emb.retrieval_probe.length > 0 ? (
          <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 font-mono text-[11px]">
            <p className="text-[10px] uppercase tracking-widest text-white/40">
              Retrieval probe · &ldquo;How are 0DTE Command plays graded?&rdquo;
            </p>
            <ul className="mt-1 space-y-0.5">
              {emb.retrieval_probe.map((r) => (
                <li key={`${r.source}-${r.similarity}`} className="text-white/70">
                  <span className="text-bull">{r.similarity}</span>{" "}
                  <span className="text-sky-200">{r.source}</span>{" "}
                  <span className="text-white/40">({r.kind})</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="grid gap-3 lg:grid-cols-2">
          <ReportBlock title="Daily self-evaluation" text={data?.self_eval?.text} />
          <ReportBlock title="Gate calibration · 14 sessions" text={data?.calibration?.text} />
        </div>
        <ReportBlock title="Platform discovery · what its own telemetry found" text={data?.discovery?.text} />

        {/* Corpus census + improvement trail. */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[10px] text-white/35">
            {know?.by_kind.length
              ? know.by_kind.map((k) => `${k.kind} ${k.embedded}/${k.total}`).join(" · ")
              : loading
                ? "Computing reports…"
                : null}
            {know?.newest_at ? ` · newest ${fmtEt(know.newest_at)} ET` : null}
          </p>
          {data?.report_trail?.length ? (
            <button
              type="button"
              onClick={() => setTrailOpen((v) => !v)}
              className="font-mono text-[10px] uppercase tracking-widest text-white/40 underline-offset-2 hover:text-sky-200 hover:underline"
            >
              {trailOpen ? "Hide" : "Show"} improvement trail ({data.report_trail.length})
            </button>
          ) : null}
        </div>
        {trailOpen && data?.report_trail?.length ? (
          <ul className="space-y-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
            {data.report_trail.map((r) => (
              <li key={`${r.source}-${r.at}`} className="font-mono text-[10px] text-white/50">
                <span className="text-sky-200">{r.source}</span>
                <span className="text-white/30"> · {fmtEt(r.at)} ET — </span>
                {r.preview}
              </li>
            ))}
          </ul>
        ) : null}

        <p className="font-mono text-[10px] text-white/35">
          Report-first by design: calibration recommendations cite their evidence and a human
          ships the change — the engine never silently retunes its own gates.
        </p>
      </div>
    </section>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { entryRangeMid } from "@/features/nighthawk/lib/entry-range";

type SpxPlayRow = {
  id: number;
  session_date: string;
  direction: string;
  grade: string;
  entry_price: number;
  exit_price: number | null;
  pnl_pts: number | null;
  outcome: "win" | "loss" | "breakeven" | "open";
  exit_action: string | null;
  closed_at: string | null;
};

type NHPlayRow = {
  id: number;
  edition_for: string;
  ticker: string;
  direction: "LONG" | "SHORT";
  conviction: string;
  outcome: "target" | "stop" | "open" | "ambiguous" | "unfilled";
  entry_range_low: number | null;
  entry_range_high: number | null;
  target: number | null;
  stop: number | null;
  next_day_close: number | null;
};

type PlaysPayload = {
  available: boolean;
  spx?: SpxPlayRow[];
  nighthawk?: NHPlayRow[];
};

type Tab = "spx" | "nighthawk";

function outcomeLabel(o: string): { text: string; cls: string } {
  switch (o) {
    case "win":    return { text: "W", cls: "text-bull" };
    case "target": return { text: "W", cls: "text-bull" };
    case "loss":   return { text: "L", cls: "text-bear" };
    case "stop":   return { text: "L", cls: "text-bear" };
    case "ambiguous": return { text: "—", cls: "text-sky-300/50" };
    case "breakeven": return { text: "BE", cls: "text-sky-300" };
    // Session never traded back into the entry band — no fill existed, so no W/L.
    case "unfilled": return { text: "UNF", cls: "text-sky-300/50" };
    default: return { text: "—", cls: "text-sky-300/50" };
  }
}

function pnlClass(pnl: number | null): string {
  if (pnl == null) return "text-sky-300/50";
  return pnl > 0 ? "text-bull" : pnl < 0 ? "text-bear" : "text-sky-300";
}

function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

function SpxTable({ rows }: { rows: SpxPlayRow[] }) {
  if (!rows.length) return (
    <p className="py-6 text-center font-mono text-xs text-sky-300/50">No closed plays yet</p>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] font-mono text-[11px]">
        <thead>
          <tr className="border-b border-white/8 text-[10px] uppercase tracking-[0.14em] text-sky-300/50">
            <th className="pb-2 pr-4 text-left">Date</th>
            <th className="pb-2 pr-4 text-left">Dir</th>
            <th className="pb-2 pr-4 text-left">Grade</th>
            <th className="pb-2 pr-4 text-right">Entry</th>
            <th className="pb-2 pr-4 text-right">Exit</th>
            <th className="pb-2 pr-4 text-right">P&L pts</th>
            <th className="pb-2 text-center">W/L</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.04]">
          {rows.map((r) => {
            const { text, cls } = outcomeLabel(r.outcome);
            return (
              <tr key={r.id} className="group">
                <td className="py-1.5 pr-4 text-sky-300/70">{fmtDate(r.session_date)}</td>
                <td className={`py-1.5 pr-4 ${r.direction === "LONG" || r.direction === "BUY" ? "text-bull" : "text-bear"}`}>
                  {String(r.direction).slice(0, 1)}
                </td>
                <td className="py-1.5 pr-4 text-sky-300">{r.grade}</td>
                <td className="py-1.5 pr-4 text-right text-sky-300">{r.entry_price.toFixed(2)}</td>
                <td className="py-1.5 pr-4 text-right text-sky-300/70">
                  {r.exit_price != null ? r.exit_price.toFixed(2) : "—"}
                </td>
                <td className={`py-1.5 pr-4 text-right ${pnlClass(r.pnl_pts)}`}>
                  {r.pnl_pts != null ? (r.pnl_pts > 0 ? "+" : "") + r.pnl_pts.toFixed(1) : "—"}
                </td>
                <td className={`py-1.5 text-center font-semibold ${cls}`}>{text}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function NHTable({ rows }: { rows: NHPlayRow[] }) {
  if (!rows.length) return (
    <p className="py-6 text-center font-mono text-xs text-sky-300/50">No resolved setups yet</p>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] font-mono text-[11px]">
        <thead>
          <tr className="border-b border-white/8 text-[10px] uppercase tracking-[0.14em] text-sky-300/50">
            <th className="pb-2 pr-4 text-left">Date</th>
            <th className="pb-2 pr-4 text-left">Ticker</th>
            <th className="pb-2 pr-4 text-left">Dir</th>
            <th className="pb-2 pr-4 text-left">Conv.</th>
            <th className="pb-2 pr-4 text-right">Entry mid</th>
            <th className="pb-2 pr-4 text-right">Close</th>
            <th className="pb-2 text-center">W/L</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.04]">
          {rows.map((r) => {
            const { text, cls } = outcomeLabel(r.outcome);
            const mid = entryRangeMid(r.entry_range_low, r.entry_range_high);
            const entryMid = mid != null ? mid.toFixed(2) : "—";
            return (
              <tr key={r.id}>
                <td className="py-1.5 pr-4 text-sky-300/70">{fmtDate(r.edition_for)}</td>
                <td className="py-1.5 pr-4 text-white">{r.ticker}</td>
                <td className={`py-1.5 pr-4 ${r.direction === "LONG" ? "text-bull" : "text-bear"}`}>
                  {r.direction === "LONG" ? "L" : "S"}
                </td>
                <td className="py-1.5 pr-4 text-sky-300">{r.conviction}</td>
                <td className="py-1.5 pr-4 text-right text-sky-300">{entryMid}</td>
                <td className="py-1.5 pr-4 text-right text-sky-300/70">
                  {r.next_day_close != null ? r.next_day_close.toFixed(2) : "—"}
                </td>
                <td className={`py-1.5 text-center font-semibold ${cls}`}>{text}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function PlayHistoryTable() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("spx");
  const [data, setData] = useState<PlaysPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const loadedRef = useRef(false);

  const load = useCallback(async () => {
    if (loadedRef.current || loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/track-record/plays", { cache: "no-store" });
      if (res.ok) {
        const json: PlaysPayload = await res.json();
        setData(json);
        loadedRef.current = true;
      }
    } catch { /* best-effort */ }
    finally { setLoading(false); }
  }, [loading]);

  useEffect(() => {
    if (open && !loadedRef.current) void load();
  }, [open, load]);

  const spxRows = data?.spx ?? [];
  const nhRows = data?.nighthawk ?? [];

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#050608]/60 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-white/[0.03]"
        aria-expanded={open}
      >
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-sky-300/60">Audit trail</p>
          <p className="mt-0.5 text-sm text-white">Per-play history</p>
        </div>
        <span className={`font-mono text-[10px] text-sky-300/50 transition-transform duration-200 ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>

      {open && (
        <div className="border-t border-white/[0.06] px-5 pb-5 pt-4">
          <div className="mb-4 flex gap-3">
            {(["spx", "nighthawk"] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={[
                  "rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors",
                  tab === t
                    ? "bg-sky-300/10 text-sky-300"
                    : "text-sky-300/40 hover:text-sky-300/70",
                ].join(" ")}
              >
                {t === "spx" ? `SPX Slayer (${spxRows.length})` : `Night Hawk (${nhRows.length})`}
              </button>
            ))}
          </div>

          {loading && (
            <p className="py-4 text-center font-mono text-[11px] text-sky-300/50">Loading…</p>
          )}

          {!loading && data?.available === false && (
            <p className="py-4 text-center font-mono text-[11px] text-sky-300/50">
              History unavailable
            </p>
          )}

          {!loading && data?.available !== false && tab === "spx" && <SpxTable rows={spxRows} />}
          {!loading && data?.available !== false && tab === "nighthawk" && <NHTable rows={nhRows} />}

          <p className="mt-4 font-mono text-[9px] leading-relaxed text-sky-300/30">
            Night Hawk returns are next-day underlying stock price movement from the published entry range
            midpoint — not option-premium P&L. Actual option returns depend on strike, expiry, and IV at entry.
          </p>
        </div>
      )}
    </div>
  );
}

import type { FlowAlert } from "@/lib/api";
import { fmtPremium } from "@/lib/api";

export type HelixFlowSortKey =
  | "time"
  | "ticker"
  | "premium"
  | "strike"
  | "score"
  | "dte"
  | "expiry";

export type HelixFlowSortDir = "asc" | "desc";

export function flowTimeMs(flow: FlowAlert): number | null {
  if (!flow.alerted_at) return null;
  const ms = new Date(flow.alerted_at).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function timeAgo(iso: string): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diff = Date.now() - t;
  if (diff < 0) return "0s";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * Absolute print timestamp for the tape's TIME column — `"MM/DD/YYYY - HH:MM"` in **US Eastern**,
 * 24-hour, zero-padded (e.g. `"07/15/2026 - 11:45"`). The options tape is an ET tape (the column
 * hint already reads "ET"), so we format the instant in `America/New_York` regardless of the
 * runtime's own zone. Replaces the old relative `timeAgo()` in the tape so members read the exact
 * fill time, not a fuzzy age. Returns `"—"` for empty/invalid input.
 *
 * WHY formatToParts (not toLocaleString): en-US `toLocaleString` yields `"07/15/2026, 11:45"` — the
 * comma + no dash separator and locale-dependent ordering would need brittle string surgery to reach
 * the exact `MM/DD/YYYY - HH:MM`. Assembling from parts gives us the format verbatim and stable.
 */
export function fmtFullTimestamp(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const mm = get("month");
  const dd = get("day");
  const yyyy = get("year");
  // Some engines emit hourCycle "24" (a literal "24" at midnight) under hour12:false — normalize.
  let hh = get("hour");
  if (hh === "24") hh = "00";
  const min = get("minute");
  if (!mm || !dd || !yyyy || !hh || !min) return "—";
  return `${mm}/${dd}/${yyyy} - ${hh}:${min}`;
}

export function fmtExpiryShort(expiry: string): string {
  if (!expiry) return "—";
  const [y, m, d] = expiry.split("-");
  if (!y || !m || !d) return expiry;
  return `${m}/${d}/${y.slice(2)}`;
}

export function daysToExpiry(expiry: string, now: Date = new Date()): number {
  const todayEt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
  const todayMs = Date.parse(`${todayEt}T00:00:00Z`);
  const expMs = Date.parse(`${expiry.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(todayMs) || !Number.isFinite(expMs)) return 0;
  return Math.max(0, Math.round((expMs - todayMs) / 86_400_000));
}

export function ruleLabel(rule: string): string {
  const r = rule.toLowerCase();
  if (r.includes("repeated")) return "REPEAT";
  if (r.includes("sweep")) return "SWEEP";
  if (r.includes("floor")) return "FLOOR";
  if (r.includes("grenade")) return "GRENADE";
  if (r.includes("block")) return "BLOCK";
  return rule.toUpperCase().slice(0, 8);
}

/** UW execution route (SWEEP/BLOCK/…) from alert_rule — NOT internal route (whale/0dte/stock). */
export function executionRouteKey(alert: Pick<FlowAlert, "alert_rule">): string {
  const rule = (alert.alert_rule || "").toUpperCase();
  const keys = ["SWEEP", "BLOCK", "SPLIT", "CROSS", "FLOOR", "MULTI"] as const;
  for (const k of keys) {
    if (rule.includes(k)) return k;
  }
  return "OTHER";
}

export function fmtSpot(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtFill(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 100) return n.toFixed(1);
  return n.toFixed(2);
}

export function fmtOi(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

export function fmtIv(iv: number | null | undefined): string {
  if (iv == null || !Number.isFinite(iv) || iv <= 0) return "—";
  if (iv < 3) return `${(iv * 100).toFixed(0)}%`;
  return `${iv.toFixed(0)}%`;
}

export function fmtOtm(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  if (pct < 0) return `${Math.abs(pct).toFixed(1)}% ITM`;
  return `${pct.toFixed(1)}%`;
}

export function fmtAskPct(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct) || pct <= 0) return "—";
  return `${Math.round(pct)}%`;
}

export function sortFlows(
  rows: FlowAlert[],
  key: HelixFlowSortKey,
  dir: HelixFlowSortDir
): FlowAlert[] {
  const mul = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const cmp = (x: number, y: number) => (x === y ? 0 : x < y ? -1 : 1);
    switch (key) {
      case "time": {
        const am = flowTimeMs(a);
        const bm = flowTimeMs(b);
        if (am == null && bm == null) return 0;
        if (am == null) return 1;
        if (bm == null) return -1;
        return cmp(am, bm) * mul;
      }
      case "ticker":
        return a.ticker.localeCompare(b.ticker) * mul;
      case "premium":
        return cmp(a.premium ?? 0, b.premium ?? 0) * mul;
      case "strike":
        return cmp(a.strike ?? 0, b.strike ?? 0) * mul;
      case "score":
        return cmp(a.score ?? 0, b.score ?? 0) * mul;
      case "dte": {
        const ad = a.dte ?? daysToExpiry(a.expiry);
        const bd = b.dte ?? daysToExpiry(b.expiry);
        return cmp(ad, bd) * mul;
      }
      case "expiry":
        return a.expiry.localeCompare(b.expiry) * mul;
      default:
        return 0;
    }
  });
}

export type HelixFlowSignal = { id: string; label: string; tone: "bull" | "bear" | "gold" | "sky" | "purple" | "ember" };

export function flowSignals(flow: FlowAlert, ctx: {
  isWhale?: boolean;
  isCompound?: boolean;
  is0dte?: boolean;
  hasSplit?: boolean;
  hasVelocity?: boolean;
  hasCoord?: boolean;
  isHawk?: boolean;
  earnIn?: number | null;
}): HelixFlowSignal[] {
  const out: HelixFlowSignal[] = [];
  if (ctx.isCompound) out.push({ id: "stack", label: "STACK", tone: "gold" });
  if (ctx.isWhale) out.push({ id: "whale", label: "WHALE", tone: "purple" });
  if (flow.alert_rule) out.push({ id: "rule", label: ruleLabel(flow.alert_rule), tone: "sky" });
  if (ctx.is0dte) out.push({ id: "0dte", label: "0DTE", tone: "ember" });
  if (ctx.hasSplit) out.push({ id: "split", label: "SPLIT", tone: "gold" });
  if (ctx.hasVelocity) out.push({ id: "vel", label: "VEL", tone: "ember" });
  if (ctx.hasCoord) out.push({ id: "coord", label: "COORD", tone: "sky" });
  if (ctx.isHawk) out.push({ id: "hawk", label: "HAWK", tone: "sky" });
  if (flow.gex_proximity === "at_gamma_flip") out.push({ id: "flip", label: "FLIP", tone: "purple" });
  if (flow.gex_proximity === "at_call_wall") out.push({ id: "cwall", label: "C WALL", tone: "bull" });
  if (flow.gex_proximity === "at_put_wall") out.push({ id: "pwall", label: "P WALL", tone: "bear" });
  if (flow.gex_proximity === "near_call_wall") out.push({ id: "ncwall", label: "≈C WALL", tone: "bull" });
  if (flow.gex_proximity === "near_put_wall") out.push({ id: "npwall", label: "≈P WALL", tone: "bear" });
  if (ctx.earnIn != null && ctx.earnIn <= 5) {
    out.push({ id: "earn", label: ctx.earnIn === 0 ? "EARN" : `E${ctx.earnIn}D`, tone: "bear" });
  }
  return out;
}

export function premiumDisplay(flow: FlowAlert): string {
  return fmtPremium(flow.premium);
}

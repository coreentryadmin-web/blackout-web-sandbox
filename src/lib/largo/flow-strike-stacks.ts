/** UW Repeated Hits + same-strike accumulation — server-side, fed to Largo before Claude writes. */

export type FlowAlertForStack = {
  ticker: string;
  strike: number;
  option_type: string;
  expiry: string;
  premium: number;
  alerted_at: string;
  alert_rule: string | null;
  trade_count: number | null;
};

export type FlowStrikeStack = {
  ticker: string;
  strike: number;
  option_type: string;
  expiry: string;
  alert_count: number;
  total_premium: number;
  premiums: number[];
  trade_count: number | null;
  repeated_hits: boolean;
  same_strike_accumulation: boolean;
  alert_rules: string[];
  kind: "repeated_hits" | "same_strike_stack" | "repeated_and_stacked";
};

const REPEATED_HIT_RULES = new Set([
  "RepeatedHits",
  "RepeatedHitsAscendingFill",
  "RepeatedHitsDescendingFill",
]);

export function isUwRepeatedHitsRule(rule: string | null | undefined): boolean {
  if (!rule) return false;
  if (REPEATED_HIT_RULES.has(rule)) return true;
  return rule.startsWith("RepeatedHits");
}

// Bug 6: normalize expiry to YYYY-MM-DD regardless of input format so stackKey is consistent
function normalizeExpiry(raw: string): string {
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const usLong = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (usLong) return `${usLong[3]}-${usLong[1].padStart(2, "0")}-${usLong[2].padStart(2, "0")}`;
  const usShort = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (usShort) return `20${usShort[3]}-${usShort[1].padStart(2, "0")}-${usShort[2].padStart(2, "0")}`;
  return raw.slice(0, 10);
}

export function normalizeFlowAlertForStack(item: unknown): FlowAlertForStack | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;

  const strike = Number(o.strike ?? o.strike_price ?? 0);
  const premium = Number(o.premium ?? o.total_premium ?? 0);
  if (!Number.isFinite(strike) || strike <= 0) return null;
  if (!Number.isFinite(premium) || premium <= 0) return null;

  // Parser-truth (gap #6): a typeless print must DROP, not default to CALL — defaulting
  // mis-stacked UNKNOWN prints onto the CALL side of STRIKE STACKS / NET PREMIUM. Take the
  // raw type only; if it doesn't resolve to a real call/put, return null and skip the row.
  const opt = String(o.option_type ?? o.type ?? o.side ?? o.put_call ?? "").toUpperCase();
  if (!opt.startsWith("C") && !opt.startsWith("P")) return null;
  const option_type = opt.startsWith("P") ? "PUT" : "CALL";

  let alerted_at = String(o.alerted_at ?? o.created_at ?? o.time ?? "");
  if (!alerted_at && o.start_time) {
    const ts = Number(o.start_time);
    if (Number.isFinite(ts)) alerted_at = new Date(ts > 1e12 ? ts : ts * 1000).toISOString();
  }

  const ruleRaw = String(o.alert_rule ?? o.rule_name ?? "").trim();
  const tradeRaw = Number(o.trade_count ?? 0);

  return {
    ticker: String(o.ticker ?? o.symbol ?? "").toUpperCase(),
    strike,
    option_type,
    expiry: normalizeExpiry(String(o.expiry ?? o.expiration ?? "")),
    premium,
    alerted_at,
    alert_rule: ruleRaw || null,
    trade_count: Number.isFinite(tradeRaw) && tradeRaw > 0 ? tradeRaw : null,
  };
}

function stackKey(a: FlowAlertForStack): string {
  return `${a.ticker}|${a.strike}|${a.option_type}|${a.expiry}`;
}

export function computeFlowStrikeStacks(
  alerts: unknown[],
  opts?: { minAlerts?: number; limit?: number }
): FlowStrikeStack[] {
  const minAlerts = opts?.minAlerts ?? 2;
  const limit = opts?.limit ?? 10;
  // Bug 9: cap input to recent 500 alerts — beyond that stacks are stale anyway
  const input = alerts.length > 500 ? alerts.slice(0, 500) : alerts;
  const groups = new Map<string, FlowAlertForStack[]>();

  for (const raw of input) {
    const row = normalizeFlowAlertForStack(raw);
    if (!row) continue;
    const key = stackKey(row);
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  const stacks: FlowStrikeStack[] = [];

  for (const rows of Array.from(groups.values())) {
    const sorted = [...rows].sort(
      (a, b) => new Date(b.alerted_at || 0).getTime() - new Date(a.alerted_at || 0).getTime()
    );
    const premiums = sorted.map((r) => r.premium);
    const alert_rules = Array.from(
      new Set(sorted.map((r) => r.alert_rule).filter((r): r is string => Boolean(r)))
    );
    const repeated_hits = sorted.some(
      (r) => isUwRepeatedHitsRule(r.alert_rule) || (r.trade_count != null && r.trade_count >= 5)
    );
    const same_strike_accumulation = sorted.length >= minAlerts;
    if (!repeated_hits && !same_strike_accumulation) continue;

    const tradeSum = sorted.reduce((s, r) => s + (r.trade_count ?? 0), 0);
    const kind: FlowStrikeStack["kind"] =
      repeated_hits && same_strike_accumulation
        ? "repeated_and_stacked"
        : repeated_hits
          ? "repeated_hits"
          : "same_strike_stack";

    stacks.push({
      ticker: sorted[0].ticker,
      strike: sorted[0].strike,
      option_type: sorted[0].option_type,
      expiry: sorted[0].expiry,
      alert_count: sorted.length,
      total_premium: premiums.reduce((s, p) => s + p, 0),
      premiums,
      trade_count: tradeSum > 0 ? tradeSum : null,
      repeated_hits,
      same_strike_accumulation,
      alert_rules,
      kind,
    });
  }

  return stacks.sort((a, b) => b.total_premium - a.total_premium).slice(0, limit);
}

export function fmtFlowPremShort(n: number): string {
  if (!Number.isFinite(n)) return "—";
  // Sign OUTSIDE the currency glyph so negatives read "-$1.2M", never "$-1.2M"
  // (matches fmtPremium in @/lib/api).
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`.replace(/\.00M$/, "M");
  if (abs >= 10_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${Math.round(abs)}`;
}

export function formatFlowStrikeStackLine(stack: FlowStrikeStack): string {
  const exp = stack.expiry ? ` ${stack.expiry}` : "";
  const premParts = stack.premiums.map(fmtFlowPremShort).join(" + ");
  const rules =
    stack.alert_rules.length > 0
      ? stack.alert_rules.join(", ")
      : stack.repeated_hits
        ? "RepeatedHits (inferred)"
        : "—";
  const trades = stack.trade_count != null ? ` · ${stack.trade_count} UW fills` : "";
  const kind =
    stack.kind === "repeated_and_stacked"
      ? "Repeated Hits + multi-alert stack"
      : stack.kind === "repeated_hits"
        ? "UW Repeated Hits"
        : "Same-strike accumulation";

  return (
    `${stack.ticker} ${stack.option_type} @${stack.strike}${exp} — ` +
    `${stack.alert_count} alert${stack.alert_count === 1 ? "" : "s"} · ` +
    `${fmtFlowPremShort(stack.total_premium)} total (${premParts}) · ` +
    `${kind} · rules: ${rules}${trades}`
  );
}

export function formatFlowStrikeStacksSection(stacks: FlowStrikeStack[]): string[] {
  if (!stacks.length) return [];
  return [
    "**Strike stacks / Repeated Hits (UW — call these out in Flow when relevant):**",
    ...stacks.slice(0, 8).map((s) => `- ${formatFlowStrikeStackLine(s)}`),
  ];
}

export function flowStackSignature(stacks: FlowStrikeStack[] | undefined): string {
  return (stacks ?? [])
    .map(
      (s) =>
        `${s.strike}|${s.option_type}|${s.expiry}|${s.alert_count}|${Math.round(s.total_premium)}`
    )
    .join(";");
}

export function withStrikeStacks<T extends Record<string, unknown>>(
  payload: T,
  alertSources: unknown[][]
): T & { strike_stacks: FlowStrikeStack[] } {
  const strike_stacks = computeFlowStrikeStacks(alertSources.flat());
  return { ...payload, strike_stacks };
}

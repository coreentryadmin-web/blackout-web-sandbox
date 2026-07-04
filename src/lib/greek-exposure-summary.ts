import { todayEt } from "@/lib/et-date";

export type GreekExposureBucket = {
  expiry: string;
  gamma: number;
  pct_of_total: number;
  dte_label: string;
};

export type GreekExposureSummary = {
  buckets: GreekExposureBucket[];
  pinned_expiry: string | null;
  pinned_pct: number | null;
  total_gamma: number;
  headline: string;
};

function num(row: Record<string, unknown>, ...keys: string[]): number {
  for (const k of keys) {
    const v = row[k];
    if (v != null && Number.isFinite(Number(v))) return Number(v);
  }
  return 0;
}

/** Aggregate UW greek-exposure/expiry rows into DTE buckets for desk commentary. */
export function summarizeGreekExposureByExpiry(
  rows: Record<string, unknown>[],
  todayYmd?: string
): GreekExposureSummary | null {
  if (!rows.length) return null;

  const today = todayYmd ?? todayEt();
  const byExpiry = new Map<string, number>();

  for (const r of rows) {
    const exp = String(r.expiry ?? r.expiration ?? r.expire_date ?? "").slice(0, 10);
    if (!exp) continue;
    const net = num(r, "net_gamma", "gamma", "gex", "net_gex");
    const callG = num(r, "call_gex", "call_gamma");
    const putG = num(r, "put_gex", "put_gamma");
    const g = net !== 0 ? Math.abs(net) : Math.abs(callG) + Math.abs(putG);
    if (g <= 0) continue;
    byExpiry.set(exp, (byExpiry.get(exp) ?? 0) + g);
  }

  if (!byExpiry.size) return null;

  const total = Array.from(byExpiry.values()).reduce((s, v) => s + v, 0);
  if (total <= 0) return null;

  const buckets = Array.from(byExpiry.entries())
    .map(([expiry, gamma]) => {
      const pct = (gamma / total) * 100;
      const dte_label = expiry === today ? "0DTE" : expiry;
      return {
        expiry,
        gamma,
        pct_of_total: Number(pct.toFixed(1)),
        dte_label,
      };
    })
    .sort((a, b) => b.gamma - a.gamma);

  const top = buckets[0]!;
  const headline =
    top.expiry === today
      ? `0DTE is ${top.pct_of_total.toFixed(0)}% of dealer gamma today`
      : `${top.dte_label} pins ${top.pct_of_total.toFixed(0)}% of dealer gamma`;

  return {
    buckets: buckets.slice(0, 8),
    pinned_expiry: top.expiry,
    pinned_pct: top.pct_of_total,
    total_gamma: total,
    headline,
  };
}

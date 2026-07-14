/** Parse UW option-contract API rows into HELIX drilldown shapes (live-probed). */

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export type HelixContractFill = {
  time: string;
  premium: number;
  size: number;
  fill: number | null;
  side: string;
  tags: string[];
};

export type HelixContractIntradayBar = {
  time: string;
  volume: number;
  avg_price: number;
  premium: number;
};

export type HelixContractMeta = {
  open_interest: number | null;
  day_volume: number | null;
  underlying_price: number | null;
  iv: number | null;
  delta: number | null;
};

export function parseContractFills(rows: unknown[]): HelixContractFill[] {
  return rows
    .map((raw) => {
      const r = raw as Record<string, unknown>;
      const fill = num(r.price ?? r.fill_price ?? r.avg_fill);
      const tags = Array.isArray(r.tags) ? r.tags.map(String) : [];
      const side =
        tags.find((t) => /ask|bid|mid|sweep|floor/i.test(t)) ??
        String(r.upstream_condition_detail ?? r.side ?? "");
      return {
        time: String(r.executed_at ?? r.created_at ?? ""),
        premium: num(r.premium ?? r.total_premium),
        size: num(r.size ?? r.trade_count),
        fill: fill > 0 ? fill : null,
        side: side.toLowerCase(),
        tags,
      };
    })
    .filter((row) => row.time || row.premium > 0);
}

export function parseContractIntraday(rows: unknown[]): HelixContractIntradayBar[] {
  return rows
    .map((raw) => {
      const r = raw as Record<string, unknown>;
      const volume =
        num(r.volume_mid_side) +
        num(r.volume_ask_side) +
        num(r.volume_bid_side) +
        num(r.volume_no_side) +
        num(r.volume_multi);
      const premium =
        num(r.premium_mid_side) +
        num(r.premium_ask_side) +
        num(r.premium_bid_side) +
        num(r.premium_no_side);
      return {
        time: String(r.start_time ?? r.timestamp ?? ""),
        volume,
        avg_price: num(r.avg_price ?? r.close ?? r.open),
        premium,
      };
    })
    .filter((row) => row.time && (row.volume > 0 || row.avg_price > 0));
}

export function parseContractMeta(rows: unknown[]): HelixContractMeta {
  const r = (rows[0] ?? {}) as Record<string, unknown>;
  const iv = num(r.implied_volatility);
  return {
    open_interest: num(r.open_interest) || null,
    day_volume: num(r.volume) || null,
    underlying_price: num(r.underlying_price) || null,
    iv: iv > 0 ? (iv < 3 ? iv * 100 : iv) : null,
    delta: num(r.delta) || null,
  };
}

/** Bid vs ask share from UW volume-profile price levels. */
export function volumeProfileBidAskPct(profile: unknown): number | null {
  const rows = Array.isArray(profile) ? profile : null;
  if (!rows?.length) return null;
  let ask = 0;
  let bid = 0;
  for (const raw of rows) {
    const r = raw as Record<string, unknown>;
    ask += num(r.ask_vol);
    bid += num(r.bid_vol);
  }
  const total = ask + bid;
  if (total <= 0) return null;
  return Math.round((bid / total) * 1000) / 10;
}

function num(row: Record<string, unknown>, ...keys: string[]): number {
  for (const k of keys) {
    const v = row[k];
    if (v != null && Number.isFinite(Number(v))) return Number(v);
  }
  return 0;
}

export type GroupGreekFlowSummary = {
  group: string;
  net_delta: number;
  net_gamma: number;
  call_delta: number;
  put_delta: number;
  bias: "supportive" | "opposing" | "neutral";
  headline: string;
  row_count: number;
};

/** Aggregate UW group-flow greek-flow rows into macro dealer positioning context. */
export function summarizeGroupGreekFlow(
  group: string,
  rows: Record<string, unknown>[]
): GroupGreekFlowSummary | null {
  if (!rows.length) return null;

  let netDelta = 0;
  let netGamma = 0;
  let callDelta = 0;
  let putDelta = 0;

  for (const r of rows) {
    const rowNetDelta = num(r, "net_delta", "delta", "net_deltas");
    const rowCallDelta = num(r, "call_delta", "call_deltas");
    const rowPutDelta = num(r, "put_delta", "put_deltas");
    const rowNetGamma = num(r, "net_gamma", "gamma", "net_gex", "gex");

    netDelta += rowNetDelta !== 0 ? rowNetDelta : rowCallDelta + rowPutDelta;
    netGamma += rowNetGamma;
    callDelta += rowCallDelta;
    putDelta += rowPutDelta;
  }

  if (netDelta === 0 && netGamma === 0) return null;

  const bias: GroupGreekFlowSummary["bias"] =
    netDelta > 50_000 || netGamma > 0
      ? "supportive"
      : netDelta < -50_000 || netGamma < 0
        ? "opposing"
        : "neutral";

  const groupLabel = group.toUpperCase() === "MAG7" ? "Mag7" : group;
  const deltaM = Math.abs(netDelta) >= 1_000_000 ? `${(netDelta / 1_000_000).toFixed(2)}M` : `${Math.round(netDelta / 1000)}K`;
  const headline =
    bias === "supportive"
      ? `${groupLabel} dealer gamma supportive — net ${deltaM} delta`
      : bias === "opposing"
        ? `${groupLabel} dealer gamma opposing — net ${deltaM} delta`
        : `${groupLabel} dealer greek flow neutral`;

  return {
    group,
    net_delta: netDelta,
    net_gamma: netGamma,
    call_delta: callDelta,
    put_delta: putDelta,
    bias,
    headline,
    row_count: rows.length,
  };
}

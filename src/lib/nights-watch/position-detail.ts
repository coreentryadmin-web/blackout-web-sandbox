// Night's Watch — FULL DECISION INTEL aggregator for ONE saved position.
//
// buildPositionDetail() assembles ALL verified, already-cached cross-tool data for a
// single position's underlying, recomputes the authoritative deterministic verdict from
// the richer context, and produces a plain-English "what to do" + the levels to watch.
// It powers the click→detail modal in the Night's Watch panel.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE SCALING RULE (same contract as enrichment.ts / position-context.ts):
//   This runs ON DEMAND (a detail-view click), NOT on a poll, and EVERY source it
//   touches is a cache READER — O(distinct ticker) upstream cost, never per-user.
//     • Position + valuation  → getEnrichedPositionsForUser (shared chain cache).
//     • GEX / positioning     → getNwTickerGex (cached 180s) OR the SPX desk (shared).
//     • Flows                 → fetchRecentFlows (Postgres, free).
//     • Technicals (UNCACHED) → WRAPPED here in withServerCache("nw:tech:…", 60s).
//     • News      (UNCACHED)  → WRAPPED here in withServerCache("nw:news:…", 120s).
//     • Earnings              → reuse the already-cached get_earnings path
//                               (serverCache("earnings:…")) — never a fresh UW pull.
//     • SPX confluence        → loadMergedSpxDesk (shared) + computeSpxConfluence (pure).
//     • Night Hawk dossier    → fetchStagedDossiers (Postgres, free; omitted if absent).
//   No UW-rate-limited per-ticker endpoint is ever called in this hot path.
//
// HONESTY RULE: LEGIT VERIFIED DATA ONLY. A section with no real data is null/omitted,
// and its dataSources ledger entry is marked ok:false. We never fabricate a number.
// ─────────────────────────────────────────────────────────────────────────────

import { getEnrichedPositionsForUser } from "@/lib/nights-watch/enrichment";
import { getNwTickerGex } from "@/lib/nights-watch/position-context";
import type { PositionContext } from "@/lib/nights-watch/position-context";
import { computeVerdict, type Verdict, type VerdictAction } from "@/lib/nights-watch/verdict";
import type { EnrichedPosition } from "@/lib/nights-watch/valuation";
import { withServerCache, serverCache, TTL } from "@/lib/server-cache";
import { todayEt } from "@/lib/et-date";
import { isSpxTicker } from "@/lib/spx-desk-live";
import { loadMergedSpxDesk } from "@/lib/spx-desk-loader";
import {
  computeSpxConfluence,
  computeSpxTradeSignal,
  type SpxConfluence,
} from "@/lib/spx-signals";
import { fetchPolygonMtfTechnicals, fetchPolygonNews } from "@/lib/providers/polygon-largo";
import { fetchBenzingaEarnings } from "@/lib/providers/polygon";
import { fetchUwEarnings, fetchUwEarningsEstimates } from "@/lib/providers/unusual-whales";
import { fetchRecentFlows, fetchStagedDossiers, type FlowRow } from "@/lib/db";
import { getLatestNightHawkEdition } from "@/lib/platform/nighthawk-service";
import type { GexWall } from "@/lib/providers/gamma-desk";

// ---------------------------------------------------------------------------
// Public shape
// ---------------------------------------------------------------------------

export type PositionDetailSections = {
  positioning: PositioningSection | null;
  flows: FlowsSection | null;
  technicals: TechnicalsSection | null;
  news: NewsItem[] | null;
  catalysts: CatalystsSection | null;
  confluence: ConfluenceSection | null;
  dossier: DossierSection | null;
};

export type PositioningSection = {
  source: PositionContext["source"];
  underlyingPrice: number | null;
  gammaRegime: string | null;
  regime: string | null;
  gammaFlip: number | null;
  maxPain: number | null;
  kingStrike: number | null;
  walls: GexWall[];
};

export type FlowsSection = {
  lean: "bullish" | "bearish" | "mixed" | "neutral";
  callPremium: number;
  putPremium: number;
  count: number;
  sinceHours: number;
  topStrikes: Array<{
    strike: number;
    option_type: string;
    expiry: string;
    premium: number;
    count: number;
  }>;
};

export type TechnicalsSection = {
  trend: "up" | "down" | "sideways" | null;
  trendStack: string;
  price: number | null;
  emas: { ema20: number | null; ema50: number | null; ema200: number | null };
  rsi: { daily: number | null; hourly: number | null; m15: number | null };
  atr14: number | null;
  range_high_20d: number | null;
  range_low_20d: number | null;
  timeframes: {
    daily: { support: number | null; resistance: number | null; vwap: number | null };
    hourly: { support: number | null; resistance: number | null; vwap: number | null };
    m15: { support: number | null; resistance: number | null; vwap: number | null };
  };
  weekly: { support: number | null; resistance: number | null };
  monthly: { support: number | null; resistance: number | null };
  keyLevels: Array<{ kind: "support" | "resistance"; price: number; source: string }>;
};

export type NewsItem = {
  title: string;
  published: string;
  url: string;
  publisher: string;
  sentiment?: string | null;
};

export type CatalystsSection = {
  earningsDate: string | null;
  daysToEarnings: number | null;
  beforeExpiry: boolean | null;
  source: string;
};

export type ConfluenceSection = {
  action: SpxConfluence["action"];
  bias: SpxConfluence["bias"];
  score: number;
  grade: SpxConfluence["grade"];
  headline: string;
  thesis: string;
  agreeing: number;
  conflicts: number;
  entry: number | null;
  stop: number | null;
  target: number | null;
  invalidation: string;
};

export type DossierSection = {
  edition_for: string;
  ticker: string;
  scored: Record<string, unknown> | null;
  dossier: Record<string, unknown>;
};

export type DataSource = {
  key: string;
  label: string;
  provider: string;
  ok: boolean;
  asOf: string | null;
};

export type PositionDetail = {
  position: EnrichedPosition & { verdict: Verdict };
  whatToDo: {
    action: VerdictAction;
    headline: string;
    directive: string;
    levelsToWatch: Array<{ label: string; price: number }>;
  };
  sections: PositionDetailSections;
  dataSources: DataSource[];
  /** Grounded Claude desk narrative (attached by the detail route; null when unavailable/
   *  over-budget/anthropic unconfigured — the UI then falls back to whatToDo). */
  narrative?: string | null;
  as_of: string;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type SettledMtf = Awaited<ReturnType<typeof fetchPolygonMtfTechnicals>> | null;
type SettledNews = Awaited<ReturnType<typeof fetchPolygonNews>> | null;
type EarningsResult = {
  benzinga_news: Awaited<ReturnType<typeof fetchBenzingaEarnings>>;
  unusual_whales: Awaited<ReturnType<typeof fetchUwEarnings>>;
  estimates: Awaited<ReturnType<typeof fetchUwEarningsEstimates>>;
};

function finite(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function settledValue<T>(r: PromiseSettledResult<T>): T | null {
  return r.status === "fulfilled" ? r.value : null;
}

/**
 * Reuse the ALREADY-CACHED get_earnings path verbatim: serverCache("earnings:"+sym,
 * TTL.EARNINGS) over Benzinga (primary) + UW (supplemental). This shares the SAME cache
 * key/window as the Largo get_earnings tool, so the first detail-view OR tool call per
 * ticker per 5-min window pays the upstream and every other read is a free cache hit —
 * never a fresh per-request UW pull. Mirrors run-tool.ts's get_earnings handler exactly.
 */
async function getCachedEarnings(sym: string): Promise<EarningsResult> {
  return serverCache<EarningsResult>(`earnings:${sym}`, TTL.EARNINGS, async () => {
    const benzinga = await fetchBenzingaEarnings(sym, 15);
    const [uw, estimates] = await Promise.all([
      fetchUwEarnings(sym),
      fetchUwEarningsEstimates(sym),
    ]);
    return { benzinga_news: benzinga, unusual_whales: uw, estimates };
  });
}

/**
 * Extract the NEXT (future) structured earnings date from the cached earnings payload.
 * Only the UW earnings rows carry a real machine-readable date (Benzinga is news prose).
 * We scan the known date fields (same names market-wide.ts/dossier.ts use), keep dates
 * that are today-or-later, and return the EARLIEST such date. HONEST: returns null when
 * no structured future date exists (the catalysts section is then omitted, not faked).
 */
function nextEarningsDateFromPayload(payload: EarningsResult | null): string | null {
  if (!payload) return null;
  const rows = Array.isArray(payload.unusual_whales)
    ? (payload.unusual_whales as Array<Record<string, unknown>>)
    : [];
  const today = todayEt();
  let best: string | null = null;
  for (const row of rows) {
    const raw = String(
      row.report_date ??
        row.expected_date ??
        row.earnings_date ??
        row.announce_date ??
        row.date ??
        ""
    ).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) continue;
    if (raw < today) continue; // past report — not a forward catalyst
    if (best == null || raw < best) best = raw;
  }
  return best;
}

/** Calendar days between two YYYY-MM-DD dates (b - a), clamped at >= 0. */
function daysBetween(aYmd: string, bYmd: string): number | null {
  const a = Date.parse(`${aYmd}T00:00:00Z`);
  const b = Date.parse(`${bYmd}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/**
 * Summarize recent flow prints for the ticker into the verdict's `flows` shape +
 * the richer section view (top strikes). PURE over the FlowRow[] already fetched.
 * lean: call vs put premium skew (>1.25x → directional, else mixed; 0 prints → neutral).
 */
function summarizeFlows(rows: FlowRow[]): FlowsSection | null {
  if (!rows.length) return null;
  let callPremium = 0;
  let putPremium = 0;
  for (const r of rows) {
    const isCall = r.option_type.toUpperCase().startsWith("C");
    if (isCall) callPremium += r.premium;
    else putPremium += r.premium;
  }
  let lean: FlowsSection["lean"] = "neutral";
  const total = callPremium + putPremium;
  if (total > 0) {
    if (callPremium >= putPremium * 1.25) lean = "bullish";
    else if (putPremium >= callPremium * 1.25) lean = "bearish";
    else lean = "mixed";
  }

  // Top strikes by total premium — group by (strike, type, expiry).
  const byKey = new Map<
    string,
    { strike: number; option_type: string; expiry: string; premium: number; count: number }
  >();
  for (const r of rows) {
    const key = `${r.strike}|${r.option_type}|${r.expiry}`;
    const cur = byKey.get(key) ?? {
      strike: r.strike,
      option_type: r.option_type,
      expiry: r.expiry,
      premium: 0,
      count: 0,
    };
    cur.premium += r.premium;
    cur.count += 1;
    byKey.set(key, cur);
  }
  const topStrikes = Array.from(byKey.values())
    .sort((a, b) => b.premium - a.premium)
    .slice(0, 6);

  return {
    lean,
    callPremium: Number(callPremium.toFixed(2)),
    putPremium: Number(putPremium.toFixed(2)),
    count: rows.length,
    sinceHours: 48,
    topStrikes,
  };
}

/** Map fetchPolygonMtfTechnicals trend_stack → the verdict's "up"/"down"/"sideways". */
function trendFromStack(stack: string): "up" | "down" | "sideways" | null {
  if (stack === "bullish") return "up";
  if (stack === "bearish") return "down";
  if (stack === "mixed") return "sideways";
  return null;
}

/**
 * Build the verdict's `levels` array (chart support/resistance near spot) from the MTF
 * technicals. We surface the nearest support BELOW spot and nearest resistance ABOVE spot
 * across the daily/weekly/monthly structure + the 20d range — distinct from GEX walls.
 * Returns [] when no usable level/spot exists (the level signal then never fires).
 */
function levelsFromTechnicals(
  mtf: SettledMtf,
  spot: number | null
): Array<{ kind: "support" | "resistance"; price: number; source: string }> {
  if (!mtf || spot == null || !(spot > 0)) return [];
  const candidates: Array<{ kind: "support" | "resistance"; price: number; source: string }> = [];
  const push = (
    kind: "support" | "resistance",
    price: number | null | undefined,
    source: string
  ) => {
    const p = finite(price);
    if (p == null || p <= 0) return;
    if (kind === "support" && p < spot) candidates.push({ kind, price: p, source });
    if (kind === "resistance" && p > spot) candidates.push({ kind, price: p, source });
  };

  push("support", mtf.timeframes?.daily?.support, "daily");
  push("resistance", mtf.timeframes?.daily?.resistance, "daily");
  push("support", mtf.range_low_20d, "20d range");
  push("resistance", mtf.range_high_20d, "20d range");
  push("support", mtf.weekly?.support, "weekly");
  push("resistance", mtf.weekly?.resistance, "weekly");
  push("support", mtf.monthly?.support, "monthly");
  push("resistance", mtf.monthly?.resistance, "monthly");

  const nearest = (kind: "support" | "resistance") =>
    candidates
      .filter((c) => c.kind === kind)
      .reduce<(typeof candidates)[number] | null>(
        (best, c) =>
          best == null || Math.abs(c.price - spot) < Math.abs(best.price - spot) ? c : best,
        null
      );
  const out: typeof candidates = [];
  const sup = nearest("support");
  const res = nearest("resistance");
  if (sup) out.push(sup);
  if (res) out.push(res);
  return out;
}

/** Per-ticker sentiment label from a Polygon news article's insights[], when present. */
function sentimentForTicker(
  insights: Array<{ ticker: string; sentiment: string }>,
  sym: string
): string | null {
  const match = insights.find((i) => i.ticker.toUpperCase() === sym.toUpperCase());
  return match?.sentiment || null;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Assemble the full decision intel for ONE of the user's positions and return the
 * authoritative verdict + a plain-English directive + the levels to watch.
 *
 * @param userId  TRUSTED owner scope (route auth()). Ownership is NEVER derived from
 *                any other source — the position load is scoped to this userId.
 * @param positionId  numeric id of the saved position to detail.
 * @returns PositionDetail, or null when the position does not exist for this user.
 */
export async function buildPositionDetail(
  userId: string,
  positionId: number
): Promise<PositionDetail | null> {
  // 1) Load the user's enriched positions (scoped to userId) and pick the one id.
  //    Reuses the existing batched, cache-reading enrichment path (shared chain cache).
  const positions = await getEnrichedPositionsForUser(userId);
  const position = positions.find((p) => p.id === positionId);
  if (!position) return null;

  const sym = position.ticker.trim().toUpperCase();
  const polygonSym = sym === "SPX" ? "I:SPX" : sym === "VIX" ? "I:VIX" : sym;
  const spx = isSpxTicker(sym);

  // 2) Gather every source for the ticker IN PARALLEL. Promise.allSettled so one failing
  //    source can never sink the rest. The two UNCACHED Polygon fetches are wrapped in
  //    withServerCache here (cache-reader at the detail-view cadence). SPX desk + dossier
  //    are gathered conditionally / best-effort.
  const techPromise = withServerCache(
    `nw:tech:${polygonSym}:${todayEt()}`,
    60_000,
    () => fetchPolygonMtfTechnicals(polygonSym)
  );
  const newsPromise = withServerCache(
    `nw:news:${polygonSym}`,
    120_000,
    () => fetchPolygonNews(polygonSym, 8)
  );

  const [
    gexR,
    flowsR,
    techR,
    newsR,
    earningsR,
    deskR,
    dossierR,
  ] = await Promise.allSettled([
    spx ? Promise.resolve(null) : getNwTickerGex(sym), // SPX positioning comes from the desk instead
    fetchRecentFlows({ ticker: sym, since_hours: 48 }),
    techPromise,
    newsPromise,
    getCachedEarnings(sym),
    spx ? loadMergedSpxDesk() : Promise.resolve(null),
    loadDossierForTicker(sym),
  ]);

  const gex = settledValue(gexR);
  const flowRows = settledValue(flowsR) ?? [];
  const mtf = settledValue(techR);
  const newsRaw = settledValue(newsR);
  const earnings = settledValue(earningsR);
  const deskBundle = settledValue(deskR);
  const dossier = settledValue(dossierR);

  // ── Build each section (HONEST: null when no real data) ──────────────────────

  // Positioning: SPX → richer merged desk; else → per-ticker GEX heatmap.
  let positioning: PositioningSection | null = null;
  if (spx && deskBundle?.merged?.available) {
    const m = deskBundle.merged;
    positioning = {
      source: "spx-desk",
      underlyingPrice: m.price > 0 ? m.price : null,
      gammaRegime: m.gamma_regime ?? null,
      regime: m.regime ?? null,
      gammaFlip: m.gamma_flip ?? null,
      maxPain: m.max_pain ?? null,
      kingStrike: m.gex_king ?? null,
      walls: m.gex_walls ?? [],
    };
  } else if (!spx && gex && gex.spot > 0) {
    positioning = {
      source: "gex-heatmap",
      underlyingPrice: gex.spot,
      gammaRegime: gex.gex.regime.posture,
      regime: null,
      gammaFlip: gex.gex.flip,
      maxPain: gex.max_pain,
      // King = argmax|net_gex| over strike_totals (Heatmap KING NODE + desk gex_king rule),
      // NOT call_wall (largest +gamma) — so all tools name the same king strike.
      kingStrike: kingFromStrikeTotals(gex.gex.strike_totals) ?? gex.gex.call_wall,
      walls: gexWallsFromHeatmapSpot(gex),
    };
  }

  const flows = summarizeFlows(flowRows);

  // Technicals.
  let technicals: TechnicalsSection | null = null;
  let techLevels: Array<{ kind: "support" | "resistance"; price: number; source: string }> = [];
  if (mtf) {
    const techSpot = finite(mtf.price);
    techLevels = levelsFromTechnicals(mtf, techSpot);
    technicals = {
      trend: trendFromStack(mtf.trend_stack),
      trendStack: mtf.trend_stack,
      price: techSpot,
      emas: {
        ema20: finite(mtf.emas?.ema20),
        ema50: finite(mtf.emas?.ema50),
        ema200: finite(mtf.emas?.ema200),
      },
      rsi: {
        daily: finite(mtf.rsi?.daily),
        hourly: finite(mtf.rsi?.hourly),
        m15: finite(mtf.rsi?.m15),
      },
      atr14: finite(mtf.atr14),
      range_high_20d: finite(mtf.range_high_20d),
      range_low_20d: finite(mtf.range_low_20d),
      timeframes: {
        daily: {
          support: finite(mtf.timeframes?.daily?.support),
          resistance: finite(mtf.timeframes?.daily?.resistance),
          vwap: finite(mtf.timeframes?.daily?.vwap),
        },
        hourly: {
          support: finite(mtf.timeframes?.hourly?.support),
          resistance: finite(mtf.timeframes?.hourly?.resistance),
          vwap: finite(mtf.timeframes?.hourly?.vwap),
        },
        m15: {
          support: finite(mtf.timeframes?.m15?.support),
          resistance: finite(mtf.timeframes?.m15?.resistance),
          vwap: finite(mtf.timeframes?.m15?.vwap),
        },
      },
      weekly: {
        support: finite(mtf.weekly?.support),
        resistance: finite(mtf.weekly?.resistance),
      },
      monthly: {
        support: finite(mtf.monthly?.support),
        resistance: finite(mtf.monthly?.resistance),
      },
      keyLevels: techLevels,
    };
  }

  // News.
  let news: NewsItem[] | null = null;
  if (newsRaw && newsRaw.length) {
    news = newsRaw
      .map((a) => ({
        title: a.title,
        published: a.published,
        url: a.url,
        publisher: String(a.publisher ?? ""),
        sentiment: sentimentForTicker(a.insights ?? [], sym),
      }))
      .filter((n) => n.title);
    if (!news.length) news = null;
  }

  // Catalysts — only when a real structured forward earnings date exists.
  let catalysts: CatalystsSection | null = null;
  const earningsDate = nextEarningsDateFromPayload(earnings);
  if (earningsDate) {
    const daysToEarnings = daysBetween(todayEt(), earningsDate);
    const expiry = position.expiry.slice(0, 10);
    const beforeExpiry =
      /^\d{4}-\d{2}-\d{2}$/.test(expiry) ? earningsDate <= expiry : null;
    catalysts = {
      earningsDate,
      daysToEarnings,
      beforeExpiry,
      source: "unusual_whales (cached get_earnings)",
    };
  }

  // SPX confluence — SPX only.
  let confluence: ConfluenceSection | null = null;
  if (spx && deskBundle?.merged) {
    const c = computeSpxConfluence(deskBundle.merged);
    if (c) {
      // computeSpxConfluence hard-codes headline/thesis to "" — the human prose lives in
      // computeSpxTradeSignal (same desk, pure compute). Pull it so the panel isn't blank.
      const sig = computeSpxTradeSignal(deskBundle.merged);
      confluence = {
        action: c.action,
        bias: c.bias,
        score: c.score,
        grade: c.grade,
        headline: sig?.headline ?? "",
        thesis: sig?.thesis ?? "",
        agreeing: c.agreeing,
        conflicts: c.conflicts,
        entry: c.levels.entry,
        stop: c.levels.stop,
        target: c.levels.target,
        invalidation: c.levels.invalidation,
      };
    }
  }

  // Night Hawk dossier — included only if present for the ticker.
  const dossierSection: DossierSection | null = dossier;

  // 3) Build the RICH PositionContext for the authoritative verdict. Walls/regime come
  //    from the positioning section; the optional cross-tool fields (flows/trend/levels/
  //    catalysts) are populated ONLY when real data exists (else left undefined → the
  //    dependent verdict signals never fire). For SPX the desk context is the richer one.
  const ctx = buildVerdictContext({ spx, deskBundle, gex, positioning, flows, technicals, catalysts, techLevels });

  // 4) Authoritative verdict — recomputed from the rich context.
  const verdict = computeVerdict(position, ctx);

  // 5) Plain-English directive + the levels to watch.
  const whatToDo = composeWhatToDo({ position, verdict, confluence, positioning, technicals });

  // 6) The "verified data" ledger — one entry per section.
  const dataSources = buildDataSources({
    spx,
    positioning,
    flows,
    flowRows,
    technicals,
    mtf,
    news,
    newsRaw,
    catalysts,
    earnings,
    confluence,
    dossier: dossierSection,
  });

  return {
    position: { ...position, verdict },
    whatToDo,
    sections: {
      positioning,
      flows,
      technicals,
      news,
      catalysts,
      confluence,
      dossier: dossierSection,
    },
    dataSources,
    as_of: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Section builders / context assembly
// ---------------------------------------------------------------------------

/** King strike = argmax over strikes of |net_gex| — the SAME rule the Heatmap's KING NODE
 *  (kingNodeStrike) and the desk's gex_king (gamma-desk analyzeStrikeGexRows, ranked by
 *  Math.abs(net_gex)) use, so all tools crown the same strike (often the put wall). Replaces the
 *  old `call_wall` (largest +gamma) pick, which disagreed with the Heatmap. Tie-stable on the
 *  lowest strike; zero-only totals → null. Pure (no Math.random/Date), safe in render (#418). */
function kingFromStrikeTotals(totals: Record<string, number>): number | null {
  let king: number | null = null;
  let best = 0;
  const entries = Object.entries(totals)
    .map(([s, v]) => ({ strike: Number(s), value: v }))
    .filter((e) => Number.isFinite(e.strike))
    .sort((a, b) => a.strike - b.strike);
  for (const e of entries) {
    const mag = Math.abs(e.value);
    if (mag > best) {
      best = mag;
      king = e.strike;
    }
  }
  return king;
}

/** GexHeatmap → GexWall[] with distance from spot. `kind` is GEOMETRIC (strike vs spot), matching the
 *  GexWall contract the verdict engine assumes — call_wall/put_wall are NOT guaranteed to sit on the
 *  resistance/support side of spot (computeGexRegime picks them by gamma sign), so deriving kind from
 *  spot geometry here prevents false verdict signals on non-SPX tickers. */
function gexWallsFromHeatmapSpot(
  gex: NonNullable<Awaited<ReturnType<typeof getNwTickerGex>>>
): GexWall[] {
  const walls: GexWall[] = [];
  const spot = gex.spot;
  const cw = gex.gex.call_wall;
  if (cw != null && Number.isFinite(cw)) {
    walls.push({
      strike: cw,
      net_gex: gex.gex.strike_totals[String(cw)] ?? 0,
      kind: cw > spot ? "resistance" : "support",
      distance_pts: Number((cw - spot).toFixed(2)),
    });
  }
  const pw = gex.gex.put_wall;
  if (pw != null && Number.isFinite(pw)) {
    walls.push({
      strike: pw,
      net_gex: gex.gex.strike_totals[String(pw)] ?? 0,
      kind: pw > spot ? "resistance" : "support",
      distance_pts: Number((pw - spot).toFixed(2)),
    });
  }
  return walls;
}

/**
 * Compose the PositionContext computeVerdict consumes. The base (source/walls/regime/
 * flip/max-pain/levels) mirrors the list path's mapping; the optional cross-tool fields
 * are attached ONLY when their data is real, so the verdict's honesty rule holds (no
 * data → field undefined → signal never fires).
 */
function buildVerdictContext(args: {
  spx: boolean;
  deskBundle: Awaited<ReturnType<typeof loadMergedSpxDesk>> | null;
  gex: Awaited<ReturnType<typeof getNwTickerGex>> | null;
  positioning: PositioningSection | null;
  flows: FlowsSection | null;
  technicals: TechnicalsSection | null;
  catalysts: CatalystsSection | null;
  techLevels: Array<{ kind: "support" | "resistance"; price: number; source: string }>;
}): PositionContext {
  const { spx, deskBundle, positioning, flows, technicals, catalysts, techLevels } = args;

  // Base desk/positioning context.
  let base: PositionContext;
  if (spx && deskBundle?.merged?.available) {
    const m = deskBundle.merged;
    base = {
      source: "spx-desk",
      underlyingPrice: m.price > 0 ? m.price : null,
      gammaRegime: m.gamma_regime ?? null,
      regime: m.regime ?? null,
      gammaFlip: m.gamma_flip ?? null,
      maxPain: m.max_pain ?? null,
      gexWalls: m.gex_walls ?? [],
      keyLevels: m.levels ?? [],
    };
  } else if (positioning && positioning.walls.length > 0 && positioning.underlyingPrice != null) {
    base = {
      source: positioning.source,
      underlyingPrice: positioning.underlyingPrice,
      gammaRegime: positioning.gammaRegime,
      regime: positioning.regime,
      gammaFlip: positioning.gammaFlip,
      maxPain: positioning.maxPain,
      gexWalls: positioning.walls,
      keyLevels: [],
    };
  } else {
    base = {
      source: "none",
      underlyingPrice: positioning?.underlyingPrice ?? null,
      gammaRegime: null,
      regime: null,
      gammaFlip: null,
      maxPain: null,
      gexWalls: [],
      keyLevels: [],
    };
  }

  // Optional cross-tool enrichment — only attach REAL data.
  if (flows) {
    base.flows = {
      lean: flows.lean,
      callPremium: flows.callPremium,
      putPremium: flows.putPremium,
      count: flows.count,
    };
  }
  if (technicals?.trend) {
    base.trend = technicals.trend;
  }
  if (techLevels.length > 0) {
    base.levels = techLevels.map((l) => ({ kind: l.kind, price: l.price, source: l.source }));
  }
  if (catalysts && catalysts.earningsDate) {
    base.catalysts = {
      earningsDate: catalysts.earningsDate,
      daysToEarnings: catalysts.daysToEarnings,
      beforeExpiry: catalysts.beforeExpiry,
    };
  }

  return base;
}

/**
 * GEX-consistent wall label (cross-tool fix #80). The platform-wide GexWall
 * contract sets `kind` GEOMETRICALLY (strike vs spot), but the Heatmap and the
 * canonical positioning deriver (gex-positioning.ts) name walls by GEX SIGN:
 * positive net-gamma = CALL WALL (resistance/pin), negative = PUT WALL (support).
 * Labeling a put-wall-signature strike (negative net_gex, e.g. 735 @ -$154M) as
 * a plain "resistance wall" just because it sits above spot contradicts the
 * Heatmap, which correctly shows it as a PUT WALL / support.
 *
 * So we name the wall by its net_gex sign, and when spot has broken THROUGH it
 * (geometric kind disagrees with the GEX-native role) we say it is "acting as
 * support/resistance" rather than silently relabeling the wall itself.
 */
function gexWallLabel(w: GexWall): string {
  // net_gex === 0 carries no put/call signature — fall back to geometry.
  if (!Number.isFinite(w.net_gex) || w.net_gex === 0) {
    return w.kind === "support" ? "GEX support wall" : "GEX resistance wall";
  }
  const isPutWall = w.net_gex < 0; // negative net-gamma => put wall (support)
  const base = isPutWall ? "Put wall" : "Call wall";
  // A put wall natively acts as support; a call wall natively acts as resistance.
  const nativeRole = isPutWall ? "support" : "resistance";
  // If spot has broken past the wall, its geometric role flips.
  return w.kind === nativeRole ? `${base} (${nativeRole})` : `${base} (acting as ${w.kind})`;
}

/**
 * Plain-English "what to do" from the authoritative verdict + the strongest reasons,
 * plus the levels to watch. levelsToWatch = SPX confluence entry/stop/target when present,
 * else nearest support/resistance (technicals) + GEX walls + the position's breakeven.
 * Grounded ONLY in the gathered data — no invented numbers.
 */
function composeWhatToDo(args: {
  position: EnrichedPosition & { verdict: Verdict };
  verdict: Verdict;
  confluence: ConfluenceSection | null;
  positioning: PositioningSection | null;
  technicals: TechnicalsSection | null;
}): PositionDetail["whatToDo"] {
  const { position, verdict, confluence, positioning, technicals } = args;
  const action = verdict.action;

  const HEADLINES: Record<VerdictAction, string> = {
    hold: "Hold — the position is working",
    trim: "Trim — take some risk off",
    sell: "Sell — the thesis is under threat",
    watch: "Watch — no decisive signal yet",
  };
  const headline = HEADLINES[action];

  // Directive: lead with the action, then the two strongest reasons the verdict fired on.
  const topReasons = verdict.reasons.slice(0, 2);
  const VERBS: Record<VerdictAction, string> = {
    hold: "Hold the position.",
    trim: "Scale out of part of the position to lock in / reduce risk.",
    sell: "Close the position.",
    watch: "Hold and monitor — there isn't enough to act on yet.",
  };
  const directive =
    topReasons.length > 0
      ? `${VERBS[action]} ${topReasons.join(" ")}`.trim()
      : VERBS[action];

  // Levels to watch.
  const levelsToWatch: Array<{ label: string; price: number }> = [];
  const pushLevel = (label: string, price: number | null | undefined) => {
    const p = finite(price);
    if (p == null || p <= 0) return;
    if (levelsToWatch.some((l) => Math.abs(l.price - p) < 1e-6)) return;
    levelsToWatch.push({ label, price: p });
  };

  if (confluence && (confluence.entry != null || confluence.stop != null || confluence.target != null)) {
    // SPX scored thesis is the most authoritative — prefer its levels.
    pushLevel("Confluence entry", confluence.entry);
    pushLevel("Confluence stop", confluence.stop);
    pushLevel("Confluence target", confluence.target);
  } else {
    // Nearest chart support/resistance.
    for (const lvl of technicals?.keyLevels ?? []) {
      pushLevel(lvl.kind === "support" ? "Support" : "Resistance", lvl.price);
    }
    // GEX walls — label by GEX sign (put/call wall), consistent with the
    // Heatmap, not by raw strike-vs-spot geometry (cross-tool fix #80).
    for (const w of positioning?.walls ?? []) {
      pushLevel(gexWallLabel(w), w.strike);
    }
    // Gamma flip + max pain as structural context.
    pushLevel("Gamma flip", positioning?.gammaFlip);
    pushLevel("Max pain", positioning?.maxPain);
  }
  // Always include the position's own breakeven when defined.
  pushLevel("Breakeven", position.breakeven);

  return { action, headline, directive, levelsToWatch: levelsToWatch.slice(0, 8) };
}

/** Best-effort Night Hawk dossier read for one ticker; null if none staged today. */
async function loadDossierForTicker(sym: string): Promise<DossierSection | null> {
  try {
    const edition = await getLatestNightHawkEdition();
    const editionFor = edition?.edition_for ?? todayEt();
    const all = await fetchStagedDossiers(editionFor);
    const one = all.find((d) => d.ticker === sym);
    if (!one) return null;
    return {
      edition_for: editionFor,
      ticker: sym,
      scored: one.scored,
      dossier: one.dossier,
    };
  } catch {
    return null;
  }
}

/** The verified-data ledger: one entry per section with ok/provider/asOf provenance. */
function buildDataSources(args: {
  spx: boolean;
  positioning: PositioningSection | null;
  flows: FlowsSection | null;
  flowRows: FlowRow[];
  technicals: TechnicalsSection | null;
  mtf: SettledMtf;
  news: NewsItem[] | null;
  newsRaw: SettledNews;
  catalysts: CatalystsSection | null;
  earnings: EarningsResult | null;
  confluence: ConfluenceSection | null;
  dossier: DossierSection | null;
}): DataSource[] {
  const {
    spx,
    positioning,
    flows,
    flowRows,
    technicals,
    mtf,
    news,
    catalysts,
    earnings,
    confluence,
    dossier,
  } = args;

  const sources: DataSource[] = [];

  sources.push({
    key: "positioning",
    label: "Dealer positioning / GEX",
    provider: spx ? "spx-desk" : "polygon-gex-heatmap",
    ok: positioning != null,
    asOf: positioning != null ? new Date().toISOString() : null,
  });
  sources.push({
    key: "flows",
    label: "Options flow (48h)",
    provider: "helix-postgres",
    ok: flows != null,
    asOf: flows != null && flowRows.length ? (flowRows[0].alerted_at ?? null) : null,
  });
  sources.push({
    key: "technicals",
    label: "Multi-timeframe technicals",
    provider: "polygon",
    ok: technicals != null,
    asOf: technicals != null ? new Date().toISOString() : null,
  });
  // Surface a quiet flag if technicals came back but with no usable price.
  void mtf;
  sources.push({
    key: "news",
    label: "Headlines + sentiment",
    provider: "polygon",
    ok: news != null,
    asOf: news != null && news.length ? (news[0].published || null) : null,
  });
  sources.push({
    key: "catalysts",
    label: "Earnings / catalysts",
    provider: "benzinga+unusual_whales (cached)",
    // ok:false when no structured forward earnings date was found — honest "no real data".
    ok: catalysts != null,
    asOf: catalysts?.earningsDate ?? null,
  });
  void earnings;
  if (spx) {
    sources.push({
      key: "confluence",
      label: "SPX confluence thesis",
      provider: "spx-desk + spx-signals",
      ok: confluence != null,
      asOf: confluence != null ? new Date().toISOString() : null,
    });
  }
  if (dossier) {
    sources.push({
      key: "dossier",
      label: "Night Hawk dossier",
      provider: "nighthawk-staging",
      ok: true,
      asOf: dossier.edition_for,
    });
  }

  return sources;
}

/**
 * SPX Slayer — SHADOW-MODE factor scoring, catalyst edition. Same structural
 * contract as src/lib/spx-signals-shadow.ts (read that file's module doc
 * first): `computeSpxConfluence()` (src/lib/spx-signals.ts) never imports this
 * file, and this file never imports FROM spx-signals.ts — `git grep
 * spx-signals-shadow-catalysts src/lib/spx-signals.ts` returns nothing, so the
 * "cannot touch the live score" guarantee is visible by inspection, not just
 * by test. This is a SEPARATE shadow factor, not a change to the real
 * "Mega-caps" factor (src/lib/spx-signals.ts, `leader_stocks` reduce/avg
 * block) — that factor only ever looks at `change_pct`, with no awareness of
 * WHY a leader is moving. This module asks that second question in shadow
 * mode only.
 *
 * Why this factor: the real Mega-caps factor scores a leadership-average
 * price move but is blind to cause — a %move driven by a hard FDA/M&A/
 * guidance catalyst is a fundamentally different signal than the same %move
 * on no news (drift, sympathy, index-fund flow). This computes what a
 * catalyst-aware overlay WOULD have contributed, logged next to the real
 * score for later correlation — with zero live effect until a future,
 * separately-reviewed change promotes it into computeSpxConfluence()'s own
 * `score +=` chain, same n>=10-evidence bar bie/calibration.ts already holds
 * every acted-on pattern to (see spx-signals-shadow.ts's module doc for the
 * full precedent — not re-derived here).
 *
 * Pure function: no DB reads, no fetch, no bare `Date.now()`/`new Date()` (the
 * caller passes `now` explicitly) — fully unit-testable and structurally
 * incapable of a side effect on the real signal.
 */
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import type { ShadowFactorObservation } from "@/lib/spx-signals-shadow";

export type { ShadowFactorObservation };

/**
 * One Benzinga article as already classified by fetchBenzingaCatalysts
 * (src/lib/providers/polygon.ts) — `ticker` is stitched on by the caller
 * (spx-signal-log.ts) since fetchBenzingaCatalysts is a per-ticker call and
 * its own return shape doesn't carry the ticker it was fetched for. Kept as
 * a local type (not re-exported from polygon.ts) for the same reason
 * FlowAnomalyInput is local to spx-signals-shadow.ts: a provider-side type
 * change can't silently break this file's narrowing.
 */
export type CatalystInput = {
  ticker: string;
  type: "binary" | "guidance" | "m&a" | "insider" | "buyback" | "offering" | "short" | "ipo" | "other";
  title: string;
  published: string;
};

/**
 * Only these three catalyst types are in scope per the task: FDA
 * approval/rejection ("binary" — fetchBenzingaCatalysts's name for FDA/
 * regulatory binary-outcome headlines), M&A, and guidance raise/cut.
 * insider/buyback/offering/short/ipo are real Benzinga catalyst types but are
 * a materially weaker directional read (an insider buy or a buyback doesn't
 * "explain" a same-day % move the way a binary regulatory outcome or a
 * guidance revision does) — explicitly out of scope, not silently dropped.
 */
type ScoredCatalystType = "binary" | "m&a" | "guidance";
const SCORED_TYPES = new Set<ScoredCatalystType>(["binary", "m&a", "guidance"]);

/**
 * Recency window for "active/recent" — 24h, not the 30min window
 * spx-signals-shadow.ts uses for tape sweeps. A HELIX 0DTE sweep is stale
 * evidence after 30 minutes; an FDA approval or a guidance cut printed
 * overnight or in this morning's pre-market is still the reason a mega-cap
 * leader is up or down 2% at 11am — anchor to the trading-day relevance
 * window, not the tape's half-life.
 */
const CATALYST_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Provisional weight scale — NOT derived from any backtest (see
 * spx-signals-shadow.ts's SEVERITY_WEIGHT comment for the full rationale of
 * why shadow weights are chosen this way at all). Anchored inside the real
 * engine's ±3-to-±18 range:
 *   - binary (FDA approval/rejection): 15 — a binary regulatory outcome is
 *     the single most decisive, least-fadeable catalyst type Benzinga
 *     classifies; second only to the engine's own GEX-wall ceiling (±18).
 *   - m&a: 12 — a real deal catalyst moves a mega-cap hard, but is more
 *     "priced in over hours" than a binary yes/no.
 *   - guidance: 6 — deliberately matched to the real Mega-caps factor's own
 *     ±6 weight (src/lib/spx-signals.ts), since a guidance revision is the
 *     same magnitude class of information as the routine earnings-guidance
 *     moves that factor already exists to catch.
 */
const CATALYST_TYPE_WEIGHT: Record<ScoredCatalystType, number> = {
  binary: 15,
  "m&a": 12,
  guidance: 6,
};

/** Stable factor_name slug — "m&a" isn't a safe identifier fragment. */
function catalystTypeSlug(type: ScoredCatalystType): string {
  if (type === "m&a") return "mna";
  return type;
}

/**
 * Coarse bullish/bearish read from the article title. This is deliberately a
 * simple keyword heuristic, not NLP sentiment — same "provisional/unproven"
 * caveat as the weight table above applies to direction too. M&A is the
 * hardest of the three to read cleanly (being the target of a takeover and
 * being the acquirer funding one are opposite reads); lacking a reliable
 * signal for which side a mega-cap is on, an active/progressing deal
 * headline defaults bullish (the common retail read of "merger"/"buyout"
 * news) and only a clearly-collapsing deal reads bearish.
 */
function inferCatalystDirection(type: ScoredCatalystType, title: string): "bullish" | "bearish" | "neutral" {
  const t = title.toLowerCase();
  if (type === "binary") {
    if (/(reject|rejection|declin|fails? to|complete response|crl\b|clinical hold|does not approve)/.test(t)) return "bearish";
    if (/(approv|clear(ance|ed)?|greenlight|grants?)/.test(t)) return "bullish";
    return "neutral";
  }
  if (type === "guidance") {
    if (/(cut|lower|reduce|miss|withdraw|below|slash|trim)/.test(t)) return "bearish";
    if (/(raise|boost|increase|beat|tops?|above|hike)/.test(t)) return "bullish";
    return "neutral";
  }
  // m&a
  if (/(terminat|collapse|scrap|walk(s|ed)? away|blocks?|calls? off|abandon)/.test(t)) return "bearish";
  return "bullish";
}

/**
 * Shadow-score Benzinga catalysts (FDA/M&A/guidance only) against the SAME
 * mega-cap leader list the real "Mega-caps" factor reads from `desk`
 * (src/lib/spx-signals.ts's `desk.leader_stocks`) — reusing that exact field
 * rather than a second ticker list that could drift from it.
 *
 * AVAILABILITY / STALENESS (mirrors computeShadowFactors's guard exactly):
 *  - No leader tickers in `desk.leader_stocks` at all → `available:false`.
 *    This is the real factor's own upstream data (a Polygon leader-stock
 *    snapshot failure), and this module has nothing to scope a catalyst
 *    check to — silently emitting nothing here would be indistinguishable
 *    later from "checked, found nothing," the exact ambiguity this framework
 *    exists to avoid.
 *  - `catalystFetchOk === false` → `available:false` regardless of what
 *    `catalysts` contains. `fetchBenzingaCatalysts` (src/lib/providers/
 *    polygon.ts) swallows its own fetch errors internally and returns `[]`
 *    on failure — it cannot itself distinguish "no catalysts" from "the
 *    fetch broke." The caller (spx-signal-log.ts) passes
 *    `polygonConfigured()` as the best available proxy for "the fetch could
 *    even have succeeded" (Benzinga news is served through Polygon's
 *    `/benzinga/v2/news`, gated on `POLYGON_API_KEY`) — an honest, documented
 *    limitation: a configured-but-transiently-failing fetch still collapses
 *    to the "no catalysts found" reading below, same as it would for any
 *    other consumer of this fetcher today.
 *  - Otherwise, an empty/no-qualifying-catalyst result is a genuine
 *    `available:true, implied_weight:0` "checked, nothing found" reading.
 *
 * @param now injectable clock (defaults to Date.now()) purely for
 *            deterministic tests — production call sites never pass this.
 */
export function computeCatalystShadowFactors(
  desk: SpxDeskPayload,
  catalysts: CatalystInput[],
  catalystFetchOk: boolean,
  now: number = Date.now()
): ShadowFactorObservation[] {
  const leaders = desk.leader_stocks ?? [];

  if (leaders.length === 0) {
    return [
      {
        factor_name: "megacap_catalyst_watch",
        available: false,
        implied_weight: 0,
        direction: "neutral",
        detail: "No mega-cap leader tickers in desk.leader_stocks — cannot scope a catalyst check",
      },
    ];
  }

  if (!catalystFetchOk) {
    return [
      {
        factor_name: "megacap_catalyst_watch",
        available: false,
        implied_weight: 0,
        direction: "neutral",
        detail:
          "Benzinga catalyst fetch not confirmed ok (Polygon not configured or the fetch could not be attempted) — cannot distinguish 'no catalyst' from 'fetch broken'",
      },
    ];
  }

  // The real Mega-caps factor's own aggregate — recomputed here from the same
  // desk field with the identical formula (data reuse, not logic reuse: this
  // file never imports spx-signals.ts) purely so this shadow factor can say
  // whether a catalyst agrees with or complicates that raw average, per the
  // task's own framing.
  const rawAvg = leaders.reduce((s, l) => s + l.change_pct, 0) / leaders.length;
  const avgSign = rawAvg > 0 ? 1 : rawAvg < 0 ? -1 : 0;

  const leaderTickers = new Set(leaders.map((l) => l.ticker.toUpperCase()));
  const changeByTicker = new Map(leaders.map((l) => [l.ticker.toUpperCase(), l.change_pct]));

  const inWindow = catalysts.filter((c) => {
    if (!leaderTickers.has((c.ticker ?? "").toUpperCase())) return false;
    if (!SCORED_TYPES.has(c.type as ScoredCatalystType)) return false;
    const publishedMs = Date.parse(c.published);
    if (!Number.isFinite(publishedMs)) return false;
    const age = now - publishedMs;
    return age >= 0 && age <= CATALYST_WINDOW_MS;
  });

  if (inWindow.length === 0) {
    return [
      {
        factor_name: "megacap_catalyst_watch",
        available: true,
        implied_weight: 0,
        direction: "neutral",
        detail: `No FDA/M&A/guidance catalysts found for current mega-cap leaders (${[...leaderTickers].sort().join(", ")}) in the last ${CATALYST_WINDOW_MS / 3_600_000}h`,
      },
    ];
  }

  // One observation per ticker — keep only the highest-weight qualifying
  // catalyst per ticker (binary > m&a > guidance on a tie in recency),
  // mirroring computeShadowFactors's own "dominant signal only" per-ticker
  // dedup so a noisy ticker with several headlines in-window doesn't produce
  // duplicate rows.
  const bestByTicker = new Map<string, CatalystInput>();
  for (const c of inWindow) {
    const ticker = c.ticker.toUpperCase();
    const type = c.type as ScoredCatalystType;
    const w = CATALYST_TYPE_WEIGHT[type];
    const existing = bestByTicker.get(ticker);
    const existingW = existing ? CATALYST_TYPE_WEIGHT[existing.type as ScoredCatalystType] : -1;
    if (!existing || w > existingW) bestByTicker.set(ticker, c);
  }

  return [...bestByTicker.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ticker, c]) => {
      const type = c.type as ScoredCatalystType;
      const dir = inferCatalystDirection(type, c.title);
      const dirSign = dir === "bullish" ? 1 : dir === "bearish" ? -1 : 0;
      const magnitude = CATALYST_TYPE_WEIGHT[type];
      const tickerMove = changeByTicker.get(ticker) ?? 0;

      // Agreement/complication is judged against the raw-average sign (the
      // real factor's own aggregate conclusion), per the task's framing —
      // NOT against this one ticker's own change_pct, which only gates
      // whether the catalyst plausibly "explains" that ticker's individual
      // move (captured in the detail string below for a human reader).
      const agreesWithAvg = dirSign !== 0 && avgSign !== 0 && dirSign === avgSign;
      const complicatesAvg = dirSign !== 0 && avgSign !== 0 && dirSign !== avgSign;
      // A catalyst whose direction conflicts with the basket-wide average is
      // real but discordant evidence — dampen it by half rather than drop it,
      // so a genuine conflict still surfaces (for later evidence-gathering)
      // without letting one contrarian headline swing as hard as a confirming
      // one. No avg lean at all (avgSign===0) or a neutral-read catalyst
      // stands on its own at full/zero magnitude.
      const weight = dirSign === 0 ? 0 : complicatesAvg ? dirSign * Math.round(magnitude / 2) : dirSign * magnitude;

      const explainsOwnMove =
        dirSign !== 0 && Math.sign(tickerMove) === dirSign && Math.abs(tickerMove) > 0;
      const relation = agreesWithAvg
        ? `agrees with the mega-cap raw average (${rawAvg >= 0 ? "+" : ""}${rawAvg.toFixed(2)}%)`
        : complicatesAvg
          ? `complicates the mega-cap raw average (${rawAvg >= 0 ? "+" : ""}${rawAvg.toFixed(2)}%) — weight dampened`
          : "no aggregate lean to compare against";

      return {
        factor_name: `megacap_catalyst_${ticker.toLowerCase()}_${catalystTypeSlug(type)}`,
        available: true,
        implied_weight: weight,
        direction: dir,
        detail: `${ticker} ${type} catalyst (${dir}) — "${c.title}" [shadow: not scored] — ${explainsOwnMove ? `plausibly explains its own ${tickerMove >= 0 ? "+" : ""}${tickerMove.toFixed(2)}% move` : `does not clearly track its own ${tickerMove >= 0 ? "+" : ""}${tickerMove.toFixed(2)}% move`}; ${relation}`,
      };
    });
}

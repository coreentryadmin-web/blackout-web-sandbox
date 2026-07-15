// CORTEX SOURCE: BIE news/earnings/catalysts — why is this flowing?
// Design doc §1 "BIE": flow + catalyst = informed; flow − catalyst = possibly hedge
// noise — the single best discriminator for "why is this flowing." Catalyst-confirmed
// flow upgrades conviction one band; earnings-today (AMC) on the ticker opposes new
// long-premium commits (IV-inflated premium + event risk beyond the expiry window).
// "Lies when: headline sentiment is naive" → DETERMINISTIC channel/keyword tagging
// only — no LLM, no sentiment scoring, ever, in the money path.

import type { CortexInputs, CortexNewsItem, EvidenceItem } from "../types";
import { ALIGNED_CLUSTER_MIN_PREMIUM, ALIGNED_CLUSTER_MIN_PRINTS, findFlowCluster } from "./flow-quality";
import { absentForMissingSlice, fmtMillions, parseMs } from "./shared";

/** Benzinga channels that constitute a real catalyst — the confirmed-working set
 *  polygon-news.ts's DEFAULT_CATALYST_CHANNELS queries, plus "earnings" (the same
 *  channel the reader's own live verification used). Lowercase for matching. */
export const CATALYST_CHANNELS = new Set([
  "m&a",
  "guidance",
  "short sellers",
  "insider trades",
  "fda",
  "buybacks",
  "offerings",
  "ipos",
  "earnings",
]);

/** Keyword fallback for items whose channel list is empty — deterministic headline
 *  tagging only (design §1: no LLM). The words mirror the channel set. */
export const CATALYST_KEYWORD_RE =
  /\b(fda|approval|merger|acquisition|acquires?|guidance|buyback|offering|ipo|upgrades?|downgrades?|earnings)\b/i;

/** A catalyst older than 24h is yesterday's story, not today's decoupling thesis. */
export const CATALYST_MAX_AGE_SEC = 24 * 60 * 60;

/** Raw weight of catalyst-confirmed flow. 0.75 = the same tier as the flow support
 *  it confirms — the pair together (1.5) matches the flagship cap, which is the
 *  design's intent: informed flow is a first-class signal, but the catalyst leg
 *  alone (without the cluster) is worth nothing. */
export const CATALYST_CONFIRMED_FLOW_WEIGHT = 0.75;

/** Per-source support cap. */
export const CATALYST_SUPPORT_CAP = 0.75;

/** Raw weight of the earnings-today (AMC) opposition. 0.8 — above the small-signal
 *  tier because it is a KNOWN event: IV-inflated entry premium plus a binary event
 *  the 0DTE expiry cannot even capture (design §1 BIE, 0DTE use). */
export const EARNINGS_TODAY_OPPOSE_WEIGHT = 0.8;

/** Half-life 4h: a same-day catalyst stays load-bearing through the session (unlike
 *  wall/flow reads); 3 half-lives ≈ 12h still silences yesterday's headline. */
export const CATALYST_HALF_LIFE_SEC = 4 * 60 * 60;

/** Deterministic catalyst test for one item: tagged channel OR headline keyword. */
export function isCatalystItem(item: CortexNewsItem): boolean {
  if (item.channels.some((c) => CATALYST_CHANNELS.has(c.toLowerCase().trim()))) return true;
  return CATALYST_KEYWORD_RE.test(item.headline);
}

/** The freshest in-age catalyst item, or null. Exported for sector-heat's catalyst
 *  exemption so "is there a catalyst" has exactly ONE implementation. */
export function freshCatalystItem(input: CortexInputs): CortexNewsItem | null {
  const nowMs = parseMs(input.now);
  if (!input.news || nowMs == null) return null;
  let best: { item: CortexNewsItem; ms: number } | null = null;
  for (const item of input.news.items) {
    if (!isCatalystItem(item)) continue;
    const ms = parseMs(item.publishedAt);
    if (ms == null) continue; // no real timestamp → cannot verify freshness → not a catalyst claim
    const ageSec = (nowMs - ms) / 1000;
    if (ageSec < 0 || ageSec > CATALYST_MAX_AGE_SEC) continue;
    if (!best || ms > best.ms) best = { item, ms };
  }
  return best?.item ?? null;
}

/** Boolean form for the sector-heat exemption. */
export function hasCatalystItem(input: CortexInputs): boolean {
  return freshCatalystItem(input) != null;
}

/** Deterministic one-word tag for the detail sentence: the first matching channel,
 *  else the matched headline keyword. */
export function catalystTag(item: CortexNewsItem): string {
  const channel = item.channels.find((c) => CATALYST_CHANNELS.has(c.toLowerCase().trim()));
  if (channel) return channel.toLowerCase();
  const kw = CATALYST_KEYWORD_RE.exec(item.headline);
  return kw ? kw[1].toLowerCase() : "catalyst";
}

export function deriveCatalystNewsEvidence(input: CortexInputs): EvidenceItem[] {
  const { news, direction } = input;
  if (!news) return [absentForMissingSlice("catalyst-news", input, "no news/catalyst read")];
  const nowMs = parseMs(input.now);
  if (nowMs == null) return [absentForMissingSlice("catalyst-news", input, "invalid now timestamp")];

  const items: EvidenceItem[] = [];

  // --- Earnings today: oppose NEW premium commits ---------------------------
  // Every 0DTE Command commit is a premium BUY (fixed −50/+100 option plan,
  // NIGHTHAWK-VS-SLAYER-0DTE.md §1.2), so the AMC opposition applies to both
  // directions — long premium is the instrument, not the bias. An "unknown"
  // report time is treated like AMC (the risk exists; the timing is unverified).
  if (news.earningsToday === "afterhours" || news.earningsToday === "unknown") {
    items.push({
      source: "catalyst-news",
      stance: "opposes",
      weight: EARNINGS_TODAY_OPPOSE_WEIGHT,
      halfLifeSec: CATALYST_HALF_LIFE_SEC,
      asOf: news.asOf,
      detail:
        `${input.ticker} reports earnings today (${news.earningsToday === "afterhours" ? "after the close" : "time unconfirmed"}) — ` +
        `IV-inflated premium and a binary event beyond the 0DTE window oppose new premium commits.`,
    });
  }

  // --- Catalyst-confirmed flow ------------------------------------------------
  // The upgrade requires BOTH legs: a fresh deterministic catalyst AND the exact
  // aligned sweep cluster flow-quality supports on (ONE cluster implementation —
  // findFlowCluster — not a second private derivation). compose.ts reads any
  // catalyst-news SUPPORT as the one-band conviction upgrade (design §1 BIE).
  const catalyst = freshCatalystItem(input);
  if (catalyst && input.flow) {
    const alignedSide = direction === "long" ? "bullish" : "bearish";
    const cluster = findFlowCluster(input.flow.prints, alignedSide, nowMs);
    if (
      cluster &&
      cluster.totalPremium >= ALIGNED_CLUSTER_MIN_PREMIUM &&
      cluster.prints >= ALIGNED_CLUSTER_MIN_PRINTS
    ) {
      items.push({
        source: "catalyst-news",
        stance: "supports",
        weight: CATALYST_CONFIRMED_FLOW_WEIGHT,
        halfLifeSec: CATALYST_HALF_LIFE_SEC,
        // The claim is about the catalyst's freshness — decay runs off publish time.
        asOf: catalyst.publishedAt,
        detail:
          `catalyst-confirmed flow: same-day ${catalystTag(catalyst)} catalyst with an aligned ${alignedSide} ` +
          `cluster ${fmtMillions(cluster.totalPremium)} — informed flow, not hedge noise.`,
      });
    }
  }

  if (items.length === 0) {
    return [
      absentForMissingSlice(
        "catalyst-news",
        input,
        "no same-day catalyst and no earnings today — flow is uncatalyzed (possibly hedge noise)"
      ),
    ];
  }
  return items;
}

// BIE × Night Hawk OVERNIGHT edition — the read bridge (PR-N9).
//
// Before this module BIE knew Night Hawk only PER TICKER (`nighthawk_recent` in
// ecosystem-context: one most-recent outcome row). It had NO edition-level intent:
// "what are tomorrow's plays?", "why was CSX picked tonight?", "why was the pick
// pulled?", "what did the morning check see?" were unanswerable — even though, as of
// #331, the WHY exists as PINNED data on every outcome row (`publish_context` pinned
// first-write-wins at publish, `morning_verdict` persisted with the numbers the 9:15
// check saw, and the one-way `pulled` latch). This module is the Night Hawk analogue
// of the Cortex bridge (#327, cortex-read.ts): same envelope, same pinned-beats-live
// philosophy, same structural-read honesty. Two deterministic reads (no LLM anywhere):
//
//  - readNighthawkEdition(dateYmd?) — the edition's ranked plays, each with its pinned
//    publish_context rendered as an evidence block (spot/band geometry with the SIGNED
//    distances — the N-3 detached-band signature — regime, breadth, catalyst flags,
//    score snapshot), the pulled state + reason, the morning verdict numbers when
//    present, and the grade + methodology once graded.
//  - readNighthawkPickWhy(ticker, dateYmd?) — one play's full story: why it was picked
//    (the pin), what the morning saw (the persisted verdict), whether it was pulled
//    and why, and how it graded.
//
// HONESTY RULES (the #327 spine, applied to the overnight substrate):
//  - pre-#331 rows carry no publish_context → say so plainly ("published before
//    evidence pinning — no decision context on record"). NEVER reconstruct what the
//    builder "must have seen" — a reconstruction would record today's market, not
//    publish night's.
//  - pulled plays are labeled PULLED with their reason and the documented
//    BOTH-DIRECTIONS exclusion note (a counterfactual grade never counts, either way).
//  - every pinned blob is read STRUCTURALLY (never trust a JSON column): malformed →
//    "no context on record", never a crash or a partially-invented table.
//
// IO discipline: identical to cortex-read.ts — every reader is dynamically imported
// with a RELATIVE specifier (CI's tsx ESM loader cannot resolve "@/" aliases in
// dynamic import positions), every read is read-only + fail-soft, and the pure
// envelope builders are exported for hermetic unit tests. Imports from
// features/nighthawk/lib are READ-ONLY and leaf-only (types + the shared entry-range
// parser) — this module never touches the edition builder or analytics lanes.

import type { NighthawkEditionRow, NighthawkPlayOutcomeRow } from "@/lib/db";
import { entryRangeMid } from "@/features/nighthawk/lib/entry-range";
import {
  makeEnvelope,
  type BieAnswerEnvelope,
  type BieBias,
  type BieEvidence,
  type BieUnavailableSource,
} from "./answer-envelope";
import type { BieComposed } from "./composers-shared";

// ── Small shared formatting helpers ────────────────────────────────────────────────

const fmtNum = (n: unknown, digits = 2): string =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("en-US", { maximumFractionDigits: digits })
    : "—";

/** Signed percentage ("+1.24%" / "−3.1%") — the sign IS the geometry story
 *  (a strongly negative band distance on a LONG = the band sits below the market). */
function fmtSignedPct(v: number | null, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = v.toLocaleString("en-US", { maximumFractionDigits: digits });
  return v > 0 ? `+${s}%` : `${s}%`;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** The documented both-directions exclusion rule for pulled plays (analytics.ts /
 *  FINDINGS #331: "counterfactual grades never count, either direction"). */
export const NH_PULLED_EXCLUSION_NOTE =
  "Its grade is counterfactual-only and excluded from the headline record in BOTH directions — a pulled play that would have won adds no win, and one that would have lost adds no loss.";

/** The honest statement for a row published before #331's evidence pinning. */
export const NH_PRE_PINNING_NOTE =
  "Published before evidence pinning — no decision context on record for this play. Nothing here is reconstructed after the fact.";

// ── Structural readers for the pinned blobs (never trust a JSON column) ────────────

/** publish_context as pinned by publish-context.ts (buildNighthawkPublishContext) —
 *  read structurally; a malformed blob → null → "no context on record", never a guess. */
export type NhPublishPinLike = {
  pinned_at: string | null;
  direction: "LONG" | "SHORT" | null;
  conviction: string | null;
  score: number | null;
  spot_at_publish: number | null;
  prior_close: number | null;
  atr14: number | null;
  entry_range_low: number | null;
  entry_range_high: number | null;
  target: number | null;
  stop: number | null;
  /** Signed % from spot to the NEAREST FILLABLE band edge (LONG: band top) — the N-3
   *  detached-band signature. Strongly negative on a LONG = band far below the market. */
  band_distance_pct: number | null;
  target_distance_pct: number | null;
  stop_distance_pct: number | null;
  market: {
    composite_regime: string | null;
    tide_bias: string | null;
    vix_iv_rank: number | null;
    vix_close: number | null;
    spx_close: number | null;
    breadth: {
      pct_advancing: number | null;
      advance_decline_ratio: number | null;
      pct_above_vwap: number | null;
    } | null;
  };
  catalysts: {
    earnings_tomorrow: boolean;
    earnings_date: string | null;
    earnings_risk: boolean;
    catalyst_flags: string[];
  };
  /** The scorer's confluence snapshot — opaque blob owned by the scoring lane; only
   *  primitive scalars are ever rendered (whitelist-style), never invented structure. */
  confluence: Record<string, unknown> | null;
};

export function readNighthawkPublishPin(raw: unknown): NhPublishPinLike | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  // Version gate: every real pin stamps context_version (publish-context.ts). A blob
  // without it is not a pin we understand — treat as "no context on record".
  if (num(p.context_version) == null) return null;
  const market = (p.market && typeof p.market === "object" ? p.market : {}) as Record<string, unknown>;
  const breadthRaw = (market.breadth && typeof market.breadth === "object" ? market.breadth : null) as
    | Record<string, unknown>
    | null;
  const cats = (p.catalysts && typeof p.catalysts === "object" ? p.catalysts : {}) as Record<string, unknown>;
  const dirRaw = str(p.direction)?.toUpperCase() ?? null;
  return {
    pinned_at: str(p.pinned_at),
    direction: dirRaw === "SHORT" ? "SHORT" : dirRaw === "LONG" ? "LONG" : null,
    conviction: str(p.conviction),
    score: num(p.score),
    spot_at_publish: num(p.spot_at_publish),
    prior_close: num(p.prior_close),
    atr14: num(p.atr14),
    entry_range_low: num(p.entry_range_low),
    entry_range_high: num(p.entry_range_high),
    target: num(p.target),
    stop: num(p.stop),
    band_distance_pct: num(p.band_distance_pct),
    target_distance_pct: num(p.target_distance_pct),
    stop_distance_pct: num(p.stop_distance_pct),
    market: {
      composite_regime: str(market.composite_regime),
      tide_bias: str(market.tide_bias),
      vix_iv_rank: num(market.vix_iv_rank),
      vix_close: num(market.vix_close),
      spx_close: num(market.spx_close),
      breadth: breadthRaw
        ? {
            pct_advancing: num(breadthRaw.pct_advancing),
            advance_decline_ratio: num(breadthRaw.advance_decline_ratio),
            pct_above_vwap: num(breadthRaw.pct_above_vwap),
          }
        : null,
    },
    catalysts: {
      earnings_tomorrow: cats.earnings_tomorrow === true,
      earnings_date: str(cats.earnings_date),
      earnings_risk: cats.earnings_risk === true,
      catalyst_flags: Array.isArray(cats.catalyst_flags)
        ? cats.catalyst_flags.filter((f): f is string => typeof f === "string")
        : [],
    },
    confluence:
      p.confluence && typeof p.confluence === "object" && !Array.isArray(p.confluence)
        ? (p.confluence as Record<string, unknown>)
        : null,
  };
}

/** morning_verdict as persisted by morning-verdict-persist.ts (buildMorningVerdictRecord)
 *  — structural read; malformed → null ("no morning verdict on record"). */
export type NhMorningVerdictLike = {
  status: string;
  reason: string | null;
  checked_at: string | null;
  metrics: {
    stock_premarket: number | null;
    spx_premarket: number | null;
    spx_prior_close: number | null;
    overnight_gap_pts: number | null;
    overnight_gap_pct: number | null;
    regime: string | null;
    premarket_vs_stop_pct: number | null;
    premarket_vs_band_pct: number | null;
  } | null;
};

export function readNighthawkMorningVerdict(raw: unknown): NhMorningVerdictLike | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  const status = str(v.status);
  if (!status) return null; // no status → not a verdict we can present
  const m = (v.metrics && typeof v.metrics === "object" ? v.metrics : null) as Record<string, unknown> | null;
  return {
    status: status.toUpperCase(),
    reason: str(v.reason),
    checked_at: str(v.checked_at),
    metrics: m
      ? {
          stock_premarket: num(m.stock_premarket),
          spx_premarket: num(m.spx_premarket),
          spx_prior_close: num(m.spx_prior_close),
          overnight_gap_pts: num(m.overnight_gap_pts),
          overnight_gap_pct: num(m.overnight_gap_pct),
          regime: str(m.regime),
          premarket_vs_stop_pct: num(m.premarket_vs_stop_pct),
          premarket_vs_band_pct: num(m.premarket_vs_band_pct),
        }
      : null,
  };
}

// ── Row / edition slices the builders need ─────────────────────────────────────────

/** The outcome-row slice the builders read (a Pick of db.ts's NighthawkPlayOutcomeRow
 *  plus pulled_at, which this module's own SELECT adds — accepts the full row). */
export type NhOutcomeRowLike = Pick<
  NighthawkPlayOutcomeRow,
  | "edition_for"
  | "ticker"
  | "direction"
  | "conviction"
  | "score"
  | "entry_range_low"
  | "entry_range_high"
  | "target"
  | "stop"
  | "next_day_open"
  | "next_day_close"
  | "session_high"
  | "session_low"
  | "hit_target"
  | "hit_stop"
  | "outcome"
  | "pulled"
  | "pulled_reason"
  | "publish_context"
  | "morning_verdict"
> & { pulled_at?: string | null };

/** The edition-row slice (a Pick of db.ts's NighthawkEditionRow). */
export type NhEditionRowLike = Pick<
  NighthawkEditionRow,
  "edition_for" | "published_at" | "recap_headline" | "recap_summary" | "plays"
>;

/** One play as stored in nighthawk_editions.plays (a PlaybookPlay JSONB) — read
 *  structurally, since the column is `unknown[]` and the shape is owned elsewhere. */
export type NhEditionPlayLike = {
  rank: number | null;
  ticker: string;
  direction: "LONG" | "SHORT";
  conviction: string | null;
  thesis: string | null;
  key_signal: string | null;
  entry_range: string | null;
  target: string | null;
  stop: string | null;
  options_play: string | null;
  score: number | null;
};

export function parseEditionPlays(raw: unknown[]): NhEditionPlayLike[] {
  const out: NhEditionPlayLike[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    if (item == null || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    const ticker = str(p.ticker)?.toUpperCase();
    if (!ticker) continue;
    out.push({
      rank: num(p.rank),
      ticker,
      direction: (str(p.direction) ?? "LONG").toUpperCase().includes("SHORT") ? "SHORT" : "LONG",
      conviction: str(p.conviction)?.toUpperCase() ?? null,
      thesis: str(p.thesis),
      key_signal: str(p.key_signal),
      entry_range: str(p.entry_range),
      target: str(p.target),
      stop: str(p.stop),
      options_play: str(p.options_play),
      score: num(p.score),
    });
  }
  // Published rank order, unknown ranks last — the member sees the edition's own order.
  return out.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
}

// ── Rendering pieces shared by both envelopes ──────────────────────────────────────

const NH_SOURCE_PIN = "Night Hawk publish pin (publish_context)";
const NH_SOURCE_VERDICT = "Night Hawk morning check (morning_verdict)";
const NH_SOURCE_LEDGER = "Night Hawk outcome ledger (nighthawk_play_outcomes)";

const NH_FOLLOWUPS = [
  "What is publish context?",
  "What is the morning confirmation?",
  "What is a pulled play?",
];

/** The pin as envelope evidence lines — spot/band geometry with SIGNED distances,
 *  regime + breadth, catalysts, and the score snapshot. Facts only: every line IS a
 *  value pinned at publish, cited to the pin. */
export function publishPinEvidence(pin: NhPublishPinLike): BieEvidence[] {
  const prov = { source: NH_SOURCE_PIN, asOf: pin.pinned_at };
  const ev: BieEvidence[] = [];
  ev.push({
    kind: "fact",
    text: `Tape at publish: spot ${fmtNum(pin.spot_at_publish)} · prior close ${fmtNum(pin.prior_close)} · ATR14 ${fmtNum(pin.atr14)}.`,
    provenance: prov,
  });
  const isLong = pin.direction !== "SHORT";
  // Only a STRONGLY away-from-market band earns the detached-band callout — the N-3
  // class starts around band-edge >1.5% beyond spot in the unfillable direction (the
  // PR-N3 gate's draft threshold). A few basis points of drift is normal geometry and
  // must not be dressed up as the failure signature.
  const detached =
    pin.band_distance_pct != null &&
    Math.abs(pin.band_distance_pct) >= 1.5 &&
    (isLong ? pin.band_distance_pct < 0 : pin.band_distance_pct > 0);
  ev.push({
    kind: "calc",
    text:
      `Band geometry (signed % of spot): entry band ${fmtNum(pin.entry_range_low)}–${fmtNum(pin.entry_range_high)}, ` +
      `nearest fillable edge ${fmtSignedPct(pin.band_distance_pct)} from spot` +
      (detached
        ? isLong
          ? " (strongly negative on a LONG = the band sits BELOW the market — the detached-band signature)"
          : " (strongly positive on a SHORT = the band sits ABOVE the market — the detached-band signature)"
        : "") +
      ` · target ${fmtNum(pin.target)} (${fmtSignedPct(pin.target_distance_pct)}) · stop ${fmtNum(pin.stop)} (${fmtSignedPct(pin.stop_distance_pct)}).`,
    provenance: prov,
  });
  const mk = pin.market;
  ev.push({
    kind: "fact",
    text: `Evening market state: regime ${mk.composite_regime ?? "—"} · tide ${mk.tide_bias ?? "—"} · VIX IV rank ${fmtNum(mk.vix_iv_rank)} · VIX close ${fmtNum(mk.vix_close)} · SPX close ${fmtNum(mk.spx_close)}.`,
    provenance: prov,
  });
  if (mk.breadth) {
    ev.push({
      kind: "fact",
      text: `Breadth at publish: ${fmtNum(mk.breadth.pct_advancing, 1)}% advancing · A/D ratio ${fmtNum(mk.breadth.advance_decline_ratio)} · ${fmtNum(mk.breadth.pct_above_vwap, 1)}% above VWAP.`,
      provenance: prov,
    });
  }
  const c = pin.catalysts;
  ev.push({
    kind: "fact",
    text:
      `Catalyst knowledge at publish: earnings tomorrow ${c.earnings_tomorrow ? `YES (${c.earnings_date ?? "date unrecorded"})` : "no"}` +
      ` · earnings risk ${c.earnings_risk ? "flagged" : "not flagged"}` +
      (c.catalyst_flags.length ? ` · flags: ${c.catalyst_flags.join(", ")}` : "") +
      ".",
    provenance: prov,
  });
  const scoreBits: string[] = [];
  if (pin.score != null) scoreBits.push(`score ${fmtNum(pin.score, 1)}`);
  if (pin.conviction) scoreBits.push(`conviction ${pin.conviction}`);
  if (pin.confluence) {
    // Whitelist-style scalar walk of the scorer's confluence snapshot — only primitive
    // numbers that exist are printed (the blob's shape is owned by the scoring lane).
    for (const [k, v] of Object.entries(pin.confluence)) {
      if (scoreBits.length >= 8) break;
      if (typeof v === "number" && Number.isFinite(v)) scoreBits.push(`${k.replace(/_/g, " ")} ${fmtNum(v, 2)}`);
    }
  }
  if (scoreBits.length) {
    ev.push({ kind: "fact", text: `Score snapshot at publish: ${scoreBits.join(" · ")}.`, provenance: prov });
  }
  return ev;
}

/** One member-readable line for the persisted 9:15 verdict — the NUMBERS it saw. */
export function morningVerdictLine(v: NhMorningVerdictLike): string {
  const m = v.metrics;
  const numbers = m
    ? ` Numbers seen: pre-market ${fmtNum(m.stock_premarket)} · SPX gap ${m.overnight_gap_pts != null ? `${m.overnight_gap_pts > 0 ? "+" : ""}${fmtNum(m.overnight_gap_pts, 1)} pts` : "—"} (${fmtSignedPct(m.overnight_gap_pct)}) · pre-market vs stop ${fmtSignedPct(m.premarket_vs_stop_pct)} · vs band ${fmtSignedPct(m.premarket_vs_band_pct)}${m.regime ? ` · regime ${m.regime}` : ""}.`
    : " No metrics were recorded with this verdict.";
  return `Morning check${v.checked_at ? ` (${v.checked_at})` : ""}: ${v.status}${v.reason ? ` — ${v.reason}` : ""}.${numbers}`;
}

/** Grade sentence + methodology for a graded row; null while still pending. */
export function gradeText(row: NhOutcomeRowLike): string | null {
  if (row.outcome === "pending") return null;
  const mid = entryRangeMid(row.entry_range_low, row.entry_range_high);
  const ret =
    mid != null && row.next_day_close != null && mid !== 0
      ? ((row.direction === "LONG" ? row.next_day_close - mid : mid - row.next_day_close) / mid) * 100
      : null;
  const numbers = ` (open ${fmtNum(row.next_day_open)} · close ${fmtNum(row.next_day_close)} · session ${fmtNum(row.session_low)}–${fmtNum(row.session_high)}${ret != null ? ` · realized vs entry mid ${fmtSignedPct(ret)}` : ""})`;
  switch (row.outcome) {
    case "target":
      return `Graded TARGET — the session reached the published target${numbers}.`;
    case "stop":
      return `Graded STOP — the session hit the published stop${numbers}.`;
    case "open":
      return `Graded OPEN — the session closed without hitting target or stop${numbers}.`;
    case "ambiguous":
      return `Graded AMBIGUOUS — both target and stop traded in the same session and the open decided neither, so it is never scored as a win${numbers}.`;
    case "unfilled":
      return `Graded UNFILLED — the session never traded back into the published entry band, so no fill at the published entry ever existed. Excluded from win/loss tallies (a phantom fill must inflate nothing)${numbers}.`;
    default:
      return `Graded ${String(row.outcome).toUpperCase()}${numbers}.`;
  }
}

/** PULLED sentence: the latch, its reason, its clock, and the exclusion rule. */
function pulledText(row: NhOutcomeRowLike): string {
  return `PULLED pre-open${row.pulled_at ? ` at ${row.pulled_at}` : ""} — ${row.pulled_reason ?? "no reason sentence recorded"}. The pull latch is one-way: once pulled, the play stays visible at its published rank but is non-actionable. ${NH_PULLED_EXCLUSION_NOTE}`;
}

// ── Pure envelope builders (exported for hermetic tests) ───────────────────────────

/**
 * The edition envelope: one section per ranked play, each carrying its pinned
 * publish-context evidence block, pulled state, morning verdict, and grade. PURE —
 * callers do the IO. Rows are joined to plays by UPPERCASED ticker; a play with no
 * outcome row still renders (honestly noted), and honesty per row: no pin → the
 * pre-pinning statement, never a reconstruction.
 */
export function buildNighthawkEditionEnvelope(
  edition: NhEditionRowLike,
  rows: NhOutcomeRowLike[]
): BieAnswerEnvelope {
  const plays = parseEditionPlays(edition.plays);
  const rowByTicker = new Map(rows.map((r) => [r.ticker.toUpperCase(), r]));

  if (plays.length === 0) {
    // Recap-only edition — a real published state, presented as itself.
    return makeEnvelope({
      headline: `Night Hawk ${edition.edition_for} — recap-only edition, no ranked plays`,
      bias: "neutral",
      intent: "nighthawk_edition",
      sections: [
        {
          title: "No plays survived the funnel",
          body: [
            edition.recap_headline ? `**${edition.recap_headline}**` : null,
            edition.recap_summary,
            "This edition published a market recap but no ranked plays — an honest empty playbook, not a failure to publish. No forced trades.",
          ]
            .filter(Boolean)
            .join("\n"),
          provenance: { source: "Night Hawk edition (nighthawk_editions)", asOf: edition.published_at },
        },
      ],
      evidence: [],
      confidence: {
        level: "high",
        why: "The published edition row read directly — a recap-only edition is itself the answer.",
      },
      followups: ["What does Night Hawk do?", ...NH_FOLLOWUPS.slice(0, 2)],
      asOf: edition.published_at ?? undefined,
    });
  }

  const pulledCount = plays.filter((p) => rowByTicker.get(p.ticker)?.pulled === true).length;
  const sections: BieAnswerEnvelope["sections"] = [];
  const unavailableSources: BieUnavailableSource[] = [];

  for (const play of plays.slice(0, 6)) {
    const row = rowByTicker.get(play.ticker) ?? null;
    const pin = readNighthawkPublishPin(row?.publish_context ?? null);
    const verdict = readNighthawkMorningVerdict(row?.morning_verdict ?? null);
    const pulled = row?.pulled === true;
    const grade = row ? gradeText(row) : null;

    const titleBits = [
      `#${play.rank ?? "—"} ${play.ticker} ${play.direction}`,
      play.conviction ? `conviction ${play.conviction}` : null,
      pulled ? "PULLED" : null,
    ].filter(Boolean);

    const bodyParts: string[] = [];
    if (play.thesis) bodyParts.push(play.thesis);
    bodyParts.push(
      `Published levels: entry ${play.entry_range ?? "—"} · target ${play.target ?? "—"} · stop ${play.stop ?? "—"}${play.options_play ? ` · options: ${play.options_play}` : ""}.`
    );
    if (pulled && row) bodyParts.push(pulledText(row));
    if (verdict) bodyParts.push(morningVerdictLine(verdict));
    if (grade) bodyParts.push(grade);
    if (!row) {
      bodyParts.push(
        "No outcome row on record for this play (publish-time sync did not write one) — no pinned decision context or verdict exists for it."
      );
    } else if (!pin) {
      bodyParts.push(NH_PRE_PINNING_NOTE);
      unavailableSources.push({
        source: `${NH_SOURCE_PIN} · ${play.ticker}`,
        reason: "published before evidence pinning — no decision context on record",
      });
    }

    sections.push({
      title: titleBits.join(" · "),
      body: bodyParts.join("\n"),
      bias: pulled ? "neutral" : play.direction === "LONG" ? "bullish" : "bearish",
      evidence: pin ? publishPinEvidence(pin) : [],
      provenance: { source: NH_SOURCE_LEDGER, asOf: pin?.pinned_at ?? edition.published_at },
    });
  }

  const pinnedCount = plays.filter((p) =>
    readNighthawkPublishPin(rowByTicker.get(p.ticker)?.publish_context ?? null)
  ).length;

  return makeEnvelope({
    headline: `Night Hawk edition for ${edition.edition_for} — ${plays.length} ranked play${plays.length === 1 ? "" : "s"}${pulledCount ? `, ${pulledCount} PULLED` : ""}`,
    bias: "neutral",
    intent: "nighthawk_edition",
    sections,
    evidence: [],
    confidence:
      pinnedCount > 0
        ? {
            level: "high",
            why: `Pinned publish-time evidence on ${pinnedCount} of ${plays.length} plays — the decision context of record, exactly what the builder saw at publish.`,
          }
        : {
            level: "moderate",
            why: "The published edition row is on record, but no play carries pinned decision context (published before evidence pinning).",
          },
    unavailableSources,
    followups: [`Why was ${plays[0]!.ticker} picked?`, ...NH_FOLLOWUPS.slice(0, 2)],
    asOf: edition.published_at ?? undefined,
  });
}

/**
 * One play's full story: why picked (the pin), what the morning saw (the persisted
 * verdict), whether pulled and why, how it graded. PURE — callers do the IO.
 * `play` is the matching edition JSONB entry when readable (adds the thesis), null
 * otherwise — the outcome row alone still tells the decision story.
 */
export function buildNighthawkPickWhyEnvelope(
  row: NhOutcomeRowLike,
  play: NhEditionPlayLike | null
): BieAnswerEnvelope {
  const T = row.ticker.toUpperCase();
  const pin = readNighthawkPublishPin(row.publish_context ?? null);
  const verdict = readNighthawkMorningVerdict(row.morning_verdict ?? null);
  const pulled = row.pulled === true;
  const grade = gradeText(row);
  const bias: BieBias = pulled ? "neutral" : row.direction === "LONG" ? "bullish" : "bearish";

  const headlineBits = [
    `Why ${T} was picked — Night Hawk ${row.edition_for} edition`,
    pulled ? "PULLED pre-open" : null,
    row.outcome !== "pending" ? `graded ${row.outcome}` : null,
  ].filter(Boolean);

  const sections: BieAnswerEnvelope["sections"] = [];
  const unavailableSources: BieUnavailableSource[] = [];

  // 1) Why it was picked — the pinned publish context, or the honest pre-pinning note.
  if (pin) {
    sections.push({
      title: "Why it was picked (pinned at publish)",
      body: [
        play?.thesis ? `Published thesis: ${play.thesis}` : null,
        play?.key_signal ? `Key signal: ${play.key_signal}` : null,
        `${T} published ${row.direction} at conviction ${row.conviction}${row.score != null ? `, score ${fmtNum(row.score, 1)}` : ""}. The evidence block below is the pin written when the edition FIRST published (first-write-wins) — what the builder actually saw that evening, never re-derived.`,
      ]
        .filter(Boolean)
        .join("\n"),
      bias,
      evidence: publishPinEvidence(pin),
      provenance: { source: NH_SOURCE_PIN, asOf: pin.pinned_at },
    });
  } else {
    sections.push({
      title: "Why it was picked",
      body: [
        play?.thesis ? `Published thesis: ${play.thesis}` : null,
        `${T} published ${row.direction} at conviction ${row.conviction}${row.score != null ? `, score ${fmtNum(row.score, 1)}` : ""}. ${NH_PRE_PINNING_NOTE}`,
      ]
        .filter(Boolean)
        .join("\n"),
      bias,
      provenance: { source: NH_SOURCE_LEDGER, asOf: null },
    });
    unavailableSources.push({
      source: NH_SOURCE_PIN,
      reason: "published before evidence pinning — no decision context on record",
    });
  }

  // 2) What the morning check saw — the persisted verdict with its numbers, or honest absence.
  if (verdict) {
    sections.push({
      title: "What the morning check saw",
      body: morningVerdictLine(verdict),
      provenance: { source: NH_SOURCE_VERDICT, asOf: verdict.checked_at },
    });
  } else {
    sections.push({
      title: "What the morning check saw",
      body: "No morning verdict is on record for this play — either the 9:15 check pre-dates verdict persistence or it did not run for this edition. Nothing is reconstructed in its place.",
      provenance: { source: NH_SOURCE_VERDICT, asOf: null },
    });
    unavailableSources.push({ source: NH_SOURCE_VERDICT, reason: "no persisted verdict for this play" });
  }

  // 3) Pulled state — only rendered when the latch engaged (an active play needs no section).
  if (pulled) {
    sections.push({
      title: "Pulled",
      body: pulledText(row),
      provenance: { source: NH_SOURCE_LEDGER, asOf: row.pulled_at ?? null },
    });
  }

  // 4) How it graded.
  sections.push({
    title: "How it graded",
    body: grade ?? "Not graded yet — the outcome is still pending (grades land after the target session closes).",
    provenance: { source: NH_SOURCE_LEDGER, asOf: null },
  });

  return makeEnvelope({
    headline: headlineBits.join(" · "),
    bias,
    intent: "nighthawk_edition",
    sections,
    evidence: [],
    confidence: pin
      ? {
          level: "high",
          why: "Pinned publish-time evidence from the outcome ledger — the WHY of record, exactly what the builder saw when this play published.",
        }
      : {
          level: "moderate",
          why: "The publish itself is on record, but no decision context was pinned (pre-pinning row) — the WHY cannot be reconstructed honestly.",
        },
    unavailableSources,
    followups: ["Show tonight's playbook", ...NH_FOLLOWUPS.slice(0, 2)],
  });
}

/** Honest miss: the ticker was never published in a Night Hawk edition on record. */
export function buildNighthawkPickNotFoundEnvelope(ticker: string, dateYmd: string | null): BieAnswerEnvelope {
  const T = ticker.toUpperCase();
  return makeEnvelope({
    headline: dateYmd
      ? `${T} is not in the ${dateYmd} Night Hawk edition`
      : `${T} has never appeared in a published Night Hawk edition on record`,
    bias: "neutral",
    intent: "nighthawk_edition",
    sections: [
      {
        title: "No publish on record",
        body: `No Night Hawk outcome row exists for ${T}${dateYmd ? ` in the ${dateYmd} edition` : ""} — it was never published${dateYmd ? " that night" : ""}, so there is no publish pin, morning verdict, or grade to explain. (A candidate rejected before publish never reaches this ledger; its rejection is logged in the audit trail instead.)`,
        provenance: { source: NH_SOURCE_LEDGER, asOf: null },
      },
    ],
    evidence: [],
    confidence: {
      level: "high",
      why: "The outcome ledger was read directly — an empty record is itself the honest answer.",
    },
    followups: ["Show tonight's playbook", ...NH_FOLLOWUPS.slice(0, 2)],
  });
}

/** Honest empty/outage states for the edition read. */
export function buildNighthawkNoEditionEnvelope(dateYmd: string | null, unreadable: boolean): BieAnswerEnvelope {
  return makeEnvelope({
    headline: unreadable
      ? "Night Hawk edition unreadable this turn"
      : dateYmd
        ? `No Night Hawk edition on record for ${dateYmd}`
        : "No Night Hawk edition on record yet",
    bias: "neutral",
    intent: "nighthawk_edition",
    sections: [
      {
        title: unreadable ? "Store unreachable" : "Nothing published",
        body: unreadable
          ? "The edition store could not be read this turn — no edition is being invented in its place. Try again shortly."
          : dateYmd
            ? `No edition was published for ${dateYmd}. Editions publish after the close for the NEXT trading session; ask without a date for the latest playbook.`
            : "No published edition exists in the store. Tonight's edition publishes after the close — five ranked plays land automatically.",
        provenance: { source: "Night Hawk edition (nighthawk_editions)", asOf: null },
      },
    ],
    evidence: [],
    confidence: unreadable
      ? { level: "insufficient", why: "The edition store read failed — nothing to present." }
      : { level: "high", why: "The edition store was read directly — an empty record is itself the honest answer." },
    unavailableSources: unreadable ? [{ source: "Night Hawk edition store", reason: "read failed" }] : [],
    followups: ["What does Night Hawk do?", ...NH_FOLLOWUPS.slice(0, 2)],
  });
}

// ── IO: edition + outcome rows (dynamic RELATIVE imports, read-only, fail-soft) ─────

type EditionLookup = { row: NhEditionRowLike | null; unreadable: boolean };

async function editionRowFor(dateYmd: string | null): Promise<EditionLookup> {
  try {
    const db = await import("../db");
    if (!db.dbConfigured()) return { row: null, unreadable: true };
    if (dateYmd) return { row: await db.fetchNighthawkEditionByDate(dateYmd), unreadable: false };
    // Default: the latest edition that actually carries plays (the playbook members
    // see), falling back to the latest row of any kind (recap-only nights are real).
    const playable = await db.fetchLatestPlayableNighthawkEdition().catch(() => null);
    if (playable) return { row: playable, unreadable: false };
    return { row: await db.fetchLatestNighthawkEdition(), unreadable: false };
  } catch {
    return { row: null, unreadable: true };
  }
}

/** Map one raw pg row structurally (numeric columns can arrive as strings). */
function mapOutcomeRow(r: Record<string, unknown>): NhOutcomeRowLike {
  const n = (v: unknown): number | null => {
    if (v == null) return null;
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  };
  // pg returns DATE columns as JS Date objects — same normalization as db.ts's
  // isoDateString (a plain String(Date) would render "Mon Jul 14 2026 …").
  const editionFor =
    r.edition_for instanceof Date
      ? r.edition_for.toISOString().slice(0, 10)
      : String(r.edition_for ?? "").slice(0, 10);
  return {
    edition_for: editionFor,
    ticker: String(r.ticker ?? "").toUpperCase(),
    direction: String(r.direction ?? "LONG") === "SHORT" ? "SHORT" : "LONG",
    conviction: String(r.conviction ?? ""),
    score: n(r.score),
    entry_range_low: n(r.entry_range_low),
    entry_range_high: n(r.entry_range_high),
    target: n(r.target),
    stop: n(r.stop),
    next_day_open: n(r.next_day_open),
    next_day_close: n(r.next_day_close),
    session_high: n(r.session_high),
    session_low: n(r.session_low),
    hit_target: r.hit_target === true,
    hit_stop: r.hit_stop === true,
    outcome: String(r.outcome ?? "pending") as NhOutcomeRowLike["outcome"],
    pulled: r.pulled === true,
    pulled_reason: r.pulled_reason != null ? String(r.pulled_reason) : null,
    pulled_at: r.pulled_at != null ? new Date(String(r.pulled_at)).toISOString() : null,
    publish_context: (r.publish_context as Record<string, unknown> | null) ?? null,
    morning_verdict: (r.morning_verdict as Record<string, unknown> | null) ?? null,
  };
}

const OUTCOME_COLUMNS = `edition_for, ticker, direction, conviction, score,
       entry_range_low, entry_range_high, target, stop,
       next_day_open, next_day_close, session_high, session_low,
       hit_target, hit_stop, outcome, pulled, pulled_reason, pulled_at,
       publish_context, morning_verdict`;

async function outcomeRowsForEdition(editionFor: string): Promise<NhOutcomeRowLike[]> {
  try {
    const db = await import("../db");
    if (!db.dbConfigured()) return [];
    const res = await db.dbQuery(
      `SELECT ${OUTCOME_COLUMNS}
       FROM nighthawk_play_outcomes
       WHERE edition_for = $1::date
       ORDER BY ticker ASC`,
      [editionFor]
    );
    return res.rows.map((r) => mapOutcomeRow(r as Record<string, unknown>));
  } catch {
    // Fail-soft: the edition still renders from its own row; per-play sections then
    // say "no outcome row on record" honestly rather than blocking the answer.
    return [];
  }
}

async function outcomeRowForTicker(ticker: string, dateYmd: string | null): Promise<NhOutcomeRowLike | null> {
  try {
    const db = await import("../db");
    if (!db.dbConfigured()) return null;
    const res = dateYmd
      ? await db.dbQuery(
          `SELECT ${OUTCOME_COLUMNS}
           FROM nighthawk_play_outcomes
           WHERE ticker = $1 AND edition_for = $2::date
           LIMIT 1`,
          [ticker.toUpperCase(), dateYmd]
        )
      : await db.dbQuery(
          `SELECT ${OUTCOME_COLUMNS}
           FROM nighthawk_play_outcomes
           WHERE ticker = $1
           ORDER BY edition_for DESC
           LIMIT 1`,
          [ticker.toUpperCase()]
        );
    const r = res.rows[0];
    return r ? mapOutcomeRow(r as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The edition read: ranked plays with pinned evidence, pulled state, morning verdicts
 * and grades. `dateYmd` scopes to one edition (YYYY-MM-DD); default is the latest
 * playable edition. Never throws — outages return the honest "unreadable" envelope.
 */
export async function readNighthawkEdition(dateYmd?: string): Promise<BieComposed> {
  const { row, unreadable } = await editionRowFor(dateYmd ?? null);
  if (!row) {
    const envelope = buildNighthawkNoEditionEnvelope(dateYmd ?? null, unreadable);
    return { answer: envelope.markdown, context: { mode: unreadable ? "unreadable" : "empty", date: dateYmd ?? null }, envelope };
  }
  const rows = await outcomeRowsForEdition(row.edition_for);
  const envelope = buildNighthawkEditionEnvelope(row, rows);
  return {
    answer: envelope.markdown,
    context: {
      mode: "edition",
      edition_for: row.edition_for,
      plays: parseEditionPlays(row.plays).length,
      pulled: rows.filter((r) => r.pulled === true).length,
      pinned: rows.filter((r) => readNighthawkPublishPin(r.publish_context ?? null) != null).length,
    },
    envelope,
  };
}

/**
 * One play's full decision story. Without `dateYmd` the MOST RECENT publish of the
 * ticker is the record explained (the outcome row is the anchor; the edition JSONB
 * adds the thesis when readable). Honest misses; never throws.
 */
export async function readNighthawkPickWhy(ticker: string, dateYmd?: string): Promise<BieComposed> {
  const T = ticker.toUpperCase().trim();
  const row = T ? await outcomeRowForTicker(T, dateYmd ?? null) : null;
  if (!row) {
    const envelope = buildNighthawkPickNotFoundEnvelope(T || ticker, dateYmd ?? null);
    return { answer: envelope.markdown, context: { mode: "not_found", ticker: T, date: dateYmd ?? null }, envelope };
  }
  // The edition JSONB entry for the thesis — fail-soft: the row alone still answers.
  let play: NhEditionPlayLike | null = null;
  try {
    const db = await import("../db");
    const edition = await db.fetchNighthawkEditionByDate(row.edition_for);
    play = edition ? (parseEditionPlays(edition.plays).find((p) => p.ticker === T) ?? null) : null;
  } catch {
    play = null;
  }
  const envelope = buildNighthawkPickWhyEnvelope(row, play);
  return {
    answer: envelope.markdown,
    context: {
      mode: "pick_why",
      ticker: T,
      edition_for: row.edition_for,
      pulled: row.pulled === true,
      pinned: readNighthawkPublishPin(row.publish_context ?? null) != null,
      has_morning_verdict: readNighthawkMorningVerdict(row.morning_verdict ?? null) != null,
      outcome: row.outcome,
    },
    envelope,
  };
}

/** YYYY-MM-DD named in the question, if any — lets "the 2026-07-10 edition" scope. */
function dateFromQuestion(question: string): string | undefined {
  return question.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
}

/**
 * Router glue for the `nighthawk_edition` intent: a ticker → that pick's full story;
 * no ticker → the edition read. An explicit YYYY-MM-DD in the question scopes the read.
 */
export async function composeNighthawkEditionRead(ticker: string | null, question: string): Promise<BieComposed> {
  const dateYmd = dateFromQuestion(question);
  if (ticker) return readNighthawkPickWhy(ticker, dateYmd);
  return readNighthawkEdition(dateYmd);
}

// ── Compact citation for the OTHER intents (ticker_advice / ticker_play_state) ─────

/** Compact edition citation another synthesis folds in alongside its own inputs. */
export type NighthawkEditionCitation = {
  /** "CSX LONG · conviction B — in the 2026-07-14 Night Hawk edition (PULLED pre-open)" */
  headline: string;
  /** Up to 3 detail lines (band geometry / regime / verdict-or-grade). */
  lines: string[];
  asOf: string | null;
};

/**
 * The Night Hawk edition evidence another intent cites when the ticker is in the
 * CURRENT edition (edition_for ≥ today ET — tonight's playbook or the one trading
 * today). PINNED-ONLY and hot-path cheap by design: ONE ledger read, no edition-JSON
 * fetch, no live composition (mirrors #327's pinned-only cortexCitationFor mode).
 * Returns null when the ticker isn't in the current edition. Never throws.
 */
export async function nighthawkEditionCitationFor(ticker: string): Promise<NighthawkEditionCitation | null> {
  const T = ticker.toUpperCase().trim();
  if (!T) return null;
  try {
    const [db, session] = await Promise.all([
      import("../db"),
      import("../../features/nighthawk/lib/session"),
    ]);
    if (!db.dbConfigured()) return null;
    const res = await db.dbQuery(
      `SELECT ${OUTCOME_COLUMNS}
       FROM nighthawk_play_outcomes
       WHERE ticker = $1 AND edition_for >= $2::date
       ORDER BY edition_for DESC
       LIMIT 1`,
      [T, session.todayEt()]
    );
    const raw = res.rows[0];
    if (!raw) return null;
    const row = mapOutcomeRow(raw as Record<string, unknown>);
    const pin = readNighthawkPublishPin(row.publish_context ?? null);
    const verdict = readNighthawkMorningVerdict(row.morning_verdict ?? null);

    const headline = `${row.ticker} ${row.direction} · conviction ${row.conviction} — in the ${row.edition_for} Night Hawk edition${row.pulled ? " (PULLED pre-open)" : ""}`;
    const lines: string[] = [];
    if (row.pulled) {
      lines.push(`Pulled: ${row.pulled_reason ?? "no reason sentence recorded"} — non-actionable, counterfactual-only grade.`);
    }
    if (pin) {
      lines.push(
        `Pinned at publish: spot ${fmtNum(pin.spot_at_publish)}, band edge ${fmtSignedPct(pin.band_distance_pct)} from spot, target ${fmtSignedPct(pin.target_distance_pct)}, stop ${fmtSignedPct(pin.stop_distance_pct)}.`
      );
      lines.push(
        `Evening state: regime ${pin.market.composite_regime ?? "—"} · tide ${pin.market.tide_bias ?? "—"}${pin.catalysts.earnings_tomorrow ? " · EARNINGS into the session" : ""}.`
      );
    } else {
      lines.push("Published before evidence pinning — no decision context on record.");
    }
    if (verdict && !row.pulled && lines.length < 3) {
      lines.push(`Morning check: ${verdict.status}${verdict.reason ? ` — ${verdict.reason}` : ""}.`);
    }
    return { headline, lines: lines.slice(0, 3), asOf: pin?.pinned_at ?? null };
  } catch {
    return null;
  }
}

/** Markdown block for a citation — the string composers append to their answers. */
export function renderNighthawkEditionCitation(c: NighthawkEditionCitation): string {
  const out = [`**Night Hawk edition (overnight, pinned):** ${c.headline}`];
  for (const l of c.lines) out.push(`- ${l}`);
  return out.join("\n");
}

// BLACKOUT Intelligence Engine — SPX LIVE VOICE (the "Largo live commentary" brain).
//
// One deterministic module (no LLM, no I/O, no Date.now inside the composers) that turns
// the merged SPX desk payload into what a professional 0DTE SPX day trader actually acts
// on, per the 2026-07-13 directive:
//   1. a BIAS read — direction + conviction (how many independent signals agree) +
//      the dealer mechanic + a posture (calls / puts / wait), voiced as a 3–4 sentence
//      point-in-time read with heat + emoji;
//   2. at most 3 TRIGGER levels — only the ones whose break would CHANGE the bias;
//   3. a transition-only EVENT feed — king-wall migrations, wall build/fade, γ-flip
//      crossings, VWAP reclaim/reject, EMA-stack flips, structure breaks, expected-move
//      edge tags, VIX/tide shifts, play lifecycle — each a single line with its trade
//      implication, keyed for dedupe so an unchanged tape prints (almost) nothing.
//
// It is deliberately isomorphic: the SpxCommentaryRail runs it client-side on every desk
// tick (that is where transitions actually happen), and the /api/market/spx/commentary
// route + Largo terminal Q&A (spx-desk-brief.ts) run the SAME functions server-side, so
// every Largo surface speaks with one brain. Every number is used verbatim from the desk
// feed (or a documented arithmetic derivation of it) — grounded by construction.

import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";

// ---------------------------------------------------------------------------
// Snapshot — the normalized slice of the desk the voice reasons over.
// ---------------------------------------------------------------------------

export type SpxVoiceWall = { strike: number; netGex: number };

export type SpxVoiceSnapshot = {
  /** Epoch ms this snapshot represents (desk polled_at/as_of; injectable for tests). */
  at: number;
  price: number | null;
  vwap: number | null;
  /** True when the desk VWAP is genuinely volume-weighted (SPY minute-volume proxy). */
  vwapVolumeWeighted: boolean;
  gammaFlip: number | null;
  /** UW/desk max-pain strike; null when the chain didn't produce one — never guessed. */
  maxPain: number | null;
  /** price >= gammaFlip; null when either side is unknown. */
  aboveFlip: boolean | null;
  aboveVwap: boolean | null;
  ema20: number | null;
  ema50: number | null;
  /** price>ema20>ema50 → "bullish"; price<ema20<ema50 → "bearish"; else "mixed". */
  emaStack: "bullish" | "bearish" | "mixed" | null;
  /** Trend regime word from the desk (inferRegime): bullish/bearish/recovering/weak/neutral. */
  regime: string | null;
  /** Strongest resistance node (argmax |net_gex| among kind:"resistance") — the king call wall. */
  kingCall: SpxVoiceWall | null;
  /** Strongest support node (argmax |net_gex| among kind:"support") — the king put wall. */
  kingPut: SpxVoiceWall | null;
  /** Full wall ladder for build/fade lifecycle diffs. */
  walls: Array<SpxVoiceWall & { kind: "support" | "resistance" }>;
  hod: number | null;
  lod: number | null;
  pdh: number | null;
  pdl: number | null;
  /**
   * First-30-min opening range from the desk (computeIntradayRead) — high/low are real
   * session prices, `break` is the desk's own read, `forming` true during 9:30–10:00 ET.
   * Null whenever the desk didn't serve one (pre-open, missing bars) — never synthesized.
   */
  openingRange: {
    high: number;
    low: number;
    break: "above" | "below" | "inside" | null;
    forming: boolean;
  } | null;
  vix: number | null;
  vixChangePct: number | null;
  tideBias: string | null;
  /**
   * ±1σ expected-move band for TODAY, derived from prior close and VIX:
   * move = close · (VIX/100) / √252 (the standard 1-day 1σ). Null when either input
   * is missing — never fabricated.
   */
  expMove: { low: number; high: number } | null;
  /** Optional 5m RSI when the caller has technicals (server path); the desk feed has none. */
  rsi: number | null;
  /** Top news titles (for new-headline detection). */
  newsTitles: string[];
  /**
   * Most recent catalyst headline (desk Benzinga feed), by parseable `published` stamp.
   * `publishedAt` null = the feed gave no parseable timestamp (title still real, time
   * simply not shown). Null when the desk carried no headlines — no fabricated events.
   */
  latestHeadline: { title: string; publishedAt: number | null } | null;
  gexStale: boolean;
  feedStalled: boolean;
};

function num(v: number | null | undefined): number | null {
  return v != null && Number.isFinite(v) ? v : null;
}

/** Strike/level formatting — whole points with thousands separator (7,528). */
export function fmtLevel(v: number): string {
  return Math.round(v).toLocaleString("en-US");
}

function kingOfSide(
  walls: SpxDeskPayload["gex_walls"],
  kind: "support" | "resistance"
): SpxVoiceWall | null {
  let best: SpxVoiceWall | null = null;
  for (const w of walls ?? []) {
    if (w.kind !== kind) continue;
    const strike = num(w.strike);
    const netGex = num(w.net_gex);
    if (strike == null || netGex == null) continue;
    if (!best || Math.abs(netGex) > Math.abs(best.netGex)) best = { strike, netGex };
  }
  return best;
}

export function voiceSnapshotFromDesk(
  desk: SpxDeskPayload,
  opts?: { at?: number; rsi?: number | null }
): SpxVoiceSnapshot {
  const price = num(desk.price);
  const vwap = num(desk.vwap);
  const flip = num(desk.gamma_flip);
  const ema20 = num(desk.ema20);
  const ema50 = num(desk.ema50);

  let emaStack: SpxVoiceSnapshot["emaStack"] = null;
  if (price != null && ema20 != null && ema50 != null) {
    emaStack =
      price > ema20 && ema20 > ema50
        ? "bullish"
        : price < ema20 && ema20 < ema50
          ? "bearish"
          : "mixed";
  }

  // ±1σ expected move anchored to prior close (standard 1-day sigma from spot VIX).
  const close = num(desk.prior_close);
  const vix = num(desk.vix);
  let expMove: SpxVoiceSnapshot["expMove"] = null;
  if (close != null && close > 0 && vix != null && vix > 0) {
    const move = close * (vix / 100) / Math.sqrt(252);
    expMove = { low: Math.round(close - move), high: Math.round(close + move) };
  }

  // Opening range: only surfaced when the desk served BOTH real prices. `break`/`forming`
  // are passed through verbatim — the voice never re-derives OR state from price.
  const orRaw = desk.opening_range;
  const orHigh = num(orRaw?.high);
  const orLow = num(orRaw?.low);
  const openingRange: SpxVoiceSnapshot["openingRange"] =
    orRaw && orHigh != null && orLow != null
      ? { high: orHigh, low: orLow, break: orRaw.break ?? null, forming: orRaw.forming === true }
      : null;

  // Latest catalyst = max parseable `published` stamp; a title with no parseable stamp is
  // only used when nothing timestamped exists (and then rendered without a time).
  let latestHeadline: SpxVoiceSnapshot["latestHeadline"] = null;
  for (const n of desk.news_headlines ?? []) {
    const title = n.title?.trim();
    if (!title) continue;
    const ts = n.published ? Date.parse(n.published) : NaN;
    const publishedAt = Number.isFinite(ts) ? ts : null;
    if (
      !latestHeadline ||
      (publishedAt != null &&
        (latestHeadline.publishedAt == null || publishedAt > latestHeadline.publishedAt))
    ) {
      latestHeadline = { title, publishedAt };
    }
  }

  // NaN is falsy, so an unparseable/missing stamp falls through the || chain honestly.
  const fromDesk =
    (desk.polled_at ? new Date(desk.polled_at).getTime() : NaN) ||
    (desk.as_of ? new Date(desk.as_of).getTime() : NaN) ||
    Date.now();
  const at = opts?.at ?? fromDesk;

  return {
    at,
    price,
    vwap,
    vwapVolumeWeighted: desk.vwap_volume_weighted === true,
    gammaFlip: flip,
    maxPain: num(desk.max_pain),
    aboveFlip: price != null && flip != null ? price >= flip : null,
    aboveVwap: price != null && vwap != null ? price >= vwap : null,
    ema20,
    ema50,
    emaStack,
    regime: desk.regime || null,
    kingCall: kingOfSide(desk.gex_walls, "resistance"),
    kingPut: kingOfSide(desk.gex_walls, "support"),
    walls: (desk.gex_walls ?? [])
      .filter((w) => num(w.strike) != null && num(w.net_gex) != null)
      .map((w) => ({ strike: w.strike, netGex: w.net_gex, kind: w.kind })),
    hod: num(desk.hod),
    lod: num(desk.lod),
    pdh: num(desk.pdh),
    pdl: num(desk.pdl),
    openingRange,
    vix,
    vixChangePct: num(desk.vix_change_pct),
    tideBias: desk.tide_bias || null,
    expMove,
    rsi: num(opts?.rsi),
    newsTitles: (desk.news_headlines ?? [])
      .map((n) => n.title?.trim())
      .filter((t): t is string => Boolean(t))
      .slice(0, 8),
    latestHeadline,
    gexStale: desk.gex_stale ?? false,
    feedStalled: desk.feed_stalled ?? false,
  };
}

// ---------------------------------------------------------------------------
// Bias — direction + conviction from 4 independent signals.
// ---------------------------------------------------------------------------

export type SpxBiasDirection = "bullish" | "bearish" | "neutral";

export type SpxBiasVote = {
  signal: "γ-flip" | "VWAP" | "EMA stack" | "trend";
  /** +1 bull, -1 bear, 0 undecided (signal computable but not committed). */
  vote: 1 | 0 | -1;
};

export type SpxBiasRead = {
  direction: SpxBiasDirection;
  /** How many computable signals agree with the direction (spec: 4/4 = STRONG). */
  aligned: number;
  total: number;
  conviction: "STRONG" | "SOLID" | "LEAN" | "MIXED";
  votes: SpxBiasVote[];
  /**
   * Dedupe/state key: the bias is only "restated" when this changes (or on the
   * caller's periodic 5-min refresh). Deliberately excludes price so ordinary
   * ticks don't re-pin the card.
   */
  key: string;
};

export function deriveSpxBias(s: SpxVoiceSnapshot): SpxBiasRead {
  const votes: SpxBiasVote[] = [];
  if (s.aboveFlip != null) votes.push({ signal: "γ-flip", vote: s.aboveFlip ? 1 : -1 });
  if (s.aboveVwap != null) votes.push({ signal: "VWAP", vote: s.aboveVwap ? 1 : -1 });
  if (s.emaStack != null)
    votes.push({ signal: "EMA stack", vote: s.emaStack === "bullish" ? 1 : s.emaStack === "bearish" ? -1 : 0 });
  if (s.regime) {
    const v = s.regime === "bullish" ? 1 : s.regime === "bearish" ? -1 : 0;
    votes.push({ signal: "trend", vote: v });
  }

  const sum = votes.reduce((a, v) => a + v.vote, 0);
  const direction: SpxBiasDirection = sum > 0 ? "bullish" : sum < 0 ? "bearish" : "neutral";
  const total = votes.length;
  const aligned =
    direction === "neutral" ? 0 : votes.filter((v) => v.vote === (direction === "bullish" ? 1 : -1)).length;

  // Conviction ladder: every computable signal agrees → STRONG; one dissent/abstain →
  // SOLID; a bare majority → LEAN; no direction → MIXED. Requires ≥3 signals for
  // STRONG/SOLID so a thin pre-market payload (flip only) can't print false conviction.
  let conviction: SpxBiasRead["conviction"];
  if (direction === "neutral" || total === 0) conviction = "MIXED";
  else if (aligned === total && total >= 3) conviction = "STRONG";
  else if (aligned >= total - 1 && total >= 3) conviction = "SOLID";
  else conviction = "LEAN";

  return {
    direction,
    aligned,
    total,
    conviction,
    votes,
    key: [
      direction,
      conviction,
      `${aligned}/${total}`,
      s.aboveFlip == null ? "?" : s.aboveFlip ? "aF" : "bF",
      s.aboveVwap == null ? "?" : s.aboveVwap ? "aV" : "bV",
      s.emaStack ?? "?",
    ].join("|"),
  };
}

// ---------------------------------------------------------------------------
// Trigger levels — max 3, only ones that would CHANGE the bias.
// ---------------------------------------------------------------------------

export type SpxTriggerLevel = {
  level: number | null;
  tone: "bull" | "bear" | "warn";
  line: string;
};

/** Nearest overhead cap among VWAP / γ-flip / king call — where rallies meet supply. */
function overheadCap(s: SpxVoiceSnapshot): number | null {
  if (s.price == null) return null;
  const above = [s.vwap, s.gammaFlip, s.kingCall?.strike ?? null].filter(
    (v): v is number => v != null && v > s.price!
  );
  return above.length ? Math.min(...above) : null;
}

/** Nearest floor among VWAP / γ-flip / king put — where dips meet demand. */
function floorBelow(s: SpxVoiceSnapshot): number | null {
  if (s.price == null) return null;
  const below = [s.vwap, s.gammaFlip, s.kingPut?.strike ?? null].filter(
    (v): v is number => v != null && v < s.price!
  );
  return below.length ? Math.max(...below) : null;
}

export function deriveTriggerLevels(s: SpxVoiceSnapshot, bias: SpxBiasRead): SpxTriggerLevel[] {
  const out: SpxTriggerLevel[] = [];
  if (s.price == null) return out;

  if (bias.direction === "bearish") {
    // The reclaim level that flips the read: the HIGHER of VWAP/γ-flip overhead —
    // reclaiming it flips both structure votes, not just one.
    const reclaim = [s.vwap, s.gammaFlip].filter((v): v is number => v != null && v > s.price!);
    if (reclaim.length) {
      const lvl = Math.max(...reclaim);
      out.push({ level: lvl, tone: "bull", line: `reclaim ${fmtLevel(lvl)} → bias flips — calls window opens` });
    }
    if (s.kingPut && s.kingPut.strike < s.price) {
      out.push({
        level: s.kingPut.strike,
        tone: "bear",
        line: `lose ${fmtLevel(s.kingPut.strike)} put wall → acceleration lower — press puts`,
      });
    }
    const cap = overheadCap(s);
    if (s.kingPut && cap != null && s.kingPut.strike < s.price) {
      out.push({
        level: null,
        tone: "warn",
        line: `inside ${fmtLevel(s.kingPut.strike)}–${fmtLevel(cap)} = chop — scalp small or wait`,
      });
    }
  } else if (bias.direction === "bullish") {
    const lose = [s.vwap, s.gammaFlip].filter((v): v is number => v != null && v < s.price!);
    if (lose.length) {
      const lvl = Math.min(...lose);
      out.push({ level: lvl, tone: "bear", line: `lose ${fmtLevel(lvl)} → bias flips — puts window opens` });
    }
    if (s.kingCall && s.kingCall.strike > s.price) {
      out.push({
        level: s.kingCall.strike,
        tone: "bull",
        line: `break ${fmtLevel(s.kingCall.strike)} call wall → squeeze fuel above — press calls`,
      });
    }
    const floor = floorBelow(s);
    if (s.kingCall && floor != null && s.kingCall.strike > s.price) {
      out.push({
        level: null,
        tone: "warn",
        line: `inside ${fmtLevel(floor)}–${fmtLevel(s.kingCall.strike)} = chop — scalp small or wait`,
      });
    }
  } else {
    if (s.kingCall && s.kingCall.strike >= s.price) {
      out.push({
        level: s.kingCall.strike,
        tone: "bull",
        line: `above ${fmtLevel(s.kingCall.strike)} call wall → breakout — calls window`,
      });
    }
    if (s.kingPut && s.kingPut.strike <= s.price) {
      out.push({
        level: s.kingPut.strike,
        tone: "bear",
        line: `below ${fmtLevel(s.kingPut.strike)} put wall → breakdown — puts window`,
      });
    }
    out.push({ level: null, tone: "warn", line: "inside the walls = chop — stand down, let it pick a side" });
  }

  return out.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Bias header (one line) + rich 3–4 sentence voice.
// ---------------------------------------------------------------------------

function mechanismClause(s: SpxVoiceSnapshot, bias: SpxBiasRead): string {
  const parts: string[] = [];
  if (bias.direction === "bearish") {
    if (s.aboveVwap === false && s.aboveFlip === false) parts.push("below VWAP & γ-flip");
    else if (s.aboveVwap === false) parts.push("below VWAP");
    else if (s.aboveFlip === false) parts.push("below γ-flip");
  } else if (bias.direction === "bullish") {
    if (s.aboveVwap === true && s.aboveFlip === true) parts.push("above VWAP & γ-flip");
    else if (s.aboveVwap === true) parts.push("above VWAP");
    else if (s.aboveFlip === true) parts.push("above γ-flip");
  } else if (s.kingPut && s.kingCall) {
    parts.push(`pinned ${fmtLevel(s.kingPut.strike)}–${fmtLevel(s.kingCall.strike)} walls`);
  }

  if (s.aboveFlip === false) parts.push("short gamma amplifies moves");
  else if (s.aboveFlip === true) parts.push("positive gamma dampens moves");
  return parts.join(" · ");
}

function postureClause(s: SpxVoiceSnapshot, bias: SpxBiasRead): string {
  if (bias.direction === "bearish") {
    const cap = overheadCap(s);
    return cap != null ? `favor PUTS on rallies into ${fmtLevel(cap)}` : "favor PUTS on rallies";
  }
  if (bias.direction === "bullish") {
    const floor = floorBelow(s);
    return floor != null ? `favor CALLS on dips into ${fmtLevel(floor)}` : "favor CALLS on dips";
  }
  return "WAIT for a break or sell the chop";
}

/**
 * One-line pinned bias header, e.g.
 * "BEARISH · 4/4 aligned · below VWAP & γ-flip · short gamma amplifies moves → favor PUTS on rallies into 7,530"
 */
export function composeBiasHeaderLine(s: SpxVoiceSnapshot, bias: SpxBiasRead): string {
  const dir = bias.direction.toUpperCase();
  const align =
    bias.direction === "neutral" ? "signals split" : bias.total > 0 ? `${bias.aligned}/${bias.total} aligned` : "signals thin";
  const mech = mechanismClause(s, bias);
  const posture = postureClause(s, bias);
  return [dir, align, mech].filter(Boolean).join(" · ") + ` → ${posture}`;
}

/**
 * The BIE voice — a 3–4 sentence point-in-time read with heat + emoji, combining price
 * action, the dealer mechanic, the line-in-the-sand, and the posture. Every number is a
 * desk value (or its rounding); no {{ }} markers — this string renders as-is.
 */
export function composeBiasVoice(s: SpxVoiceSnapshot, bias: SpxBiasRead): string {
  const p = s.price != null ? fmtLevel(s.price) : "—";
  const sentences: string[] = [];

  if (bias.direction === "bearish") {
    const vs: string[] = [];
    if (s.vwap != null && s.aboveVwap === false) vs.push(`below VWAP ${fmtLevel(s.vwap)}`);
    if (s.gammaFlip != null && s.aboveFlip === false) vs.push(`below the γ-flip ${fmtLevel(s.gammaFlip)}`);
    const emaBit =
      s.emaStack === "bearish"
        ? " with the 20/50 EMAs stacked down"
        : s.emaStack === "mixed"
          ? " while the EMAs are still deciding"
          : "";
    sentences.push(
      `🔥 Sellers pressing — SPX ${p}${vs.length ? ` is ${vs.join(" and ")}` : ""}${emaBit} (${bias.aligned}/${bias.total} signals bearish).`
    );
    sentences.push(
      s.aboveFlip === false
        ? "Dealers are short gamma down here — they chase this move, not fade it, so drops feed themselves."
        : "Dealers are still long gamma, so this leans grind-lower rather than air-pocket — but the sellers have the tape."
    );
    if (s.kingPut) {
      const cap = overheadCap(s);
      sentences.push(
        `${fmtLevel(s.kingPut.strike)} put wall is the line — lose it and the tape accelerates lower${cap != null ? `; pops into ${fmtLevel(cap)} are supply` : ""}.`
      );
    }
    sentences.push(`PUTS on rallies or stand aside — no chasing extended candles. ⚠️`);
  } else if (bias.direction === "bullish") {
    const vs: string[] = [];
    if (s.vwap != null && s.aboveVwap === true) vs.push(`above VWAP ${fmtLevel(s.vwap)}`);
    if (s.gammaFlip != null && s.aboveFlip === true) vs.push(`above the γ-flip ${fmtLevel(s.gammaFlip)}`);
    const emaBit =
      s.emaStack === "bullish"
        ? " with the 20/50 EMAs stacked up"
        : s.emaStack === "mixed"
          ? " while the EMAs are still deciding"
          : "";
    sentences.push(
      `🚀 Buyers in control — SPX ${p}${vs.length ? ` is ${vs.join(" and ")}` : ""}${emaBit} (${bias.aligned}/${bias.total} signals bullish).`
    );
    sentences.push(
      s.aboveFlip === true
        ? "Dealers are long gamma up here — they buy the dips back, so pullbacks are for entries, not panic."
        : "Still below the γ-flip, so this bounce runs on short-gamma fuel — fast both ways, keep stops honest."
    );
    if (s.kingCall) {
      const floor = floorBelow(s);
      const dipBit = floor != null ? `; dips into ${fmtLevel(floor)} are demand` : "";
      sentences.push(
        s.price != null && s.price > s.kingCall.strike
          ? `Already through the ${fmtLevel(s.kingCall.strike)} call wall — shorts overhead are fuel, not resistance${dipBit}.`
          : `${fmtLevel(s.kingCall.strike)} call wall is the cap overhead — through it and dealers chase higher${dipBit}.`
      );
    }
    sentences.push(`CALLS on dips or ride the trend — don't buy the top tick of a vertical. ⚠️`);
  } else {
    const pinBit =
      s.kingPut && s.kingCall
        ? `pinned between the ${fmtLevel(s.kingPut.strike)} put wall and the ${fmtLevel(s.kingCall.strike)} call wall`
        : "stuck in two-way tape";
    const vwapBit = s.vwap != null ? `, ${s.aboveVwap ? "just above" : "just below"} VWAP ${fmtLevel(s.vwap)}` : "";
    sentences.push(`⚖️ No edge yet — SPX ${p} is ${pinBit}${vwapBit} (signals split).`);
    sentences.push(
      s.aboveFlip === true
        ? "Positive gamma has dealers fading both directions, so pushes get sold and dips get bought — chop is the trade they're forcing."
        : s.aboveFlip === false
          ? "Short gamma with no direction is the trap zone — whipsaw cuts both ways, so a break can run hard once it picks a side."
          : "No clean gamma read — treat every level as unconfirmed until positioning updates."
    );
    if (s.kingCall && s.kingPut) {
      sentences.push(
        `Above ${fmtLevel(s.kingCall.strike)} it's a breakout, below ${fmtLevel(s.kingPut.strike)} it's a breakdown — inside is theta burn.`
      );
    }
    sentences.push(`WAIT for the break — forcing trades in chop bleeds accounts. 🫡`);
  }

  if (s.gexStale || s.feedStalled) {
    // Data honesty: never voice stale walls/flip as live conviction.
    sentences.push("⚠️ Positioning data is stale right now — treat walls and flip as approximate, size down.");
  }

  return sentences.join(" ");
}

// ---------------------------------------------------------------------------
// Context composers — deterministic, grounded add-ons (2026-07-13 hardening).
//
// Every function below returns null (or []) when its inputs are missing/stale —
// "say less, never guess". The ONLY arithmetic ever applied to a desk number is:
//   • point distance:  |spot − level|, rounded to 1 decimal (ptsAway)
//   • expected-move geometry: half-width (high−low)/2, midpoint (high+low)/2,
//     and %-of-band-used |spot − mid| / half · 100 (rounded)
// These are the documented allowed derivations enforced by the
// spx-live-voice.guard test — anything else in an output string is a bug.
// ---------------------------------------------------------------------------

/** |spot − level| in index points, 1-decimal — the only distance math in this module. */
function ptsAway(price: number, level: number): number {
  return Math.round(Math.abs(price - level) * 10) / 10;
}

function fmtPts(v: number): string {
  return v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Deterministic ET clock rendering for timestamps that came in as epoch ms. */
export function fmtEtTime(ms: number): string {
  return (
    new Date(ms).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    }) + " ET"
  );
}

export type SpxWatchLevel = {
  label: string;
  level: number;
  /** Where the level sits relative to spot (ties count as above). */
  side: "above" | "below";
  /** ptsAway(spot, level) — live point distance, 1 decimal. */
  distancePts: number;
  tone: "bull" | "bear" | "warn";
  line: string;
};

/**
 * Levels-to-watch (enhancement a): the ≤3 NEAREST actionable levels with live point
 * distance + a deterministic "what it means if crossed" template per level type.
 * Proximity-sorted, deduped by rounded strike so VWAP==flip doesn't print twice.
 * GEX-derived levels (flip / max pain / king walls) are DROPPED while positioning is
 * stale — say less, never present a frozen wall as a live line in the sand.
 */
export function deriveWatchLevels(s: SpxVoiceSnapshot, max = 3): SpxWatchLevel[] {
  const p = s.price;
  if (p == null) return [];

  type Cand = {
    label: string;
    level: number;
    tone: SpxWatchLevel["tone"];
    meaning: (side: "above" | "below") => string;
  };
  const cands: Cand[] = [];
  const push = (c: Cand | null) => {
    if (c && Number.isFinite(c.level)) cands.push(c);
  };

  if (!s.gexStale) {
    push(
      s.gammaFlip != null
        ? {
            label: "γ-flip",
            level: s.gammaFlip,
            tone: "warn",
            meaning: (side) =>
              side === "above"
                ? "cross back above it and dealers flip to dampening moves — chop-friendly tape"
                : "lose it and dealers flip to amplifying moves — momentum cuts loose lower",
          }
        : null
    );
    push(
      s.maxPain != null
        ? {
            label: "max pain",
            level: s.maxPain,
            tone: "warn",
            meaning: () => "the pin magnet — drift gravitates here into the close",
          }
        : null
    );
    push(
      s.kingCall
        ? {
            label: "call wall",
            level: s.kingCall.strike,
            tone: "bull",
            meaning: (side) =>
              side === "above"
                ? "break it and dealer hedging chases the move higher"
                : "now first support — holding above it keeps the squeeze alive",
          }
        : null
    );
    push(
      s.kingPut
        ? {
            label: "put wall",
            level: s.kingPut.strike,
            tone: "bear",
            meaning: (side) =>
              side === "below"
                ? "lose it and dealer hedging accelerates the drop"
                : "now first resistance — rejections there keep sellers in control",
          }
        : null
    );
  }
  push(
    s.vwap != null
      ? {
          label: "VWAP",
          level: s.vwap,
          tone: s.vwap >= p ? "bull" : "bear",
          meaning: (side) =>
            side === "above"
              ? "reclaim it and buyers take back the session average"
              : "lose it and sellers own the session average — pops become supply",
        }
      : null
  );
  push(
    s.hod != null
      ? {
          label: "HOD",
          level: s.hod,
          tone: "bull",
          meaning: (side) =>
            side === "above"
              ? "break it and the range extends higher — momentum buyers join"
              : "now support — the old high should hold if buyers are real",
        }
      : null
  );
  push(
    s.lod != null
      ? {
          label: "LOD",
          level: s.lod,
          tone: "bear",
          meaning: (side) =>
            side === "below"
              ? "break it and the range extends lower — momentum sellers join"
              : "reclaimed low — holding above it repairs the tape",
        }
      : null
  );
  push(
    s.pdh != null
      ? {
          label: "PDH",
          level: s.pdh,
          tone: "bull",
          meaning: (side) =>
            side === "above"
              ? "break it and it's a multi-day breakout — shorts overhead become fuel"
              : "yesterday's high is now support — holding above keeps the breakout alive",
        }
      : null
  );
  push(
    s.pdl != null
      ? {
          label: "PDL",
          level: s.pdl,
          tone: "bear",
          meaning: (side) =>
            side === "below"
              ? "lose it and it's a multi-day breakdown — longs above become supply"
              : "yesterday's low reclaimed — holding above it repairs the damage",
        }
      : null
  );

  const seen = new Set<number>();
  const out: SpxWatchLevel[] = [];
  for (const c of cands.sort((a, b) => ptsAway(p, a.level) - ptsAway(p, b.level))) {
    const key = Math.round(c.level);
    if (seen.has(key)) continue; // coincident levels (e.g. VWAP≈flip) print once, nearest label wins
    seen.add(key);
    const side: "above" | "below" = c.level >= p ? "above" : "below";
    const d = ptsAway(p, c.level);
    out.push({
      label: c.label,
      level: c.level,
      side,
      distancePts: d,
      tone: c.tone,
      line: `${c.label} ${fmtLevel(c.level)} · ${fmtPts(d)} pts ${side === "above" ? "overhead" : "below"} — ${c.meaning(side)}`,
    });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Expected-move context (enhancement b): where spot sits inside today's ±1σ band.
 * Uses only the snapshot's own expMove band (prior close × VIX, derived at snapshot
 * time) — half-width, midpoint and %-used are the documented derivations.
 */
export function composeExpectedMoveContext(s: SpxVoiceSnapshot): string | null {
  if (s.price == null || !s.expMove) return null;
  const half = (s.expMove.high - s.expMove.low) / 2;
  if (!(half > 0)) return null;
  const mid = (s.expMove.high + s.expMove.low) / 2;
  const usedPct = Math.round((Math.abs(s.price - mid) / half) * 100);
  const inside = s.price >= s.expMove.low && s.price <= s.expMove.high;
  const band = `${fmtLevel(s.expMove.low)}–${fmtLevel(s.expMove.high)}`;
  return inside
    ? `🎯 ${usedPct}% of the ±${Math.round(half)} pt expected move used — inside the 1σ band ${band}`
    : `🎯 OUTSIDE the ±${Math.round(half)} pt expected move (${band}) at ${usedPct}% of 1σ — tail territory: trail stops, don't fade blindly`;
}

/**
 * Session character (enhancement c): opening-range status + trend-vs-chop framing,
 * straight from the desk's own opening_range read — never re-derived from price.
 */
export function composeSessionCharacter(s: SpxVoiceSnapshot): string | null {
  const or = s.openingRange;
  if (!or) return null;
  const range = `${fmtLevel(or.low)}–${fmtLevel(or.high)}`;
  if (or.forming) {
    return `⏳ Opening range still forming (${range} so far) — let the first 30 min set the frame before leaning on OR breaks`;
  }
  if (or.break === "above") {
    return `📐 Broke ABOVE the ${range} opening range — trend-day odds improve while ${fmtLevel(or.high)} holds as support`;
  }
  if (or.break === "below") {
    return `📐 Broke BELOW the ${range} opening range — downside-trend odds improve while ${fmtLevel(or.low)} caps bounces`;
  }
  return `📐 Still INSIDE the ${range} opening range — no commitment yet, chop rules until it breaks`;
}

/** VWAP posture (enhancement e): one clause, only when both spot and VWAP are real. */
export function composeVwapPosture(s: SpxVoiceSnapshot): string | null {
  if (s.price == null || s.vwap == null) return null;
  const above = s.price >= s.vwap;
  const d = ptsAway(s.price, s.vwap);
  const vwapLabel = s.vwapVolumeWeighted ? "VWAP (true volume-weighted)" : "VWAP";
  return `${above ? "▲" : "▼"} ${fmtPts(d)} pts ${above ? "above" : "below"} ${vwapLabel} ${fmtLevel(s.vwap)}`;
}

/**
 * Catalyst line (enhancement f): the single most-recent desk headline with its ET
 * timestamp. No fetches, no synthesis — title and stamp come verbatim from the payload;
 * a headline with no parseable stamp renders without a time rather than inventing one.
 */
export function composeCatalystLine(s: SpxVoiceSnapshot): string | null {
  const h = s.latestHeadline;
  if (!h?.title) return null;
  const time = h.publishedAt != null ? ` · ${fmtEtTime(h.publishedAt)}` : "";
  return `📰 ${h.title.slice(0, 110)}${time}`;
}

// ---------------------------------------------------------------------------
// Transition-only event feed.
// ---------------------------------------------------------------------------

export type SpxVoiceEventTone = "bull" | "bear" | "warn" | "info";

export type SpxVoiceEvent = {
  /** Dedupe/state key — same key within the cooldown window is suppressed. */
  key: string;
  kind:
    | "flip-cross"
    | "king-migrate"
    | "wall-lifecycle"
    | "vwap-cross"
    | "ema-flip"
    | "regime-shift"
    | "structure"
    | "exp-move"
    | "rsi"
    | "vix"
    | "tide"
    | "data-health"
    | "news"
    | "play"
    | "bias";
  tone: SpxVoiceEventTone;
  line: string;
  at: number;
};

/** Wall build/fade threshold: |net_gex| change ≥ this fraction reports a lifecycle event. */
const WALL_DELTA_PCT = 0.35;
/** Ignore wall lifecycle on tiny nodes (noise floor, $ gamma). */
const WALL_MIN_ABS = 250_000;
/** Max events emitted per tick — highest-priority first, the rest wait for the next transition. */
const MAX_EVENTS_PER_TICK = 5;

function wallSideLabel(kind: "support" | "resistance"): string {
  return kind === "support" ? "P" : "C";
}

/**
 * Diff two consecutive snapshots and emit ONLY state transitions, newest tape first.
 * Pure: same inputs → same events. The caller owns cooldown dedupe (filterFreshVoiceEvents).
 */
export function detectSpxVoiceEvents(
  prev: SpxVoiceSnapshot | null,
  next: SpxVoiceSnapshot
): SpxVoiceEvent[] {
  if (!prev) return [];
  const at = next.at;
  const events: SpxVoiceEvent[] = [];

  // 1) γ-flip cross — the regime change itself.
  if (prev.aboveFlip != null && next.aboveFlip != null && next.gammaFlip != null && prev.aboveFlip !== next.aboveFlip) {
    const down = !next.aboveFlip;
    events.push({
      key: `flip:${down ? "down" : "up"}:${Math.round(next.gammaFlip)}`,
      kind: "flip-cross",
      tone: down ? "bear" : "bull",
      at,
      line: down
        ? `⚡ crossed γ-flip ${fmtLevel(next.gammaFlip)} downward — SHORT GAMMA now, dealers amplify moves → trade momentum, respect breaks`
        : `⚡ crossed γ-flip ${fmtLevel(next.gammaFlip)} upward — LONG GAMMA now, dealers dampen moves → fade extremes, expect pin`,
    });
  }

  // 2) King wall migrations — the anchor stepped.
  if (prev.kingCall && next.kingCall && prev.kingCall.strike !== next.kingCall.strike) {
    const downStep = next.kingCall.strike < prev.kingCall.strike;
    events.push({
      key: `king-call:${Math.round(prev.kingCall.strike)}->${Math.round(next.kingCall.strike)}`,
      kind: "king-migrate",
      tone: downStep ? "bear" : "bull",
      at,
      line: `⚑ king call ${fmtLevel(prev.kingCall.strike)}→${fmtLevel(next.kingCall.strike)} — resistance stepped ${downStep ? "DOWN → rallies capped sooner" : "UP → more room overhead"}`,
    });
  }
  if (prev.kingPut && next.kingPut && prev.kingPut.strike !== next.kingPut.strike) {
    const upStep = next.kingPut.strike > prev.kingPut.strike;
    events.push({
      key: `king-put:${Math.round(prev.kingPut.strike)}->${Math.round(next.kingPut.strike)}`,
      kind: "king-migrate",
      tone: upStep ? "bull" : "bear",
      at,
      line: `⚑ king put ${fmtLevel(prev.kingPut.strike)}→${fmtLevel(next.kingPut.strike)} — support stepped ${upStep ? "UP → dips bought sooner" : "DOWN → floor is lower now"}`,
    });
  }

  // 3) Wall lifecycle — building / fading nodes (matched by strike+side).
  const prevByKey = new Map(prev.walls.map((w) => [`${w.kind}:${Math.round(w.strike)}`, w]));
  const lifecycle: Array<{ ev: SpxVoiceEvent; mag: number }> = [];
  for (const w of next.walls) {
    const p = prevByKey.get(`${w.kind}:${Math.round(w.strike)}`);
    if (!p) continue;
    const before = Math.abs(p.netGex);
    const after = Math.abs(w.netGex);
    if (Math.max(before, after) < WALL_MIN_ABS || before === 0) continue;
    const change = (after - before) / before;
    const label = `${fmtLevel(w.strike)}${wallSideLabel(w.kind)}`;
    if (change >= WALL_DELTA_PCT) {
      lifecycle.push({
        mag: Math.abs(change) * after,
        ev: {
          key: `wall-build:${w.kind}:${Math.round(w.strike)}`,
          kind: "wall-lifecycle",
          tone: w.kind === "support" ? "bull" : "bear",
          at,
          line: `▲ ${label} building fast — ${w.kind === "support" ? "new support forming below" : "cap hardening overhead"}`,
        },
      });
    } else if (change <= -WALL_DELTA_PCT) {
      lifecycle.push({
        mag: Math.abs(change) * before,
        ev: {
          key: `wall-fade:${w.kind}:${Math.round(w.strike)}`,
          kind: "wall-lifecycle",
          tone: w.kind === "support" ? "bear" : "bull",
          at,
          line: `▽ ${label} fading — ${w.kind === "support" ? "support thinning, floor less reliable" : "upside cap weakening"}`,
        },
      });
    }
  }
  // Only the two most material lifecycle changes per tick — the rail is a signal, not a ledger.
  lifecycle.sort((a, b) => b.mag - a.mag);
  events.push(...lifecycle.slice(0, 2).map((l) => l.ev));

  // 4) VWAP reclaim / reject.
  if (prev.aboveVwap != null && next.aboveVwap != null && next.vwap != null && prev.aboveVwap !== next.aboveVwap) {
    events.push({
      key: `vwap:${next.aboveVwap ? "reclaim" : "lost"}:${Math.round(next.vwap)}`,
      kind: "vwap-cross",
      tone: next.aboveVwap ? "bull" : "bear",
      at,
      line: next.aboveVwap
        ? `✅ reclaimed VWAP ${fmtLevel(next.vwap)} — buyers own the session average again`
        : `⛔ lost VWAP ${fmtLevel(next.vwap)} — sellers own the session average, pops are supply`,
    });
  }

  // 5) EMA stack flip — only on arrival at a committed stack.
  if (prev.emaStack != null && next.emaStack != null && prev.emaStack !== next.emaStack && next.emaStack !== "mixed") {
    const bull = next.emaStack === "bullish";
    events.push({
      key: `ema:${next.emaStack}`,
      kind: "ema-flip",
      tone: bull ? "bull" : "bear",
      at,
      line: bull
        ? `📈 20/50 EMA stack flipped bullish — trend pressure up, dips are entries`
        : `📉 20/50 EMA stack flipped bearish — trend pressure down, rallies are exits`,
    });
  }

  // 6) Trend-regime word shift (inferRegime).
  if (prev.regime && next.regime && prev.regime !== next.regime && next.regime !== "unknown") {
    const tone: SpxVoiceEventTone =
      next.regime === "bullish" || next.regime === "recovering" ? "bull" : next.regime === "bearish" || next.regime === "weak" ? "bear" : "info";
    events.push({
      key: `regime:${prev.regime}->${next.regime}`,
      kind: "regime-shift",
      tone,
      at,
      line: `🔁 trend regime ${prev.regime} → ${next.regime} — chart character changing, re-check your thesis`,
    });
  }

  // 7) Structure — new session extremes and prior-day breaks (transition-crossed only).
  if (prev.hod != null && next.hod != null && next.hod > prev.hod + 0.25) {
    events.push({
      key: `hod:${Math.round(next.hod)}`,
      kind: "structure",
      tone: "bull",
      at,
      line: `▲ new session high ${fmtLevel(next.hod)} — buyers extending the range`,
    });
  }
  if (prev.lod != null && next.lod != null && next.lod < prev.lod - 0.25) {
    events.push({
      key: `lod:${Math.round(next.lod)}`,
      kind: "structure",
      tone: "bear",
      at,
      line: `▼ new session low ${fmtLevel(next.lod)} — sellers extending the range`,
    });
  }
  if (prev.price != null && next.price != null && next.pdh != null && prev.price <= next.pdh && next.price > next.pdh) {
    events.push({
      key: `pdh-break:${Math.round(next.pdh)}`,
      kind: "structure",
      tone: "bull",
      at,
      line: `🚨 broke prior-day high ${fmtLevel(next.pdh)} — breakout territory, shorts trapped below`,
    });
  }
  if (prev.price != null && next.price != null && next.pdl != null && prev.price >= next.pdl && next.price < next.pdl) {
    events.push({
      key: `pdl-break:${Math.round(next.pdl)}`,
      kind: "structure",
      tone: "bear",
      at,
      line: `🚨 broke prior-day low ${fmtLevel(next.pdl)} — breakdown territory, longs trapped above`,
    });
  }

  // 8) Expected-move edge tags (±1σ derived from prior close × VIX).
  if (prev.price != null && next.price != null && next.expMove) {
    const posGamma = next.aboveFlip === true;
    if (prev.price > next.expMove.low && next.price <= next.expMove.low) {
      events.push({
        key: `em-low:${next.expMove.low}`,
        kind: "exp-move",
        tone: "warn",
        at,
        line: posGamma
          ? `🎯 at −1σ (${fmtLevel(next.expMove.low)}) — edge of the expected move in positive gamma → mean-reversion zone`
          : `🎯 at −1σ (${fmtLevel(next.expMove.low)}) — edge of the expected move, but short gamma can break the band → don't knife-catch`,
      });
    }
    if (prev.price < next.expMove.high && next.price >= next.expMove.high) {
      events.push({
        key: `em-high:${next.expMove.high}`,
        kind: "exp-move",
        tone: "warn",
        at,
        line: posGamma
          ? `🎯 at +1σ (${fmtLevel(next.expMove.high)}) — edge of the expected move in positive gamma → rallies stall here`
          : `🎯 at +1σ (${fmtLevel(next.expMove.high)}) — expected-move edge in short gamma → squeeze can overshoot, trail don't fade`,
      });
    }
  }

  // 9) RSI extremes — entered/exited only (server path supplies rsi; client desk has none).
  if (prev.rsi != null && next.rsi != null) {
    if (prev.rsi < 70 && next.rsi >= 70) {
      events.push({ key: "rsi:ob", kind: "rsi", tone: "warn", at, line: `📊 RSI ${Math.round(next.rsi)} — overbought zone entered, late to chase longs` });
    } else if (prev.rsi >= 70 && next.rsi < 70) {
      events.push({ key: "rsi:ob-exit", kind: "rsi", tone: "info", at, line: `📊 RSI back under 70 — overbought pressure released` });
    } else if (prev.rsi > 30 && next.rsi <= 30) {
      events.push({ key: "rsi:os", kind: "rsi", tone: "warn", at, line: `📊 RSI ${Math.round(next.rsi)} — oversold zone entered, late to chase shorts` });
    } else if (prev.rsi <= 30 && next.rsi > 30) {
      events.push({ key: "rsi:os-exit", kind: "rsi", tone: "info", at, line: `📊 RSI back over 30 — oversold pressure released` });
    }
  }

  // 10) VIX regime kicks — crossing 20 either way, or an outsized session move.
  if (prev.vix != null && next.vix != null) {
    if (prev.vix < 20 && next.vix >= 20) {
      events.push({ key: "vix:above20", kind: "vix", tone: "warn", at, line: `🌊 VIX ${next.vix.toFixed(1)} through 20 — vol expanding, cut size and widen stops` });
    } else if (prev.vix >= 20 && next.vix < 20) {
      events.push({ key: "vix:below20", kind: "vix", tone: "info", at, line: `🌊 VIX ${next.vix.toFixed(1)} back under 20 — vol cooling` });
    }
  }

  // 11) Market tide flip (broad options flow).
  if (prev.tideBias && next.tideBias && prev.tideBias !== next.tideBias && next.tideBias !== "neutral") {
    const bull = next.tideBias === "bullish";
    events.push({
      key: `tide:${next.tideBias}`,
      kind: "tide",
      tone: bull ? "bull" : "bear",
      at,
      line: `💧 market tide flipped ${next.tideBias} — broad flow ${bull ? "buying" : "selling"} behind the tape`,
    });
  }

  // 12) Fresh headline — only genuinely new titles.
  const prevTitles = new Set(prev.newsTitles);
  const fresh = next.newsTitles.find((t) => !prevTitles.has(t));
  if (fresh) {
    events.push({
      key: `news:${fresh.slice(0, 40)}`,
      kind: "news",
      tone: "info",
      at,
      line: `📰 ${fresh.slice(0, 90)}`,
    });
  }

  // 13) Data health — stale walls must never masquerade as live conviction.
  if (!prev.gexStale && next.gexStale) {
    events.push({ key: "gex:stale", kind: "data-health", tone: "warn", at, line: "⚠️ dealer positioning went stale — walls/flip not live, confirm before sizing" });
  } else if (prev.gexStale && !next.gexStale) {
    events.push({ key: "gex:fresh", kind: "data-health", tone: "info", at, line: "✅ dealer positioning refreshed — walls/flip live again" });
  }
  if (!prev.feedStalled && next.feedStalled) {
    events.push({ key: "feed:stalled", kind: "data-health", tone: "warn", at, line: "⚠️ index feed stalled — price not live, stand down until it recovers" });
  } else if (prev.feedStalled && !next.feedStalled) {
    events.push({ key: "feed:live", kind: "data-health", tone: "info", at, line: "✅ index feed recovered — price live again" });
  }

  // Already in priority order by construction; cap the burst.
  return events.slice(0, MAX_EVENTS_PER_TICK);
}

/**
 * Cooldown dedupe (the emitRegime discipline): an event whose key fired within
 * `cooldownMs` is suppressed. Returns the fresh events and the updated seen-map —
 * pure, so both the rail and tests can drive it deterministically. The seen-map is
 * pruned so a day-long session can't grow it unbounded.
 */
export function filterFreshVoiceEvents(
  events: SpxVoiceEvent[],
  seenAtByKey: Record<string, number>,
  nowMs: number,
  cooldownMs = 4 * 60 * 1000
): { fresh: SpxVoiceEvent[]; seen: Record<string, number> } {
  const seen: Record<string, number> = {};
  for (const [k, t] of Object.entries(seenAtByKey)) {
    if (nowMs - t < cooldownMs * 4) seen[k] = t;
  }
  const fresh: SpxVoiceEvent[] = [];
  for (const ev of events) {
    const last = seen[ev.key];
    if (last != null && nowMs - last < cooldownMs) continue;
    seen[ev.key] = nowMs;
    fresh.push(ev);
  }
  return { fresh, seen };
}

// ---------------------------------------------------------------------------
// Play lifecycle — armed / fired / closed, one line each.
// ---------------------------------------------------------------------------

/** Structural slice of SpxPlayPayload the lifecycle detector needs (test-friendly). */
export type SpxVoicePlayState = {
  action?: string | null;
  direction?: "long" | "short" | null;
  open_play?: {
    direction: "long" | "short";
    entry_price: number | null;
    stop: number | null;
    target: number | null;
  } | null;
} | null;

export function detectPlayVoiceEvents(
  prev: SpxVoicePlayState,
  next: SpxVoicePlayState,
  at: number
): SpxVoiceEvent[] {
  if (!next) return [];
  const events: SpxVoiceEvent[] = [];

  const wasArmed = prev?.action === "BUY" && !prev?.open_play;
  const isArmed = next.action === "BUY" && !next.open_play;
  if (!wasArmed && isArmed) {
    const dir = next.direction === "short" ? "SHORT" : "LONG";
    events.push({
      key: `play-armed:${dir}`,
      kind: "play",
      tone: next.direction === "short" ? "bear" : "bull",
      at,
      line: `🎯 play ARMED — ${dir} setup triggered, engine wants the entry`,
    });
  }

  if (!prev?.open_play && next.open_play) {
    const op = next.open_play;
    const dir = op.direction === "short" ? "SHORT" : "LONG";
    const bits = [
      op.entry_price != null ? `from ${fmtLevel(op.entry_price)}` : null,
      op.stop != null ? `stop ${fmtLevel(op.stop)}` : null,
      op.target != null ? `target ${fmtLevel(op.target)}` : null,
    ].filter(Boolean);
    events.push({
      key: `play-fired:${dir}:${op.entry_price != null ? Math.round(op.entry_price) : "x"}`,
      kind: "play",
      tone: op.direction === "short" ? "bear" : "bull",
      at,
      line: `🔫 play FIRED — ${dir} ${bits.join(", ")}`,
    });
  }

  if (prev?.open_play && !next.open_play) {
    const op = prev.open_play;
    const dir = op.direction === "short" ? "SHORT" : "LONG";
    events.push({
      key: `play-closed:${dir}:${op.entry_price != null ? Math.round(op.entry_price) : "x"}`,
      kind: "play",
      tone: "info",
      at,
      line: `🏁 play CLOSED — ${dir}${op.entry_price != null ? ` from ${fmtLevel(op.entry_price)}` : ""} is done, back to scanning`,
    });
  }

  return events;
}

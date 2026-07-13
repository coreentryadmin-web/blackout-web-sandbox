import type { VectorDteHorizon } from "./vector-dte-horizon";
import type { VectorRegimePosture } from "./vector-regime";
import type { GexWalls } from "@/lib/providers/gex-wall-levels";
import type { GammaMagnet } from "./vector-gamma-magnet";
import type { WallProximity } from "./vector-wall-proximity";
import type { ExpectedMove } from "./vector-expected-move";
import type { ConfluenceZone } from "./vector-confluence";
import type { WallIntegrity } from "./vector-wall-integrity";

/**
 * Vector PLAY ENGINE — the desk's single, concrete, timeframe-aware trade idea.
 *
 * Every other Vector module narrates one fragment of the tape: the regime, a magnet,
 * a wall's proximity, the expected-move box, a confluence stack. A trader still has to
 * fuse those in their head into "so what do I actually DO right now?". This engine does
 * that fusion: it reads the WHOLE structured setup and states ONE play — a style
 * (scalp/swing/position keyed to the DTE horizon), a bias, an entry, targets, an
 * invalidation, a conviction grade, and the "watch-this-now" starred items.
 *
 * PURE by construction — no Date.now, no network, no window. The chart assembles the
 * structured `VectorPlayInput` from the same signals it already computes and emits, and
 * calls this on every selection change (ticker / DTE / timeframe / tick) so the play is
 * always current. Purity is what makes the domain logic below exhaustively unit-testable.
 *
 * The interpretation is REAL dealer-gamma physics, not a toy:
 *  - LONG gamma (spot above the flip): dealers hedge AGAINST moves → price mean-reverts
 *    and pins. The play is to FADE extremes back toward the magnet/VWAP; a call wall caps,
 *    a put wall floors. Range regime.
 *  - SHORT gamma (spot below the flip): dealers hedge WITH moves → volatility feeds on
 *    itself. The play is MOMENTUM: trade with the break, target the next wall, wider stop.
 *  - TRANSITION (sitting on the flip): regime undecided → play the CROSS with a tight stop
 *    at the flip itself, direction confirmed by the break.
 *  - POSITION horizon (monthly/all): the EMA-stack trend and structure lead; gamma walls
 *    become targets/backstops rather than intraday fade levels.
 */

/** Structured technicals the chart already computes (from `summarizeTechnicals`), mapped to a
 *  compact play-facing shape. Every field is optional/nullable so the play degrades gracefully. */
export type PlayTechnicals = {
  vwap?: number | null;
  /** ema9/21/50 stack direction: "up" = stacked bullish, "down" = stacked bearish. */
  emaStack?: "up" | "down" | "mixed" | null;
  rsi?: number | null;
  macd?: "bull" | "bear" | null;
  goldenPocket?: { low: number; high: number } | null;
  structure?: { type: string; direction: string; level: number } | null;
};

/** Optional BIE historical grounding for the current confluence bucket (slice 3). When present the
 *  play cites it as evidence and nudges conviction; when absent the play works unchanged. */
export type PlayBieContext = {
  /** Fraction (0–1) of past setups in this bucket that resolved favorably. */
  favPct: number;
  /** Sample size behind favPct. */
  samples: number;
  /** Lookback window in days. */
  windowDays: number;
};

/**
 * VectorSnapshot — the CANONICAL, complete, serializable picture of "everything on Vector right
 * now" for one (ticker, horizon, timeframe). This is deliberately a faithful full-state
 * representation, not a minimal ad-hoc bag: it is both the input the play engine reads AND the
 * shared contract a server-side builder can assemble to feed BIE (the plan is for BIE to reason
 * over the entire Vector surface, mirroring the SPX full-state pattern). Keep it PURE and
 * serializable — every field is plain data (no DOM/chart handles, no functions), so it round-trips
 * through JSON and can be built server-side. `buildVectorPlay(snapshot)` reads the state fields;
 * the derived `play` is attached back onto the snapshot by the caller (chart or server builder).
 */
export type VectorSnapshot = {
  /** The Vector ticker this snapshot describes (e.g. "SPX"). */
  ticker: string;
  horizon: VectorDteHorizon;
  /** Chart timeframe in minutes — drives the invalidation "close" reference (5m vs 1H). */
  timeframeMin: number;
  spot: number | null | undefined;
  regime: { posture: VectorRegimePosture } | null | undefined;
  gexWalls: GexWalls | null | undefined;
  gammaFlip: number | null | undefined;
  magnet: GammaMagnet | null | undefined;
  proximity: WallProximity | null | undefined;
  expectedMove: ExpectedMove | null | undefined;
  maxPain: number | null | undefined;
  confluenceZones: readonly ConfluenceZone[] | null | undefined;
  wallIntegrity: { call: WallIntegrity | null; put: WallIntegrity | null } | null | undefined;
  technicals: PlayTechnicals | null | undefined;
  bie?: PlayBieContext | null;
  /** Age of the underlying stream data in ms (passthrough, for the terminal to show staleness). */
  dataAgeMs?: number | null;
  /** The derived play, attached by the caller after `buildVectorPlay` runs. Part of the full-state
   *  contract so a consumer (terminal or BIE ingestion) gets the complete picture in one object. */
  play?: VectorPlay | null;
};

/**
 * Back-compat alias — the play engine's input IS the canonical snapshot. Named separately only so
 * call sites that think of it as "the play engine input" read naturally; they are the same type.
 */
export type VectorPlayInput = VectorSnapshot;

export type VectorPlayStyle = "scalp" | "swing" | "position";
export type VectorPlayBias = "long" | "short" | "range" | "neutral";
export type VectorPlayGrade = "A" | "B" | "C";

export type VectorPlay = {
  style: VectorPlayStyle;
  bias: VectorPlayBias;
  /** 0–100 blended conviction. */
  conviction: number;
  grade: VectorPlayGrade;
  headline: string;
  thesis: string;
  entryZone?: string;
  targets: string[];
  invalidation?: string;
  /** The "watch this NOW" set — the headline is always first; then imminent flip cross, a wall
   *  being tested/at, a top-score confluence zone, and (when present) the BIE evidence line. */
  starred: string[];
  dataAge?: number | null;
};

/** The core setup the regime + proximity resolve to — the branch that shapes everything downstream. */
type PlaySetup =
  | "fade-call" // long gamma, testing/at a call wall → fade short
  | "fade-put" // long gamma, testing/at a put wall → fade long
  | "range" // long gamma, open space → mean-revert to the magnet
  | "momentum-long" // short gamma / trend up → go with the break
  | "momentum-short" // short gamma / trend down → go with the break
  | "pivot" // sitting on the flip → play the cross
  | "stand-aside"; // no clean read

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Timeframe label for the invalidation "close" reference — "5m", "15m", "1H". */
function tfLabel(min: number): string {
  if (!Number.isFinite(min) || min <= 0) return "bar";
  if (min < 60) return `${Math.round(min)}m`;
  const h = min / 60;
  return Number.isInteger(h) ? `${h}H` : `${h.toFixed(1)}H`;
}

function styleForHorizon(h: VectorDteHorizon): VectorPlayStyle {
  // 0DTE lives and dies on intraday gamma → SCALP. Weekly rides the flip/max-pain gravity over
  // a few sessions → SWING. Monthly/all is a structure/trend horizon → POSITION.
  if (h === "0dte") return "scalp";
  if (h === "weekly") return "swing";
  return "position";
}

function styleLabel(s: VectorPlayStyle): string {
  return s.toUpperCase();
}

function num(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** A candidate price level with a short desk label, used to build ordered target lists. */
type LevelCand = { label: string; price: number };

function collectLevels(input: VectorPlayInput): LevelCand[] {
  const out: LevelCand[] = [];
  const push = (label: string, price: number | null | undefined) => {
    const p = num(price);
    if (p != null && p > 0) out.push({ label, price: p });
  };
  push("VWAP", input.technicals?.vwap);
  if (input.magnet) push("magnet", input.magnet.strike);
  push("max pain", input.maxPain);
  push("call wall", input.gexWalls?.callWalls?.[0]?.strike);
  push("call wall", input.gexWalls?.callWalls?.[1]?.strike);
  push("put wall", input.gexWalls?.putWalls?.[0]?.strike);
  push("put wall", input.gexWalls?.putWalls?.[1]?.strike);
  if (input.expectedMove) {
    for (const b of input.expectedMove.bands) {
      push(`${b.sigma}σ`, b.low);
      push(`${b.sigma}σ`, b.high);
    }
  }
  return out;
}

/**
 * Ordered, deduped target strings on one side of spot. Nearest first (T1→T3). Levels within a
 * tight band merge their labels ("VWAP/magnet 7,562") rather than printing two near-identical
 * lines, which is how a desk actually quotes a confluence target.
 */
function pickTargets(cands: LevelCand[], dir: "up" | "down", spot: number, max = 3): string[] {
  const side = cands.filter((c) =>
    dir === "up" ? c.price > spot * 1.0001 : c.price < spot * 0.9999
  );
  side.sort((a, b) => (dir === "up" ? a.price - b.price : b.price - a.price));
  const tol = spot * 0.0006;
  const picked: { price: number; labels: string[] }[] = [];
  for (const c of side) {
    const near = picked.find((p) => Math.abs(p.price - c.price) <= tol);
    if (near) {
      if (!near.labels.includes(c.label)) near.labels.push(c.label);
      continue;
    }
    if (picked.length >= max) break;
    picked.push({ price: c.price, labels: [c.label] });
  }
  return picked.map((p) => `${p.labels.join("/")} ${fmt(p.price)}`);
}

/** True when `price` sits inside the k·σ expected-move band (a higher-probability target). */
function withinSigma(em: ExpectedMove | null | undefined, price: number | null, k: number): boolean {
  if (!em || price == null) return false;
  const b = em.bands.find((x) => x.sigma === k);
  return !!b && price >= b.low && price <= b.high;
}

/**
 * Resolve the core setup from the regime, proximity, style, and technicals. This is the single
 * decision that everything else keys off, so the logic is spelled out per regime rather than
 * collapsed into a clever expression — the WHY has to survive a cold read of the diff.
 */
function determineSetup(input: VectorPlayInput, style: VectorPlayStyle): { setup: PlaySetup; atWall?: { strike: number; side: "call" | "put" } } {
  const posture = input.regime?.posture ?? "unknown";
  const prox = input.proximity ?? null;
  const ema = input.technicals?.emaStack ?? null;
  const spot = num(input.spot);

  // A flip that spot is genuinely testing/at is the highest-information state — regime is about to
  // flip, so the play is the CROSS regardless of the current posture label.
  if (prox && prox.side === "flip" && prox.nearness !== "near") return { setup: "pivot" };
  if (posture === "transition") return { setup: "pivot" };

  // POSITION horizon: a clean EMA-stack trend leads. Monthly/all traders ride the trend and use
  // walls as targets, not intraday fade levels — so a stacked trend overrides the gamma-fade read.
  if (style === "position" && ema === "up") return { setup: "momentum-long" };
  if (style === "position" && ema === "down") return { setup: "momentum-short" };

  if (posture === "long") {
    // Long gamma = mean-revert. At/testing a wall → fade it; open space → range toward the magnet.
    if (prox && prox.nearness !== "near") {
      if (prox.side === "call") return { setup: "fade-call", atWall: { strike: prox.strike, side: "call" } };
      if (prox.side === "put") return { setup: "fade-put", atWall: { strike: prox.strike, side: "put" } };
    }
    return { setup: "range" };
  }

  if (posture === "short") {
    // Short gamma = momentum. A wall under test is about to BREAK (dealers amplify), so trade the
    // break in the wall's direction; with no wall in range, follow the technical trend.
    if (prox && prox.nearness !== "near") {
      if (prox.side === "call") return { setup: "momentum-long", atWall: { strike: prox.strike, side: "call" } };
      if (prox.side === "put") return { setup: "momentum-short", atWall: { strike: prox.strike, side: "put" } };
    }
    if (ema === "up") return { setup: "momentum-long" };
    if (ema === "down") return { setup: "momentum-short" };
    // Short gamma with no wall and no clear trend still leans downside (that's the asymmetry of a
    // short-gamma regime), but it's a low-conviction read — the conviction model reflects that.
    return { setup: "momentum-short" };
  }

  // Unknown regime: fall back to the technical trend if there is one, else stand aside.
  if (spot != null && ema === "up") return { setup: "momentum-long" };
  if (spot != null && ema === "down") return { setup: "momentum-short" };
  return { setup: "stand-aside" };
}

function biasForSetup(setup: PlaySetup): VectorPlayBias {
  switch (setup) {
    case "fade-call":
    case "momentum-short":
      return "short";
    case "fade-put":
    case "momentum-long":
      return "long";
    case "range":
      return "range";
    case "pivot":
    case "stand-aside":
      return "neutral";
  }
}

/** Which same-side wall integrity backs the level the play leans on. */
function playWallIntegrity(
  input: VectorPlayInput,
  atWall?: { strike: number; side: "call" | "put" }
): WallIntegrity | null {
  if (!atWall || !input.wallIntegrity) return null;
  return atWall.side === "call" ? input.wallIntegrity.call : input.wallIntegrity.put;
}

/**
 * Blend the conviction (0–100) from independent, honestly-weighted factors. Each contribution is
 * commented with WHY it moves conviction; the sum is clamped and graded A/B/C. Kept transparent
 * (a plain accumulation, not a black box) so a reviewer can trace why a setup graded the way it did.
 */
function computeConviction(
  input: VectorPlayInput,
  setup: PlaySetup,
  bias: VectorPlayBias,
  refLevel: number | null,
  firstTargetPrice: number | null,
  atWall?: { strike: number; side: "call" | "put" }
): number {
  const spot = num(input.spot)!;
  let c = 50; // neutral prior

  // Regime clarity: a decisively long/short regime (spot well off the flip) is tradeable; sitting
  // on the flip is a coin-flip; an unknown regime means we're guessing.
  const posture = input.regime?.posture ?? "unknown";
  const flip = num(input.gammaFlip);
  if (posture === "long" || posture === "short") {
    const dist = flip != null ? Math.abs(spot - flip) / spot : 0;
    c += dist > 0.003 ? 12 : 6;
  } else if (posture === "transition") {
    c -= 4;
  } else {
    c -= 18;
  }

  // Confluence stacked AT the level the play references (fade wall / magnet / flip) is the single
  // biggest edge — several independent levels agreeing where we're acting. Scaled by the zone score,
  // and only credited when a top zone actually sits near the reference (else a small far-field bump).
  const zones = input.confluenceZones ?? [];
  const top = zones[0] ?? null;
  if (top && refLevel != null) {
    const nearRef = Math.abs(top.center - refLevel) / spot <= 0.004;
    if (nearRef) c += Math.min(14, top.score * 1.6);
    else c += 3;
  }

  // Wall integrity of the level we're leaning on: a firm, session-held, dominant wall is a real
  // line to fade/target; a thin one that just blinked in is a trap — dock it hard.
  const wi = playWallIntegrity(input, atWall);
  if (wi) c += wi.tier === "firm" ? 10 : wi.tier === "thin" ? -10 : 2;

  // Technical agreement with the bias. A trend aligned with a momentum call, or chop supporting a
  // range call, adds; a trend fighting the call subtracts.
  const ema = input.technicals?.emaStack ?? null;
  const macd = input.technicals?.macd ?? null;
  if (bias === "long") {
    if (ema === "up") c += 6;
    else if (ema === "down") c -= 6;
    if (macd === "bull") c += 4;
    else if (macd === "bear") c -= 4;
  } else if (bias === "short") {
    if (ema === "down") c += 6;
    else if (ema === "up") c -= 6;
    if (macd === "bear") c += 4;
    else if (macd === "bull") c -= 4;
  } else if (bias === "range") {
    // A range call wants chop; a hard trend argues against fading.
    if (ema === "mixed") c += 3;
    else if (ema === "up" || ema === "down") c -= 4;
  }

  // Proximity actionable-NOW: a level under test is immediately tradeable; open space is not (except
  // a range setup, which is defined by open space and shouldn't be penalized for it).
  const prox = input.proximity ?? null;
  if (setup === "range") {
    c += 2;
  } else if (prox && prox.nearness === "at") {
    c += 8;
  } else if (prox && prox.nearness === "testing") {
    c += 6;
  } else if (prox && prox.nearness === "near") {
    c += 3;
  } else if (setup !== "pivot") {
    c -= 4;
  }

  // Target probability: a first target inside the 1σ box is a higher-probability get; one beyond 2σ
  // is a lottery leg.
  if (withinSigma(input.expectedMove, firstTargetPrice, 1)) c += 5;
  else if (input.expectedMove && firstTargetPrice != null && !withinSigma(input.expectedMove, firstTargetPrice, 2)) c -= 3;

  // Magnet alignment: the dealer-hedging center of mass pulling toward the target direction (only a
  // real pull in long gamma — a short-gamma "pivot" isn't a magnet, so don't credit it).
  const magnet = input.magnet ?? null;
  if (magnet && magnet.posture === "long" && magnet.pull !== "at") {
    if (bias === "long" && magnet.pull === "up") c += 4;
    else if (bias === "short" && magnet.pull === "down") c += 4;
  }

  // BIE grounding (slice 3): real historical edge for this bucket nudges conviction toward the
  // observed outcome, scaled down for small samples. Never fabricated — only applied when present.
  if (input.bie && input.bie.samples > 0) {
    const edge = input.bie.favPct - 0.5; // signed edge vs a coin flip
    const sampleWeight = Math.min(1, input.bie.samples / 50);
    c += edge * 20 * sampleWeight;
  }

  return Math.max(0, Math.min(100, Math.round(c)));
}

function gradeFor(conviction: number): VectorPlayGrade {
  return conviction >= 75 ? "A" : conviction >= 55 ? "B" : "C";
}

/**
 * Build the concrete play — the single entry point. Returns null only when there is genuinely
 * nothing to say (no spot, or no structure of any kind); otherwise it always states a play,
 * degrading to a low-conviction "stand aside" rather than going silent.
 */
export function buildVectorPlay(input: VectorPlayInput): VectorPlay | null {
  const spot = num(input.spot);
  if (spot == null || spot <= 0) return null;

  const style = styleForHorizon(input.horizon);
  const { setup, atWall } = determineSetup(input, style);
  const bias = biasForSetup(setup);
  const cands = collectLevels(input);
  const flip = num(input.gammaFlip);
  const magnetStrike = input.magnet ? num(input.magnet.strike) : null;
  const tf = tfLabel(input.timeframeMin);
  const label = styleLabel(style);

  // If we truly have no structure to reason about, don't fabricate a play.
  const hasStructure =
    (input.gexWalls?.callWalls?.length ?? 0) > 0 ||
    (input.gexWalls?.putWalls?.length ?? 0) > 0 ||
    flip != null ||
    magnetStrike != null ||
    input.technicals?.emaStack != null ||
    input.technicals?.vwap != null;
  if (!hasStructure) return null;

  let headline = "";
  let thesis = "";
  let entryZone: string | undefined;
  let targets: string[] = [];
  let invalidation: string | undefined;
  let refLevel: number | null = null;

  const callWall = num(input.gexWalls?.callWalls?.[0]?.strike);
  const putWall = num(input.gexWalls?.putWalls?.[0]?.strike);

  switch (setup) {
    case "fade-call": {
      const wall = atWall ? atWall.strike : callWall!;
      refLevel = wall;
      targets = pickTargets(cands, "down", spot);
      const tgt = targets[0] ?? (magnetStrike != null ? `magnet ${fmt(magnetStrike)}` : "VWAP");
      headline = `${label} · fade the ${fmt(wall)} call wall — short back toward ${tgt}`;
      thesis = `Long gamma (spot ${fmt(spot)}${flip != null ? ` > flip ${fmt(flip)}` : ""}): dealers sell strength, so the ${fmt(wall)} call wall caps. Fade the test for a mean-revert lower.`;
      entryZone = `short into ${fmt(wall)} call wall`;
      invalidation = `${tf} close > ${fmt(wall)} (wall breaks → fade void)`;
      break;
    }
    case "fade-put": {
      const wall = atWall ? atWall.strike : putWall!;
      refLevel = wall;
      targets = pickTargets(cands, "up", spot);
      const tgt = targets[0] ?? (magnetStrike != null ? `magnet ${fmt(magnetStrike)}` : "VWAP");
      headline = `${label} · fade the ${fmt(wall)} put wall — long back toward ${tgt}`;
      thesis = `Long gamma (spot ${fmt(spot)}${flip != null ? ` > flip ${fmt(flip)}` : ""}): dealers buy weakness, so the ${fmt(wall)} put wall floors. Fade the test for a bounce higher.`;
      entryZone = `long off ${fmt(wall)} put wall`;
      invalidation = `${tf} close < ${fmt(wall)} (wall breaks → support lost)`;
      break;
    }
    case "range": {
      refLevel = magnetStrike ?? num(input.maxPain);
      const magnetTxt = magnetStrike != null ? `${fmt(magnetStrike)} magnet` : "the gamma center of mass";
      headline = `${label} · range — fade extremes toward ${magnetTxt}`;
      thesis = `Long gamma (spot ${fmt(spot)}${flip != null ? ` > flip ${fmt(flip)}` : ""}): price is pinned. Buy dips toward the put wall, sell rips toward the call wall — mean-revert to ${magnetTxt}.`;
      const parts: string[] = [];
      if (putWall != null) parts.push(`buy dips ${fmt(putWall)}`);
      if (callWall != null) parts.push(`sell rips ${fmt(callWall)}`);
      entryZone = parts.length ? parts.join(" · ") : (magnetStrike != null ? `mean-revert to ${fmt(magnetStrike)}` : undefined);
      // Range targets = the mean and both rails.
      const t: string[] = [];
      if (magnetStrike != null) t.push(`magnet ${fmt(magnetStrike)}`);
      if (callWall != null) t.push(`call wall ${fmt(callWall)}`);
      if (putWall != null) t.push(`put wall ${fmt(putWall)}`);
      targets = t.slice(0, 3);
      invalidation = flip != null ? `${tf} close < ${fmt(flip)} flips to short gamma (regime change)` : undefined;
      break;
    }
    case "momentum-long": {
      const brokeWall = atWall && atWall.side === "call" ? atWall.strike : null;
      refLevel = brokeWall ?? callWall;
      targets = pickTargets(cands, "up", spot);
      const tgt = targets[0] ?? (callWall != null ? `call wall ${fmt(callWall)}` : "the next level");
      const trigger = brokeWall != null ? `a break of ${fmt(brokeWall)}` : `continuation`;
      headline = `${label} · momentum long on ${trigger} → target ${tgt}`;
      thesis = `${input.regime?.posture === "short" ? "Short gamma amplifies the move" : "Trend is up"}: go WITH strength, not against it. ${brokeWall != null ? `A break of ${fmt(brokeWall)} runs — ` : ""}target the next wall, wider stop.`;
      entryZone = brokeWall != null ? `long on ${tf} close > ${fmt(brokeWall)}` : `long on strength / pullback hold`;
      invalidation = brokeWall != null ? `${tf} close back < ${fmt(brokeWall)}` : flip != null ? `${tf} close < ${fmt(flip)}` : undefined;
      break;
    }
    case "momentum-short": {
      const brokeWall = atWall && atWall.side === "put" ? atWall.strike : null;
      refLevel = brokeWall ?? putWall;
      targets = pickTargets(cands, "down", spot);
      const tgt = targets[0] ?? (putWall != null ? `put wall ${fmt(putWall)}` : "the next level");
      const trigger = brokeWall != null ? `a break of ${fmt(brokeWall)}` : `continuation`;
      headline = `${label} · momentum short on ${trigger} → target ${tgt}`;
      thesis = `${input.regime?.posture === "short" ? "Short gamma amplifies the move" : "Trend is down"}: go WITH weakness. ${brokeWall != null ? `A break of ${fmt(brokeWall)} accelerates — ` : ""}target the next wall, wider stop.`;
      entryZone = brokeWall != null ? `short on ${tf} close < ${fmt(brokeWall)}` : `short on weakness / lower-high`;
      invalidation = brokeWall != null ? `${tf} close back > ${fmt(brokeWall)}` : flip != null ? `${tf} close > ${fmt(flip)}` : undefined;
      break;
    }
    case "pivot": {
      const level = flip ?? (input.proximity?.side === "flip" ? input.proximity.strike : null);
      refLevel = level;
      const lvlTxt = level != null ? fmt(level) : "the gamma flip";
      headline = `${label} · pivot at the ${lvlTxt} gamma flip — long above / short below`;
      thesis = `Spot is sitting on the ${lvlTxt} gamma flip: regime is undecided and the sharpest moves fire here. Take the CROSS on confirmation, tight stop at the flip.`;
      entryZone = `trade the ${lvlTxt} flip cross (confirmed close)`;
      // Nearest wall each side is the first objective once it commits.
      const up = pickTargets(cands, "up", spot, 1);
      const down = pickTargets(cands, "down", spot, 1);
      targets = [...up, ...down];
      invalidation = level != null ? `${tf} close back through ${fmt(level)}` : undefined;
      break;
    }
    case "stand-aside": {
      headline = `${label} · stand aside — no clean edge`;
      thesis = `Regime and structure are too sparse for a high-conviction play right now (no decisive flip, walls, or trend). Wait for spot to engage a level or the regime to declare.`;
      targets = [];
      break;
    }
  }

  const firstTargetPrice = parseFirstTargetPrice(targets);
  const conviction = computeConviction(input, setup, bias, refLevel, firstTargetPrice, atWall);
  const grade = gradeFor(conviction);

  // Starred = the "watch this NOW" set. The headline always leads; then the imminent, actionable
  // items a member should have eyes on this second.
  const starred: string[] = [headline];
  const prox = input.proximity ?? null;
  if (prox && prox.side === "flip" && prox.nearness !== "near") {
    starred.push(`Flip cross imminent — ${prox.callout}`);
  } else if (prox && prox.nearness !== "near" && (prox.side === "call" || prox.side === "put")) {
    starred.push(`${prox.strike ? fmt(prox.strike) : ""} ${prox.side} wall ${prox.nearness} — ${prox.callout}`.trim());
  }
  const top = (input.confluenceZones ?? [])[0] ?? null;
  if (top && Math.abs(top.center - spot) / spot <= 0.005) {
    starred.push(`Confluence ${fmt(top.center)} — ${top.kinds.length} levels stacked (score ${top.score})`);
  }
  if (input.bie && input.bie.samples > 0) {
    starred.push(
      `BIE · setups like this resolved ${Math.round(input.bie.favPct * 100)}% fav over ${input.bie.samples} · ${input.bie.windowDays}d`
    );
  }

  return {
    style,
    bias,
    conviction,
    grade,
    headline,
    thesis,
    entryZone,
    targets,
    invalidation,
    starred,
    dataAge: input.dataAgeMs ?? null,
  };
}

/** Extract the leading numeric price from the first target string (e.g. "VWAP/magnet 7,562.5" → 7562.5). */
function parseFirstTargetPrice(targets: string[]): number | null {
  const first = targets[0];
  if (!first) return null;
  const m = first.match(/([\d,]+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const v = Number(m[1]!.replace(/,/g, ""));
  return Number.isFinite(v) ? v : null;
}

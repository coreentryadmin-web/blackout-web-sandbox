// BLACKOUT Intelligence Engine — deterministic Live Desk AI brief for SPX Slayer.
// Replaces Claude Haiku on /api/market/spx/commentary: every number traces to the
// same desk + confluence readers the play engine uses; optional Voyage precedent
// color is additive only.

import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { SpxConfluence, SpxConfluenceGrade } from "@/features/spx/lib/spx-signals";
import { formatFlowStrikeStackLine } from "@/lib/largo/flow-strike-stacks";
import { fmtPremium } from "@/lib/fmt-money";
import {
  type SpxDeskBriefIntel,
  breadthBriefLine,
  chartBriefLine,
  crossCheckBriefLine,
  dealersBriefLine,
  edgesBriefLine,
  expiryBriefLine,
  mag7BriefLine,
  nighthawkBriefLine,
  positioningDeltaSnippets,
  signalsBriefLine,
  volBriefLine,
  wallsBriefLine,
} from "@/lib/bie/spx-desk-intel";
import { detectPremiseCorrections } from "@/lib/bie/spx-premise";
import { synthesizeSpxDeskIntel } from "@/lib/bie/spx-desk-synthesis";
import {
  composeBiasVoice,
  deriveSpxBias,
  voiceSnapshotFromDesk,
} from "@/lib/bie/spx-live-voice";

export type SpxDeskBriefResult = {
  headline: string;
  bias: "bullish" | "bearish" | "neutral";
  body: string;
  watch: string[];
  changed: string[];
  as_of: string;
};

export type SpxDeskBriefCross = {
  openPlay?: {
    status: string;
    direction: string;
    entry_price: number | null;
    stop: number | null;
    target: number | null;
    grade: string | null;
  } | null;
  lotto?: {
    phase: string;
    direction: string | null;
    strike: number | null;
  } | null;
  powerHour?: {
    phase: string;
    direction: string | null;
    strike: number | null;
  } | null;
  outcomes?: {
    overall: { win_rate: number; wins: number; losses: number };
    total_closed: number;
  } | null;
  precedentDetail?: string | null;
  /** Named playbook shadow/live panel — live mode gates BUY on staging. */
  playbookShadow?: {
    mode?: "shadow" | "live";
    primary_playbook_id: string | null;
    primary_name: string | null;
    primary_direction?: "long" | "short" | "neutral" | null;
    fired_count: number;
  } | null;
  /** Full matrix greeks + heatmap levels (GEX/VEX/DEX/CHARM). */
  intel?: SpxDeskBriefIntel;
};

function fmt(n: number | null | undefined, d = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function n(n: number | null | undefined, d = 2): string {
  if (n == null || !Number.isFinite(n)) return "{{—}}";
  return `{{${fmt(n, d)}}}`;
}

function signedPts(dist: number): string {
  const sign = dist >= 0 ? "+" : "";
  return `{{${sign}${dist.toFixed(0)}}}`;
}

function nearestWall(
  walls: SpxDeskPayload["gex_walls"],
  kind: "support" | "resistance",
  price: number
) {
  const pool = (walls ?? []).filter((w) => w.kind === kind);
  if (!pool.length) return null;
  return pool.reduce((best, w) => {
    const d = Math.abs(w.strike - price);
    const bd = Math.abs(best.strike - price);
    return d < bd ? w : best;
  });
}

function headlineVerb(action: SpxConfluence["action"], grade: SpxConfluenceGrade): string {
  if (grade === "C" || grade === "D" || action === "WAIT") return "NO-EDGE";
  if (action === "BUY_CALL") return "LONG";
  if (action === "BUY_PUT") return "SHORT";
  if (action === "HOLD") return "CHOP";
  return "NO-EDGE";
}

function gradeRank(g: SpxConfluenceGrade): number {
  return g === "A+" ? 5 : g === "A" ? 4 : g === "B" ? 3 : g === "C" ? 2 : 1;
}

function sizeLabel(grade: SpxConfluenceGrade): string {
  if (grade === "A+" || grade === "A") return "full";
  if (grade === "B") return "half";
  return "zero";
}

function gammaTag(desk: SpxDeskPayload): string {
  const regime = desk.gamma_regime ?? desk.regime ?? "unknown";
  if (regime === "amplification" || desk.above_gamma_flip === false) {
    return "neg-γ (trend fuel)";
  }
  if (regime === "mean_revert" || desk.above_gamma_flip === true) {
    return "pos-γ (dips bought)";
  }
  return desk.above_gamma_flip ? "pos-γ (dips bought)" : "neg-γ (trend fuel)";
}

function topFactors(confluence: SpxConfluence, count = 2): string {
  const sorted = [...confluence.factors].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  return sorted
    .slice(0, count)
    .map((f) => f.label)
    .join(" + ");
}

function factorGloss(label: string): string {
  const map: Record<string, string> = {
    VWAP: "(session avg)",
    "γ regime": "(dealer hedge)",
    "GEX support": "(dealer bid)",
    "GEX resistance": "(dealer offer)",
    "0DTE flow": "(same-day bets)",
    "Market tide": "(broad flow)",
    TICK: "(NYSE breadth)",
    TRIN: "(up/down volume)",
    NOPE: "(net options pressure)",
    "IV rank": "(option prices)",
    "Live tape": "(institutional prints)",
    "Strike stack": "(repeated hits)",
    "News risk": "(headline skew)",
  };
  return map[label] ? ` ${map[label]}` : "";
}

function internalsLine(desk: SpxDeskPayload): string | null {
  const parts: string[] = [];
  if (desk.tick != null && Number.isFinite(desk.tick)) {
    parts.push(`TICK ${desk.tick > 0 ? "+" : ""}${fmt(desk.tick, 0)}`);
  }
  if (desk.trin != null && Number.isFinite(desk.trin)) {
    parts.push(`TRIN ${fmt(desk.trin, 2)}`);
  }
  if (desk.vix != null && Number.isFinite(desk.vix)) {
    parts.push(`VIX ${n(desk.vix, 1)}`);
  }
  return parts.length ? parts.join(" · ") : null;
}

function topFactorDetails(confluence: SpxConfluence, count = 3): string {
  return [...confluence.factors]
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, count)
    .map((f) => `${f.label}${factorGloss(f.label)}: ${f.detail}`)
    .join(" · ");
}

function flowLine(desk: SpxDeskPayload): string | null {
  const stack = desk.strike_stacks?.[0];
  if (stack) return formatFlowStrikeStackLine(stack);

  const net = desk.flow_0dte_net;
  if (net != null && Math.abs(net) > 150_000) {
    const skew = net > 0 ? "call-led" : "put-led";
    return `0DTE ${skew} net ${fmtPremium(net)}`;
  }

  const tape = desk.unified_tape?.[0];
  if (tape?.premium && tape.premium > 250_000) {
    return `${tape.kind} ${tape.label} ${fmtPremium(tape.premium)}`;
  }

  const dp = desk.dark_pool;
  if (dp?.bias && dp.bias !== "neutral" && dp.bias !== "mixed") {
    return `dark pool ${dp.bias}${dp.pcr != null ? ` PCR ${fmt(dp.pcr, 2)}` : ""}`;
  }

  if (desk.nope != null && Math.abs(desk.nope) > 0.5) {
    return `NOPE ${desk.nope > 0 ? "+" : ""}${fmt(desk.nope, 2)}`;
  }

  return null;
}

function newsLine(desk: SpxDeskPayload): string | null {
  const headline = desk.news_headlines?.[0]?.title?.trim();
  if (headline) return headline.slice(0, 80);

  const macro = desk.macro_events?.[0];
  if (macro?.time && macro?.event) {
    return `${macro.event} ${macro.time}`;
  }

  if (desk.vix_change_pct != null && Math.abs(desk.vix_change_pct) >= 3) {
    return `VIX ${desk.vix_change_pct >= 0 ? "+" : ""}${fmt(desk.vix_change_pct, 1)}%`;
  }

  return null;
}

function deltaLine(delta: string[]): string | null {
  const material = delta.filter(
    (d) => !d.startsWith("Initial desk") && !d.startsWith("Tape quiet")
  );
  if (material.length === 0) return null;
  return material.slice(0, 2).join(" · ");
}

function liveEngineConflict(cross: SpxDeskBriefCross | undefined, bias: SpxConfluence["bias"]): string | null {
  const op = cross?.openPlay;
  if (op && op.status === "open") {
    const engineBull = op.direction === "long";
    const readBull = bias === "bullish";
    const readBear = bias === "bearish";
    if ((engineBull && readBear) || (!engineBull && readBull)) {
      return `engine still ${op.direction} from ${n(op.entry_price, 0)} — read conflicts`;
    }
  }

  const pb = cross?.playbookShadow;
  const pbDir = pb?.primary_direction;
  if (pb && pb.fired_count > 0 && pbDir && pbDir !== "neutral") {
    const pbBull = pbDir === "long";
    const readBull = bias === "bullish";
    const readBear = bias === "bearish";
    if ((pbBull && readBear) || (!pbBull && readBull)) {
      return `playbook ${pb.primary_playbook_id ?? "primary"} fired ${pbDir} — read conflicts`;
    }
  }

  return null;
}

function engineLine(cross: SpxDeskBriefCross | undefined): string | null {
  const op = cross?.openPlay;
  if (!op || op.status !== "open") return null;
  const dir = op.direction === "long" ? "LONG" : "SHORT";
  const parts = [
    `ENGINE  Live {{${dir}}} from ${n(op.entry_price, 0)}`,
    op.stop != null ? `stop ${n(op.stop, 0)}` : null,
    op.target != null ? `target ${n(op.target, 0)}` : null,
    op.grade ? `grade {{${op.grade}}}` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

function lottoLine(cross: SpxDeskBriefCross | undefined): string | null {
  const lp = cross?.lotto;
  if (!lp || lp.phase === "NONE" || lp.phase === "INVALID") return null;
  const dir = lp.direction === "long" ? "CALL" : "PUT";
  const strike = lp.strike != null ? n(lp.strike, 0) : "{{—}}";
  return `LOTTO  {{${lp.phase}}} — ${dir} ${strike} — align read with lotto engine before sizing`;
}

function powerHourLine(cross: SpxDeskBriefCross | undefined): string | null {
  const ph = cross?.powerHour;
  if (!ph || ph.phase === "NONE") return null;
  const dir = ph.direction === "long" ? "CALL" : "PUT";
  const strike = ph.strike != null ? n(ph.strike, 0) : "{{—}}";
  return `POWER HOUR  {{${ph.phase}}} — ${dir} ${strike} — closing momentum lane`;
}

function tideLine(desk: SpxDeskPayload): string | null {
  const bias = desk.tide_bias;
  if (!bias || bias === "neutral") return null;
  const net = desk.tide_net;
  const netPart =
    net != null && Math.abs(net) > 100_000 ? ` net ${fmtPremium(net)}` : "";
  return `TIDE  {{${bias}}} broad flow${netPart}`;
}

function flow0dteSkew(desk: SpxDeskPayload): string | null {
  const call = desk.flow_0dte_call_premium;
  const put = desk.flow_0dte_put_premium;
  if (call == null && put == null && desk.flow_0dte_net == null) return null;
  const pcr =
    call != null && call > 0 && put != null ? put / call : null;
  const net = desk.flow_0dte_net;
  const skew =
    net != null && net > 150_000
      ? "call-led"
      : net != null && net < -150_000
        ? "put-led"
        : pcr != null && pcr > 1.1
          ? "put-skew"
          : pcr != null && pcr < 0.9
            ? "call-skew"
            : "mixed";
  const parts: string[] = [`0DTE {{${skew}}}`];
  if (pcr != null && Number.isFinite(pcr)) parts.push(`PCR ${n(pcr, 2)}`);
  if (net != null && Math.abs(net) > 50_000) parts.push(`net ${fmtPremium(net)}`);
  return parts.join(" · ");
}

function sessionExtremeLevels(desk: SpxDeskPayload, price: number): string[] {
  const extras: string[] = [];
  if (desk.hod != null && desk.hod >= price - 1) {
    extras.push(`HOD ${n(desk.hod, 0)} (${signedPts(desk.hod - price)}, session high)`);
  }
  if (desk.lod != null && desk.lod <= price + 1) {
    extras.push(`LOD ${n(desk.lod, 0)} (${signedPts(desk.lod - price)}, session low)`);
  }
  if (desk.pdh != null && Math.abs(desk.pdh - price) <= 35) {
    extras.push(`PDH ${n(desk.pdh, 0)} (${signedPts(desk.pdh - price)}, prior-day high)`);
  }
  if (desk.pdl != null && Math.abs(desk.pdl - price) <= 35) {
    extras.push(`PDL ${n(desk.pdl, 0)} (${signedPts(desk.pdl - price)}, prior-day low)`);
  }
  return extras;
}

function phaseSetupNote(sessionPhase: string, grade: SpxConfluenceGrade): string | null {
  if (sessionPhase === "final-30") return "final-30 — no new 0DTE unless already in";
  if (sessionPhase === "opening-range" && gradeRank(grade) >= 3) {
    return "opening vol — no chase, wait range break + confirm";
  }
  if (sessionPhase === "midday-grind" && gradeRank(grade) < 4) {
    return "midday chop — theta bleeds, lighter size or flat";
  }
  if (sessionPhase === "power-hour") return "power hour — squeeze risk at γflip";
  return null;
}

function phaseRiskNote(
  sessionPhase: string,
  grade: SpxConfluenceGrade,
  vix: number | null | undefined
): string | null {
  const notes: string[] = [];
  if (sessionPhase === "opening-range") notes.push("opening-range — cut size until range sets");
  if (sessionPhase === "final-30") notes.push("final-30 sit-out unless already in a trade");
  if (sessionPhase === "midday-grind" && gradeRank(grade) < 4) {
    notes.push("midday grind — forcing it bleeds accounts");
  }
  if (vix != null && vix > 20) notes.push(`VIX ${n(vix, 1)} elevated — defined-risk only`);
  return notes.length ? notes.join("; ") : null;
}

function buildWhy(
  confluence: SpxConfluence,
  desk: SpxDeskPayload,
  support: ReturnType<typeof nearestWall>,
  resistance: ReturnType<typeof nearestWall>,
  pin: number | null | undefined
): string {
  const factors = topFactors(confluence, 2);
  const factorDetails = topFactorDetails(confluence, 3);
  const gammaWord = desk.above_gamma_flip ? "above" : "below";
  const parts: string[] = [];

  if (factors) parts.push(`${factors} align`);
  if (desk.gamma_flip != null) {
    const mechanic = desk.above_gamma_flip
      ? "dealers buy dips (cushion)"
      : "dealers sell dips (fuel)";
    parts.push(
      `${gammaWord} γflip ${n(desk.gamma_flip, 0)} — ${mechanic}`
    );
  }
  if (!desk.above_gamma_flip && support && desk.price! > support.strike) {
    parts.push(`drops feed toward ${n(support.strike, 0)} air if ${n(support.strike, 0)} cracks`);
  } else if (desk.above_gamma_flip && pin != null) {
    parts.push(`pullbacks bought back toward pin ${n(pin, 0)}`);
  } else if (resistance && desk.price! < resistance.strike) {
    parts.push(`caps near ${n(resistance.strike, 0)} call wall`);
  }

  const core = parts.join("; ") || factorDetails || "Mixed tape — no single dealer mechanic dominates";
  const gloss = factorDetails && factors ? ` · ${factorDetails}` : "";
  return `WHY  ${core}${gloss}.`;
}

/** Deterministic Live Desk AI brief — same SpxCommentaryResult shape the rail expects. */
export function composeSpxDeskBrief(
  desk: SpxDeskPayload,
  confluence: SpxConfluence,
  delta: string[],
  sessionPhase: string,
  cross?: SpxDeskBriefCross,
  question?: string
): SpxDeskBriefResult {
  const price = desk.price!;
  const grade = confluence.grade;
  const verb = headlineVerb(confluence.action, grade);
  const bias = confluence.bias;
  const changePct = desk.spx_change_pct;
  const vwapDist =
    desk.vwap != null && Number.isFinite(desk.vwap) ? price - desk.vwap : null;
  const vwapClause =
    vwapDist != null
      ? `${signedPts(vwapDist)} vs VWAP`
      : desk.above_vwap
        ? "above VWAP"
        : "below VWAP";

  const headline = [
    verb,
    `${n(price, 0)}`,
    changePct != null ? `${n(changePct, 2)}%` : "",
    vwapClause,
    desk.gamma_flip != null ? `γflip ${n(desk.gamma_flip, 0)}` : "",
    `{{${grade}}} (signals)`,
    gammaTag(desk),
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);

  const support = nearestWall(desk.gex_walls, "support", price);
  const resistance = nearestWall(desk.gex_walls, "resistance", price);
  const factors = topFactors(confluence, 2);
  const pin = desk.gex_king ?? desk.max_pain;

  const why = buildWhy(confluence, desk, support, resistance, pin);
  const synthesis = synthesizeSpxDeskIntel(desk, confluence, sessionPhase, cross);
  const signals = signalsBriefLine(confluence);

  const internals = internalsLine(desk);
  const internalsLineOut = internals ? `INTERNALS  ${internals}` : null;

  const deltaText = deltaLine(delta);
  const intelDeltas = positioningDeltaSnippets(cross?.intel?.prevPositioning, cross?.intel?.positioning);
  const intelEdgeSnippet =
    cross?.intel?.intelLines?.length
      ? cross.intel.intelLines.slice(0, 2).join(" · ")
      : null;
  const mergedDelta = [deltaText, intelDeltas.length ? intelDeltas.join(" · ") : null, intelEdgeSnippet].filter(
    Boolean
  );
  const deltaSince = mergedDelta.length
    ? `Δ SINCE LAST  ${mergedDelta.join(" · ")}`
    : null;

  const levelParts: string[] = [];
  if (resistance && resistance.strike >= price) {
    levelParts.push(
      `R ${n(resistance.strike, 0)} (${signedPts(resistance.strike - price)}, call wall${resistance.net_gex != null ? ` ${fmtPremium(resistance.net_gex)}` : ""})`
    );
  }
  if (desk.gamma_flip != null) {
    levelParts.push(`γflip ${n(desk.gamma_flip, 0)}`);
  }
  if (support && support.strike <= price) {
    levelParts.push(
      `S ${n(support.strike, 0)} (${signedPts(support.strike - price)}, γwall${support.net_gex != null ? ` ${fmtPremium(support.net_gex)}` : ""})`
    );
  }
  if (pin != null && Math.abs(pin - price) <= 25) {
    levelParts.push(`pin ${n(pin, 0)} (price magnet)`);
  }
  for (const extra of sessionExtremeLevels(desk, price).slice(0, 2)) {
    levelParts.push(extra);
  }
  const levels = `LEVELS  ${levelParts.join(" · ") || `${n(price, 0)} spot only`}`;

  let setup: string;
  const { stop, target } = confluence.levels;
  const phaseNote = phaseSetupNote(sessionPhase, grade);

  if (sessionPhase === "final-30" && gradeRank(grade) < 4) {
    setup = `SETUP  No new 0DTE — final-30 manage-open-only; flat until tomorrow unless already in`;
  } else if (gradeRank(grade) >= 4 && confluence.action === "BUY_CALL") {
    setup = `SETUP  Long / trigger reclaim ${n(desk.vwap ?? desk.gamma_flip, 0)} / stop ${n(stop, 0)} / target ${n(target, 0)} / edge ${factors}`;
  } else if (gradeRank(grade) >= 4 && confluence.action === "BUY_PUT") {
    setup = `SETUP  Short / trigger reject ${n(desk.vwap ?? desk.gamma_flip, 0)} / stop ${n(stop, 0)} / target ${n(target, 0)} / edge ${factors}`;
  } else if (grade === "B" && confluence.direction) {
    const trigger = confluence.direction === "long" ? desk.vwap ?? desk.gamma_flip : desk.vwap ?? desk.gamma_flip;
    setup = `SETUP  If ${n(trigger, 0)} ${confluence.direction === "long" ? "reclaims" : "rejects"} then ${confluence.direction} toward ${n(target, 0)}`;
  } else if (sessionPhase === "midday-grind") {
    setup = `SETUP  No clean setup — midday chop, grade {{${grade}}}; flat until VWAP+γflip agree`;
  } else {
    setup = `SETUP  No clean setup — grade {{${grade}}} signals split; flat until VWAP+γflip agree`;
  }

  if (phaseNote) setup += ` (${phaseNote})`;

  const conflict = liveEngineConflict(cross, bias);
  if (conflict) setup += ` (${conflict})`;

  const pb = cross?.playbookShadow;
  const playbookLine =
    pb?.primary_playbook_id && pb.primary_name
      ? pb.mode === "live"
        ? `PLAYBOOK  LIVE {{${pb.primary_playbook_id}}} {{${pb.primary_name}}} fired (${pb.fired_count} active) — gates BUY on staging`
        : `PLAYBOOK  Shadow {{${pb.primary_playbook_id}}} {{${pb.primary_name}}} fired (${pb.fired_count} active) — informational, does not gate engine`
      : pb && pb.fired_count === 0
        ? "PLAYBOOK  Shadow — no named setup fired this window"
        : null;

  const ivRank = desk.uw_iv_rank;
  const size = sizeLabel(grade);
  const staleNote =
    desk.gex_stale || desk.feed_stalled
      ? " GEX/feed stale — lighter size until refresh."
      : "";
  const structure =
    ivRank != null && ivRank > 50
      ? "debit spread (capped risk)"
      : ivRank != null && ivRank < 30
        ? "single long OK"
        : "defined-risk only";
  const phaseRisk = phaseRiskNote(sessionPhase, grade, desk.vix);
  const riskTail = phaseRisk ? ` ${phaseRisk}.` : "";
  const risk = `RISK  Size {{${size}}} — {{${grade}}}; IV rank ${ivRank != null ? n(ivRank, 0) : "{{—}}"} → ${structure}; max loss = premium paid; phase {{${sessionPhase}}}.${riskTail}${staleNote}`;

  const next =
    sessionPhase === "power-hour" && !desk.above_gamma_flip && resistance
      ? `NEXT 5M  power-hour neg-γ squeeze risk into ${n(resistance.strike, 0)} if ${n(support?.strike ?? desk.lod, 0)} fails`
      : desk.above_gamma_flip && support
        ? `NEXT 5M  pos-γ pin toward ${n(pin ?? support.strike, 0)} — fade extensions`
        : !desk.above_gamma_flip && resistance
          ? `NEXT 5M  neg-γ expansion into ${n(resistance.strike, 0)} air if ${n(support?.strike ?? desk.lod, 0)} fails`
          : `NEXT 5M  ${gammaTag(desk)} — watch ${n(desk.gamma_flip ?? price, 0)} and TICK`;

  const flipLevel = stop ?? desk.gamma_flip ?? desk.vwap;
  const flips = `FLIPS IT  ${confluence.direction === "long" ? "Lose" : confluence.direction === "short" ? "Reclaim" : "Break"} ${n(flipLevel, 0)} = thesis dead — go flat.`;

  // Shared voice brain (spx-live-voice.ts): the SAME 3–4 sentence BIE read the SPX rail
  // pins client-side leads the Largo Q&A brief, so the terminal and the rail can never
  // disagree on the bias/mechanic/posture. Voice numbers are desk values verbatim (or
  // their rounding) — inside verifyClaims' 0.5% tolerance by construction.
  const voiceSnap = voiceSnapshotFromDesk(desk);
  const voiceRead = composeBiasVoice(voiceSnap, deriveSpxBias(voiceSnap));

  const bodyLines = [
    ...detectPremiseCorrections(question ?? "", desk),
    `READ  ${voiceRead}`,
    synthesis.thesis,
    synthesis.mechanic,
    why,
    signals,
    synthesis.alignment,
    synthesis.friction,
    internalsLineOut,
    deltaSince,
    levels,
    playbookLine,
  ].filter(Boolean) as string[];

  const dealers = dealersBriefLine(cross?.intel);
  if (dealers) bodyLines.push(dealers);

  const walls = wallsBriefLine(cross?.intel, price);
  if (walls) bodyLines.push(walls);

  const crosschk = crossCheckBriefLine(cross?.intel);
  if (crosschk) bodyLines.push(crosschk);

  const chart = chartBriefLine(desk);
  if (chart) bodyLines.push(chart);

  const expiry = expiryBriefLine(desk);
  if (expiry) bodyLines.push(expiry);

  bodyLines.push(setup, risk, next, flips);

  const engine = engineLine(cross);
  if (engine) bodyLines.push(engine);

  const lotto = lottoLine(cross);
  if (lotto) bodyLines.push(lotto);

  const powerHour = powerHourLine(cross);
  if (powerHour) bodyLines.push(powerHour);

  const tide = tideLine(desk);
  if (tide) bodyLines.push(tide);

  const vol = volBriefLine(desk);
  if (vol) bodyLines.push(vol);

  const breadth = breadthBriefLine(desk);
  if (breadth) bodyLines.push(breadth);

  const mag7 = mag7BriefLine(desk);
  if (mag7) bodyLines.push(mag7);

  const nh = nighthawkBriefLine(cross?.intel);
  if (nh) bodyLines.push(nh);

  const edges = edgesBriefLine(cross?.intel);
  if (edges && !deltaSince) bodyLines.push(edges);

  const flowSkew = flow0dteSkew(desk);
  const flow = flowLine(desk);
  if (flow || flowSkew) {
    const flowBody = [flowSkew, flow].filter(Boolean).join(" · ");
    bodyLines.push(
      `FLOW  ${flowBody} — confirms ${bias === "bullish" ? "bid" : bias === "bearish" ? "offer" : "two-way"} tone`
    );
  }

  const news = newsLine(desk);
  if (news) bodyLines.push(`NEWS  {{${news}}}`);

  if (cross?.precedentDetail) {
    bodyLines.push(`PRECEDENT  ${cross.precedentDetail}`);
  }

  const oc = cross?.outcomes;
  if (oc && oc.total_closed >= 5 && oc.overall.win_rate != null) {
    const wr = Math.round(oc.overall.win_rate * 100);
    bodyLines.push(
      "TRACK  Desk win rate {{" +
        wr +
        "}}% ({{" +
        oc.overall.wins +
        "}}-{{" +
        oc.overall.losses +
        "}} last {{" +
        oc.total_closed +
        "}} closed)"
    );
  }

  return {
    headline,
    bias,
    body: bodyLines.join("\n"),
    watch: synthesis.watch,
    changed: [],
    as_of: new Date().toISOString(),
  };
}

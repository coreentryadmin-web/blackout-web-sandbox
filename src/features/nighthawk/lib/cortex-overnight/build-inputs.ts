// NIGHT HAWK CORTEX — OVERNIGHT lens: the edition-time input assembler.
//
// The overnight lens runs at edition-publish time, when the evening build has ALREADY
// fetched everything it needs (the market-wide ctx + the per-ticker dossiers). So this
// assembler does NO new IO — it MAPS the already-fetched structures into the pure
// composer's OvernightInputs snapshot. It mirrors the intraday cortex's fetch.ts SHAPE
// (per-source, fail-soft, honest per-source absent markers) but over in-memory data:
// each slice extractor is wrapped so a malformed structure THROWS into a recorded
// per-source error class (surfaced verbatim in that source's absent reason) rather than
// taking the whole lens down — Promise.allSettled over the extractors, exactly the
// fail-soft discipline the intraday assembler uses for its live readers.
//
// Every field is best-effort and honest: when a value cannot be cleanly extracted the
// slice (or the field) is left null and the corresponding source reports `absent`. The
// composer's total-outage ABSTAIN then rides on the publish gates alone — a mapping gap
// never fabricates evidence and never blocks the book.

import type { PlaybookPlay } from "../types";
import type { TickerDossier } from "../dossier";
import { parsePlayLevels } from "../play-levels";
import type {
  OvernightInputs,
  OvernightSourceId,
  OvernightDirection,
  OvernightCatalystSlice,
  OvernightWallSlice,
  OvernightDarkPoolSlice,
  OvernightIvSlice,
  OvernightSectorSlice,
  OvernightFlowSlice,
  OvernightWallSample,
  OvernightBinaryEvent,
  EarningsReportTime,
} from "./types";

/** The subset of the market-wide ctx the overnight lens reads — structural so callers
 *  pass the real MarketWideContext without this module importing its heavy type graph. */
export type OvernightBuildCtx = {
  today: string;
  tomorrow: string;
  tomorrow_earnings: Record<string, unknown>[];
  sector_performance: Array<{ name: string; change_pct: number }>;
  market_breadth: { pct_advancing?: number | null } | null;
};

export type BuildOvernightInputsArgs = {
  play: PlaybookPlay;
  dossier: TickerDossier | null;
  ctx: OvernightBuildCtx;
  /** Composition clock (ISO) — threaded, never Date.now() inside the composer. */
  now: string;
  /** The play's grading horizon (target session, YYYY-MM-DD) — usually editionFor. */
  horizonDate: string;
  /** Optional multi-day/session opposing-wall history rail, when the recorder persisted
   *  one for this ticker. Absent → the migration half of wall-migration is absent. */
  wallSamples?: OvernightWallSample[];
};

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

/** LONG unless the play direction clearly says SHORT (matches the edition builder's
 *  own direction normalization). */
export function normalizeDirection(direction: unknown): OvernightDirection {
  return str(direction).toUpperCase().includes("SHORT") ? "short" : "long";
}

/** Deterministic detection of an EXPLICIT catalyst/earnings play — the §3.4 veto
 *  exemption. Keyword scan of the member-facing thesis/signal text (no LLM): a play
 *  that openly says it is trading an earnings/binary/FDA event is one the member entered
 *  KNOWING the event lands in the hold. Conservative on purpose — a passing mention
 *  won't trip it, but "earnings play"/"into earnings"/"FDA catalyst" will. */
const CATALYST_PLAY_RE =
  /\b(earnings\s+play|into\s+earnings|earnings\s+run|pre[-\s]?earnings|catalyst\s+play|binary\s+(?:event\s+)?play|fda\s+(?:catalyst|decision|play)|pdufa|event[-\s]?driven)\b/i;

export function detectCatalystPlay(play: PlaybookPlay): boolean {
  const hay = `${str(play.thesis)} ${str(play.key_signal)} ${str(play.risk_note)}`;
  return CATALYST_PLAY_RE.test(hay);
}

/** Regime string (positioning.gamma_regime) → the lens's coarse posture enum. */
function mapRegime(regime: unknown): OvernightWallSlice["regime"] {
  const r = str(regime).toLowerCase();
  if (r.includes("positive") || r.includes("long")) return "long";
  if (r.includes("negative") || r.includes("short")) return "short";
  if (r.includes("transition") || r.includes("flip")) return "transition";
  return "unknown";
}

/** Pull "call wall $X" / "put wall $X" strikes out of a positioning.wall_summary string.
 *  Fail-soft: returns null when the side isn't present/parseable. */
export function parseWallStrike(wallSummary: string, side: "call" | "put"): number | null {
  const re = new RegExp(`${side}\\s+wall[^$]*\\$\\s*([0-9]+(?:\\.[0-9]+)?)`, "i");
  const m = re.exec(wallSummary);
  return m ? num(m[1]) : null;
}

/** Match a dossier SIC/sector label to a ctx.sector_performance row (loose substring,
 *  either direction). Returns the row's change_pct, or null when no confident match. */
export function sectorChangeFor(
  sectorLabel: string | null,
  perf: Array<{ name: string; change_pct: number }>
): { name: string; changePct: number } | null {
  if (!sectorLabel) return null;
  const a = sectorLabel.toLowerCase();
  for (const row of perf) {
    const b = str(row.name).toLowerCase();
    if (!b) continue;
    if (a.includes(b) || b.includes(a)) {
      const c = num(row.change_pct);
      if (c != null) return { name: row.name, changePct: c };
    }
  }
  return null;
}

/** Latest print timestamp across a dossier flows array, best-effort across the common
 *  UW timestamp field names; null when none parse. */
export function latestFlowTimestamp(flows: Record<string, unknown>[]): string | null {
  let bestMs = -Infinity;
  let bestIso: string | null = null;
  for (const f of flows) {
    const raw = f.executed_at ?? f.created_at ?? f.time ?? f.timestamp ?? f.start_time ?? f.date;
    if (raw == null) continue;
    const ms = Date.parse(String(raw));
    if (Number.isFinite(ms) && ms > bestMs) {
      bestMs = ms;
      bestIso = new Date(ms).toISOString();
    }
  }
  return bestIso;
}

/** Report time from a tomorrow_earnings calendar row. */
function earningsReportTime(row: Record<string, unknown> | undefined): EarningsReportTime | null {
  if (!row) return null;
  const t = str(row.report_time ?? row.time ?? row.when ?? row.session).toLowerCase();
  if (t.includes("pre") || t.includes("before") || t.includes("bmo")) return "premarket";
  if (t.includes("after") || t.includes("post") || t.includes("amc")) return "afterhours";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Slice extractors — each pure over the passed-in structures, each may throw
// (caught by buildOvernightInputs into a per-source error class).
// ---------------------------------------------------------------------------

function extractCatalyst(args: BuildOvernightInputsArgs): OvernightCatalystSlice | null {
  const { play, dossier, ctx } = args;
  const sym = str(play.ticker).toUpperCase();
  const earnRow = ctx.tomorrow_earnings.find((r) => str(r.ticker ?? r.symbol).toUpperCase() === sym);
  const earningsDate = earnRow ? ctx.tomorrow : null;
  const binaryEvents: OvernightBinaryEvent[] = [];
  if (dossier) {
    for (const c of dossier.catalysts ?? []) {
      if (c.type === "binary") {
        binaryEvents.push({ kind: c.channel || "binary", date: c.published ? str(c.published).slice(0, 10) : null, label: str(c.title).slice(0, 80) });
      }
    }
    for (const ev of dossier.fda_events ?? []) {
      const d = ev.date ?? ev.pdufa_date ?? ev.catalyst_date ?? ev.expected_date;
      binaryEvents.push({ kind: "fda", date: d ? str(d).slice(0, 10) : null, label: str(ev.drug ?? ev.indication ?? ev.title ?? "FDA event").slice(0, 80) });
    }
  }
  // Nothing to say only when the calendar itself is missing — an empty calendar with a
  // present ctx is a real "no earnings" read (handled by the source as a clear support).
  return {
    asOf: args.now,
    earningsDate,
    earningsReportTime: earningsReportTime(earnRow),
    binaryEvents,
    isCatalystPlay: detectCatalystPlay(play),
  };
}

function extractWall(args: BuildOvernightInputsArgs): OvernightWallSlice | null {
  const { play, dossier } = args;
  const pos = dossier?.positioning;
  if (!pos) return null;
  const dir = normalizeDirection(play.direction);
  const wallSummary = str(pos.wall_summary);
  const strike = parseWallStrike(wallSummary, dir === "long" ? "call" : "put");
  const target = parsePlayLevels(play).target;
  return {
    asOf: args.now,
    spot: null, // live per-ticker spot isn't cleanly available at this point; narrative-only
    gammaFlip: num(pos.gamma_flip),
    regime: mapRegime(pos.gamma_regime),
    opposingWall: strike != null ? { strike, kind: dir === "long" ? "call" : "put" } : null,
    target,
    samples: args.wallSamples ?? [],
  };
}

function extractDarkPool(args: BuildOvernightInputsArgs): OvernightDarkPoolSlice | null {
  const dp = args.dossier?.dark_pool;
  if (!dp) return null;
  const biasRaw = str(dp.bias).toLowerCase();
  const bias: OvernightDarkPoolSlice["bias"] =
    biasRaw === "bullish" || biasRaw === "bearish" || biasRaw === "mixed" || biasRaw === "neutral" ? biasRaw : "unknown";
  return {
    asOf: args.now,
    bias,
    totalPremium: num(dp.total_premium) ?? 0,
    callPremium: num(dp.call_premium) ?? 0,
    putPremium: num(dp.put_premium) ?? 0,
  };
}

function extractIv(args: BuildOvernightInputsArgs): OvernightIvSlice | null {
  const d = args.dossier;
  if (!d) return null;
  const term = (d.iv_term ?? [])
    .map((t) => ({ expiry: str(t.expiry), iv: num(t.iv) ?? NaN }))
    .filter((t) => t.expiry && Number.isFinite(t.iv));
  if (d.iv_rank == null && term.length === 0) return null;
  return { asOf: args.now, ivRank: num(d.iv_rank), term, realizedVol: num(d.realized_vol) };
}

function extractSector(args: BuildOvernightInputsArgs): OvernightSectorSlice | null {
  const { dossier, ctx } = args;
  const sectorLabel = dossier?.sector ?? null;
  const match = sectorChangeFor(sectorLabel, ctx.sector_performance ?? []);
  const pctAdv = ctx.market_breadth?.pct_advancing;
  const breadthFrac = pctAdv != null && Number.isFinite(Number(pctAdv)) ? Number(pctAdv) / 100 : null;
  if (match == null && breadthFrac == null) return null;
  return {
    asOf: args.now,
    sectorName: match?.name ?? sectorLabel,
    sectorChangePct: match?.changePct ?? null,
    breadthAdvancingFrac: breadthFrac,
    tickerChangePct: null,
  };
}

function extractFlow(args: BuildOvernightInputsArgs): OvernightFlowSlice | null {
  const d = args.dossier;
  if (!d) return null;
  const streakDays = d.flow_streak ? num(d.flow_streak.streak_days) : null;
  const flows = Array.isArray(d.flows) ? d.flows : [];
  const flowCount = flows.length;
  if (streakDays == null && flowCount === 0) return null;
  return {
    asOf: args.now,
    streakDays,
    flowCount,
    lastPrintAt: latestFlowTimestamp(flows),
  };
}

/**
 * Assemble the OvernightInputs snapshot from the edition's already-fetched structures.
 * Fail-soft per source (Promise.allSettled over the extractors): a thrown extractor is
 * recorded as that source's error class and its slice left null (→ source absent),
 * never propagated.
 */
export async function buildOvernightInputs(args: BuildOvernightInputsArgs): Promise<OvernightInputs> {
  const errors: Partial<Record<OvernightSourceId, string>> = {};

  // Each extractor is sync over in-memory data, but wrapped in a thunk + allSettled so
  // one malformed dossier field cannot take the whole snapshot down (fail-soft mirror
  // of the intraday assembler's per-reader isolation).
  const jobs: Array<{ source: OvernightSourceId; run: () => unknown }> = [
    { source: "catalyst-veto", run: () => extractCatalyst(args) },
    { source: "wall-migration", run: () => extractWall(args) },
    { source: "darkpool-trend", run: () => extractDarkPool(args) },
    { source: "iv-term", run: () => extractIv(args) },
    { source: "sector-breadth", run: () => extractSector(args) },
    { source: "flow-persistence", run: () => extractFlow(args) },
  ];

  const settled = await Promise.allSettled(jobs.map((j) => Promise.resolve().then(j.run)));
  const bySource = new Map<OvernightSourceId, unknown>();
  settled.forEach((res, i) => {
    const { source } = jobs[i];
    if (res.status === "fulfilled") {
      bySource.set(source, res.value);
    } else {
      errors[source] = res.reason instanceof Error ? res.reason.message : String(res.reason);
      bySource.set(source, null);
    }
  });

  return {
    ticker: str(args.play.ticker).toUpperCase(),
    direction: normalizeDirection(args.play.direction),
    now: args.now,
    horizonDate: args.horizonDate,
    catalyst: (bySource.get("catalyst-veto") as OvernightCatalystSlice | null) ?? null,
    wall: (bySource.get("wall-migration") as OvernightWallSlice | null) ?? null,
    darkPool: (bySource.get("darkpool-trend") as OvernightDarkPoolSlice | null) ?? null,
    iv: (bySource.get("iv-term") as OvernightIvSlice | null) ?? null,
    sector: (bySource.get("sector-breadth") as OvernightSectorSlice | null) ?? null,
    flow: (bySource.get("flow-persistence") as OvernightFlowSlice | null) ?? null,
    errors,
  };
}

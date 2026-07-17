import "server-only";

import type { BieComposed } from "@/lib/bie/composers-shared";
import type { VectorFullState } from "@/lib/bie/vector-full-state";
import type { VectorDteHorizon } from "@/features/vector/lib/vector-dte-horizon";
import type { FlowAlert } from "@/lib/api";
import { markdownTable } from "@/lib/bie/markdown-table";
import { toProfessionalMarkdown } from "@/lib/bie/professional-tone";
import { professionalizePulseSignals } from "@/lib/bie/pulse-signal-tone";
import { callInternalApiRead } from "@/lib/bie/internal-api";
import {
  buildPulseSnapshot,
  detectPulseSignals,
  detectPlayStateSignals,
  filterFreshPulseSignals,
  wallEventToPulseSignal,
  flowAlertToPulseSignal,
  isSignificantFlow,
  type PulseSignal,
  type PlayStateSnapshot,
} from "@/features/vector/lib/vector-pulse";
import { deriveVectorRegime } from "@/features/vector/lib/vector-regime";
import { normalizeVectorTicker } from "@/features/vector/lib/vector-ticker";
import {
  regimeBriefLine,
  wallsBriefLine,
  magnetBriefLine,
  wallDynamicsBriefLine,
  technicalsBriefLine,
  knownVectorNumbers,
} from "@/lib/bie/vector-desk-intel";
import {
  readVectorPulseCache,
  writeVectorPulseCache,
  type VectorPulseCacheEntry,
} from "@/lib/bie/vector-pulse-snapshot-cache";

const fmt = (n: unknown, d = 0): string =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("en-US", { maximumFractionDigits: d })
    : "—";

function regimeFromState(state: VectorFullState) {
  const spot = state.spot ?? null;
  const flip = state.gammaFlip ?? null;
  const call = state.gexWalls?.callWalls?.[0]?.strike ?? null;
  const put = state.gexWalls?.putWalls?.[0]?.strike ?? null;
  return deriveVectorRegime({ spot, gammaFlip: flip, topCallWall: call, topPutWall: put });
}

function confluenceCallouts(state: VectorFullState): string[] {
  const zones = state.confluenceZones ?? [];
  return zones.slice(0, 4).map((z) => {
    const kinds = z.kinds.join(" + ");
    return `**${fmt(z.center, 0)}** — ${kinds} (score ${fmt(z.score, 1)})`;
  });
}

function formatSignalsTable(signals: PulseSignal[]): string {
  if (!signals.length) return "";
  const rows = signals.slice(0, 12).map((sig) => [
    sig.tone.toUpperCase(),
    sig.kind.replace(/-/g, " "),
    sig.line.replace(/\*\*/g, "").trim(),
  ]);
  return markdownTable(["Tone", "Type", "Signal"], rows);
}

function stripGrounding(s: string): string {
  return s.replace(/\{\{|\}\}/g, "");
}

function playSnapshotFromSpxPlay(play: {
  phase: string;
  direction: string | null;
  grade: string;
  headline: string;
  score: number;
  option_ticket?: { contract_label?: string | null } | null;
}): PlayStateSnapshot {
  const phase =
    play.phase === "OPEN" || play.phase === "WATCHING" || play.phase === "SCANNING"
      ? play.phase
      : "SCANNING";
  return {
    phase,
    direction: play.direction,
    grade: play.grade,
    headline: play.headline,
    score: play.score,
    optionLabel: play.option_ticket?.contract_label ?? null,
  };
}

async function loadHelixFlowSignals(
  ticker: string,
  seenFlowIds: Set<string>,
  nowMs: number
): Promise<PulseSignal[]> {
  const sym = normalizeVectorTicker(ticker);
  const res = await callInternalApiRead("/api/market/flows", {
    ticker: sym,
    limit: 20,
    min_premium: 500_000,
  });
  if (!res.ok || !res.data || typeof res.data !== "object") return [];
  const flows = (res.data as { flows?: FlowAlert[] }).flows ?? [];
  const out: PulseSignal[] = [];
  for (const flow of flows) {
    if (!isSignificantFlow(flow)) continue;
    const id = flow.alert_id ?? `${flow.ticker}:${flow.strike}:${flow.expiry}:${flow.alerted_at}`;
    if (seenFlowIds.has(id)) continue;
    seenFlowIds.add(id);
    const sig = flowAlertToPulseSignal(flow, nowMs);
    if (sig) out.push(sig);
  }
  return out;
}

async function loadSpxPlaySignals(
  prevPlay: PlayStateSnapshot | null | undefined,
  nowMs: number
): Promise<{ signals: PulseSignal[]; playState: PlayStateSnapshot | null }> {
  try {
    const { getSpxPlayState } = await import("@/features/spx/lib/spx-service");
    const play = await getSpxPlayState();
    if (!play?.available) return { signals: [], playState: prevPlay ?? null };
    const current = playSnapshotFromSpxPlay(play);
    const signals = detectPlayStateSignals(prevPlay ?? null, current, nowMs);
    return { signals, playState: current };
  } catch {
    return { signals: [], playState: prevPlay ?? null };
  }
}

/** Intel cards mirrored from Vector Pulse (regime hero + static context). */
export function formatVectorPulseIntel(state: VectorFullState): string[] {
  const regime = regimeFromState(state);
  const lines: string[] = [`**${regime.headline}** — ${regime.read}`];
  if (state.spot != null) lines.push(`Spot **${fmt(state.spot, 2)}** · as of ${state.asOf}`);
  if (state.proximity?.callout) lines.push(`**Proximity:** ${state.proximity.callout}`);
  for (const l of [
    regimeBriefLine(state),
    wallsBriefLine(state),
    wallDynamicsBriefLine(state),
    magnetBriefLine(state),
    technicalsBriefLine(state),
  ]) {
    if (l) lines.push(stripGrounding(l));
  }
  const conf = confluenceCallouts(state);
  if (conf.length) {
    lines.push("", "**Confluence**");
    lines.push(...conf.map((c) => `- ${c}`));
  }
  if (state.play) {
    lines.push(
      "",
      `**Play engine:** ${state.play.headline} · grade **${state.play.grade}** · ${state.play.bias.toUpperCase()} ${state.play.style}`
    );
  }
  return lines;
}

export async function buildPulseSignalsForState(
  state: VectorFullState,
  cached: VectorPulseCacheEntry | null,
  nowMs: number
): Promise<{
  fresh: PulseSignal[];
  cacheEntry: VectorPulseCacheEntry;
  current: ReturnType<typeof buildPulseSnapshot>;
}> {
  const regime = regimeFromState(state);
  const integ = state.wallIntegrity ?? { call: null, put: null };
  const current = buildPulseSnapshot({
    at: nowMs,
    regime,
    proximity: state.proximity ?? null,
    magnet: state.magnet ?? null,
    wallIntegrity: integ,
    wallEventCount: state.wallEvents.length,
  });

  const prev = cached?.snapshot ?? null;
  const seenAt = cached?.seenAtByKey ?? {};
  let processedWall = cached?.processedWallEventCount ?? 0;
  const seenFlowIds = new Set(cached?.seenFlowIds ?? []);

  const rawSignals: PulseSignal[] = detectPulseSignals(prev, current);

  if (!prev && state.wallEvents.length > 0) {
    for (const ev of state.wallEvents.slice(-8)) {
      rawSignals.push(wallEventToPulseSignal(ev));
    }
    processedWall = state.wallEvents.length;
  } else {
    const newWallCount = state.wallEvents.length - processedWall;
    if (newWallCount > 0) {
      for (const ev of state.wallEvents.slice(processedWall)) {
        rawSignals.push(wallEventToPulseSignal(ev));
      }
      processedWall = state.wallEvents.length;
    }
  }

  const sym = normalizeVectorTicker(state.ticker);
  let nextPlayState: PlayStateSnapshot | null = cached?.playState ?? null;
  if (sym === "SPX") {
    const { signals: playSigs, playState } = await loadSpxPlaySignals(cached?.playState, nowMs);
    rawSignals.push(...playSigs);
    nextPlayState = playState;
  }

  const flowSigs = await loadHelixFlowSignals(sym, seenFlowIds, nowMs);
  rawSignals.push(...flowSigs);

  professionalizePulseSignals(rawSignals);

  const { fresh, seen } = filterFreshPulseSignals(rawSignals, seenAt, nowMs);
  professionalizePulseSignals(fresh);

  return {
    fresh,
    current,
    cacheEntry: {
      snapshot: current,
      seenAtByKey: seen,
      processedWallEventCount: processedWall,
      playState: nextPlayState ?? null,
      seenFlowIds: Array.from(seenFlowIds).slice(-120),
      updatedAt: new Date(nowMs).toISOString(),
    },
  };
}

export function formatVectorPulseMarkdown(
  state: VectorFullState,
  fresh: PulseSignal[],
  hadPrev: boolean
): string {
  const sym = state.ticker.toUpperCase();
  const lines: string[] = [
    `**Vector Pulse — ${sym} (${state.horizon.toUpperCase()})**`,
    "",
    "_Same live commentator as the Vector page — walls, beads, regime, proximity, magnet, flow._",
    "",
    ...formatVectorPulseIntel(state),
    "",
    "**SIGNALS**",
  ];

  if (fresh.length === 0) {
    lines.push(
      hadPrev
        ? "_No new transitions since your last ask — structure is stable. Ask for the full desk read or a specific wall._"
        : "_First pulse on this ticker — session wall events and live intel above. Ask again after the next refresh to see transitions._"
    );
  } else {
    lines.push(formatSignalsTable(fresh));
  }

  if (state.wallEvents.length > 0) {
    lines.push("", "**Recent bead / wall dynamics (session rail)**");
    for (const ev of state.wallEvents.slice(-6)) {
      lines.push(`- ${ev.message}`);
    }
  }

  lines.push(
    "",
    `_Full SETUP / PLAY: ask **Vector setup on ${sym}** · build/fade: **which walls are building vs fading on ${sym}**._`
  );

  return lines.join("\n");
}

export async function composeVectorPulseRead(
  ticker: string,
  horizon: VectorDteHorizon,
  _question?: string,
  timeframeMin?: number
): Promise<BieComposed | null> {
  const [{ fetchVectorFullState }, { noLiveVectorStateMessage }] = await Promise.all([
    import("@/lib/bie/vector-full-state"),
    import("@/lib/bie/vector-read-fallback").then((m) => ({ noLiveVectorStateMessage: m.noLiveVectorStateMessage })),
  ]);

  const state = await fetchVectorFullState(ticker, horizon, timeframeMin);
  if (!state) {
    return {
      answer: toProfessionalMarkdown(noLiveVectorStateMessage(ticker)),
      context: { ticker: ticker.toUpperCase(), reason: "no_live_state", missing: true },
    };
  }

  const nowMs = Date.parse(state.asOf) || Date.now();
  const cached = await readVectorPulseCache(ticker, horizon);
  const { fresh, cacheEntry, current } = await buildPulseSignalsForState(state, cached, nowMs);
  await writeVectorPulseCache(ticker, horizon, cacheEntry);

  const answer = formatVectorPulseMarkdown(state, fresh, Boolean(cached?.snapshot));

  return {
    answer: toProfessionalMarkdown(answer),
    context: {
      state,
      known: knownVectorNumbers(state),
      pulse: { signals: fresh, snapshot: current, prev: cached?.snapshot ?? null },
    },
  };
}

/** Pulse SIGNALS + bead rail section — append to vector_read when the question names Pulse. */
export async function appendVectorPulseSection(
  state: VectorFullState
): Promise<{ markdown: string; signals: PulseSignal[] }> {
  const nowMs = Date.parse(state.asOf) || Date.now();
  const cached = await readVectorPulseCache(state.ticker, state.horizon);
  const { fresh, cacheEntry } = await buildPulseSignalsForState(state, cached, nowMs);
  await writeVectorPulseCache(state.ticker, state.horizon, cacheEntry);

  const partial = formatVectorPulseMarkdown(state, fresh, Boolean(cached?.snapshot));
  const idx = partial.indexOf("**SIGNALS**");
  const markdown = idx >= 0 ? `\n\n---\n\n${partial.slice(idx)}` : "";
  return { markdown, signals: fresh };
}

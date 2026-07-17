import "server-only";

import type { BieComposed } from "@/lib/bie/composers-shared";
import type { VectorFullState } from "@/lib/bie/vector-full-state";
import type { VectorDteHorizon } from "@/features/vector/lib/vector-dte-horizon";
import { toProfessionalMarkdown } from "@/lib/bie/professional-tone";
import {
  buildPulseSnapshot,
  detectPulseSignals,
  filterFreshPulseSignals,
  wallEventToPulseSignal,
  type PulseSignal,
} from "@/features/vector/lib/vector-pulse";
import { deriveVectorRegime } from "@/features/vector/lib/vector-regime";
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

function formatSignalLine(sig: PulseSignal): string {
  const tone = sig.tone.toUpperCase();
  return `- **[${tone}]** ${sig.line}`;
}

function stripGrounding(s: string): string {
  return s.replace(/\{\{|\}\}/g, "");
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

export function buildPulseSignalsForState(
  state: VectorFullState,
  cached: VectorPulseCacheEntry | null,
  nowMs: number
): { fresh: PulseSignal[]; cacheEntry: VectorPulseCacheEntry; current: ReturnType<typeof buildPulseSnapshot> } {
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
  let seenAt = cached?.seenAtByKey ?? {};
  let processedWall = cached?.processedWallEventCount ?? 0;

  const rawSignals: PulseSignal[] = detectPulseSignals(prev, current);

  const newWallCount = state.wallEvents.length - processedWall;
  if (newWallCount > 0) {
    for (const ev of state.wallEvents.slice(processedWall)) {
      rawSignals.push(wallEventToPulseSignal(ev));
    }
    processedWall = state.wallEvents.length;
  }

  if (!prev && state.wallEvents.length > 0) {
    for (const ev of state.wallEvents.slice(-8)) {
      rawSignals.push(wallEventToPulseSignal(ev));
    }
  }

  const { fresh, seen } = filterFreshPulseSignals(rawSignals, seenAt, nowMs);

  return {
    fresh,
    current,
    cacheEntry: {
      snapshot: current,
      seenAtByKey: seen,
      processedWallEventCount: processedWall,
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
    "_Same live commentator as the Vector page — walls, beads, regime, proximity, magnet._",
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
    for (const sig of fresh.slice(0, 12)) {
      lines.push(formatSignalLine(sig));
    }
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
  const { fresh, cacheEntry, current } = buildPulseSignalsForState(state, cached, nowMs);
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
  const { fresh, cacheEntry } = buildPulseSignalsForState(state, cached, nowMs);
  await writeVectorPulseCache(state.ticker, state.horizon, cacheEntry);

  const partial = formatVectorPulseMarkdown(state, fresh, Boolean(cached?.snapshot));
  const idx = partial.indexOf("**SIGNALS**");
  const markdown = idx >= 0 ? `\n\n---\n\n${partial.slice(idx)}` : "";
  return { markdown, signals: fresh };
}

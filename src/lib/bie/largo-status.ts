import type { BieRoute } from "@/lib/bie/router";

/** Where Largo is in the turn pipeline — drives status copy. */
export type LargoStatusPhase = "boot" | "prefetch" | "route" | "compose" | "enrich" | "providers";

const GLOBAL_LINES: Record<LargoStatusPhase, string[]> = {
  boot: [
    "Spinning up the intelligence stack…",
    "Warming the live desk mesh…",
    "Handshake with platform readers…",
  ],
  prefetch: [
    "Syncing Polygon tape with the desk…",
    "Pulling Unusual Whales flow into cache…",
    "Waking Redis — last session's heat still warm…",
    "RDS snapshot online — querying platform truth…",
    "HELIX tape indexing in the background…",
    "Thermal matrix pre-heating…",
    "Cross-tool state fan-out (desk · engine · NH)…",
  ],
  route: [
    "Mapping your question to the right read…",
    "Classifying intent across 40+ platform lenses…",
    "Choosing the fastest path to live data…",
  ],
  compose: [
    "Composing from the same readers the dashboards use…",
    "Stacking confluence · walls · flow into one read…",
    "Running deterministic synthesis — no guesswork…",
  ],
  enrich: [
    "Answer looks thin — opening a live refresh lane…",
    "Cortex is paging Polygon for a fresh quote…",
    "Unusual Whales on speed-dial for flow…",
    "Talking to HELIX — largest prints this session…",
    "Thermal re-pull — GEX / VEX / DEX lenses…",
    "Redis miss — fetching straight from the wire…",
    "RDS round-trip for historical context…",
    "This one needs the full stack — give me a beat…",
  ],
  providers: [
    "Polygon: live bars + chain geometry…",
    "Unusual Whales: dark pool + sweeps…",
    "Internal API: governed platform GET…",
    "WebSocket bridge: coalescing tick updates…",
  ],
};

const INTENT_LINES: Partial<Record<string, string[]>> = {
  spx_desk_read: [
    "SPX Slayer desk — live γ-flip + confluence…",
    "Reading dealer positioning on SPX 0DTE…",
    "Cortex pinned evidence + desk invalidation…",
  ],
  spx_structure: ["SPX structure ladder — walls · flip · king node…"],
  helix_read: ["HELIX flow tape — ranking prints by premium…"],
  thermal_read: ["BlackOut Thermal — full GEX matrix lens…"],
  technical_read: ["Polygon technicals — EMA stack · RSI · ATR…"],
  wall_dynamics_read: ["Wall dynamics — build/fade on the γ ladder…"],
  play_suggest_read: ["Play engine — ticket from live confluence…"],
  play_engine_read: ["Slayer · Lotto · Power Hour state check…"],
  market_context: ["Market context — breadth · tide · regime…"],
  ticker_advice: ["Vector + quote stack for this name…"],
  vector_read: ["Vector desk — positioning rail for this ticker…"],
  vector_pulse_read: [
    "Vector Pulse — regime · walls · beads · proximity…",
    "Diffing transitions against the last snapshot…",
    "Reading bead rail + wall-structure events…",
    "HELIX flow lane — significant prints into Pulse…",
    "SPX play engine — OPEN / WATCHING transitions…",
  ],
  verdict: ["Cross-tool verdict — grading the setup…"],
  cortex_read: ["Cortex ledger — why we committed or passed…"],
  nighthawk_edition: ["Night Hawk edition — tomorrow's playbook…"],
  record_read: ["Track record — graded outcomes from RDS…"],
  platform_read: ["Platform vitals — sockets · crons · health…"],
};

/** One status line for the current phase (optionally intent-scoped). */
export function pickLargoStatusLine(opts: {
  phase: LargoStatusPhase;
  intent?: string | null;
  index?: number;
}): string {
  const intentPool = opts.intent ? INTENT_LINES[opts.intent] : undefined;
  const pool = intentPool?.length ? intentPool : GLOBAL_LINES[opts.phase];
  const idx = (opts.index ?? 0) % pool.length;
  return pool[idx] ?? GLOBAL_LINES.prefetch[0]!;
}

/** Friendly label for SSE tool-trace chips (BIE path). */
export function largoStatusSourceLabel(source: string): string {
  const map: Record<string, string> = {
    polygon: "Polygon",
    unusual_whales: "Unusual Whales",
    redis: "Redis cache",
    rds: "RDS",
    cortex: "Cortex",
    helix: "HELIX",
    thermal: "Thermal",
    internal_api: "platform API",
  };
  return map[source] ?? source.replace(/_/g, " ");
}

/** Rotate status messages on an interval until `stop()` — for long prefetch/enrich waits. */
export function createLargoStatusTicker(opts: {
  phase: LargoStatusPhase;
  intent?: string | null;
  onStatus: (message: string) => void;
  intervalMs?: number;
}): { start: () => void; stop: () => void } {
  let index = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  const tick = () => {
    opts.onStatus(pickLargoStatusLine({ phase: opts.phase, intent: opts.intent, index }));
    index += 1;
  };
  return {
    start: () => {
      tick();
      timer = setInterval(tick, opts.intervalMs ?? 900);
    },
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

/** Status line when routing completes — names the intent in member language. */
export function largoRouteStatus(route: BieRoute): string {
  const t = route.ticker ? ` **${route.ticker}**` : "";
  const labels: Partial<Record<string, string>> = {
    spx_desk_read: `SPX Live Desk read${t}`,
    technical_read: `Technicals pull${t}`,
    wall_dynamics_read: `Dealer wall dynamics${t}`,
    helix_read: `HELIX flow analytics${t}`,
    play_suggest_read: `Play suggestion${t}`,
    vector_pulse_read: `Vector Pulse${t}`,
    vector_read: `Vector desk read${t}`,
    flow_tape: `HELIX flow tape`,
    thermal_read: `Thermal positioning${t}`,
    market_context: "Market context",
    verdict: `Setup verdict${t}`,
  };
  const label = labels[route.intent] ?? route.intent.replace(/_/g, " ");
  return `Routing → ${label} — assembling live numbers…`;
}

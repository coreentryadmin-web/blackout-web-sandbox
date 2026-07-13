// BIE self-diagnosis — the PURE decision core (task #56). Side-effect-free so the ordered checklist
// and its honest conclusion are exhaustively unit-testable without touching a DB / cache / provider.
//
// Answers "why isn't NVDA GEX / MSFT beads forming?" from REAL ops signals only — never a guessed
// cause. The server orchestrator (composeDiagnostic) gathers each signal fail-open, hands them here
// as plain data, and this walks the ordered nodes: the FIRST decisive node explains the absence;
// if every node is green the surface is forming normally; if nothing is decisive AND it isn't green
// we say "can't determine from ops signals" — honesty over a fabricated root cause (spec §4).

export type DiagSurface = "gex" | "walls" | "beads" | "flow";
export type DiagStatus = "ok" | "issue" | "expected" | "unknown";

export type DiagNode = {
  /** Short checklist label. */
  node: string;
  status: DiagStatus;
  /** Grounded one-liner (cites the real signal). */
  detail: string;
};

/** Every signal the server gathered (fail-open — any field may be null when its read failed). */
export type DiagInputs = {
  /** True when at least one data provider is configured. */
  providersConfigured: boolean;
  /** True when NEITHER Polygon nor UW is configured. */
  bothProvidersDown: boolean;
  /** Is the ticker in the recorded universe (persisted rail) vs on-demand only? */
  inUniverse: boolean;
  /** Is it RTH now? */
  isRth: boolean;
  /** Recorder cron health (vector-universe-snapshot), or null when it couldn't be read. */
  cron:
    | {
        found: boolean;
        failed: boolean;
        marketHoursStale: boolean;
        message: string | null;
        rows: number | null;
        ageMin: number | null;
      }
    | null;
  /** Length of the ticker's session wall-history rail (the "beads"), or null when unread. */
  railLen: number | null;
  /** Is a provider circuit breaker open (fetches short-circuited after 429s)? */
  circuitOpen: boolean;
  circuitDetail: string | null;
  /** Live spot for the ticker (<=0 / null = thin/unknown name). */
  spot: number | null;
  /** True when the GEX walls computed empty (chain too thin / no OI / zero gamma). null = unknown. */
  wallsEmpty: boolean | null;
  /** Recent error-event count (scoped) + whether it's a spike. */
  errorCount: number;
  errorSpike: boolean;
  /** Open admin incidents scoped to gex/vector/flow. */
  incidents: number;
  /** True when a flow cron (flow-ingest/gex-alerts) is down during RTH (flow not evaluated). */
  missedFlow: boolean;
};

export type DiagResult = {
  ticker: string;
  surface: DiagSurface;
  nodes: DiagNode[];
  /** The single honest conclusion. */
  conclusion: string;
  confidence: "high" | "moderate" | "low" | "insufficient";
};

/** Parse the surface a question is about; defaults to "gex". */
export function parseDiagSurface(question: string): DiagSurface {
  const q = question.toLowerCase();
  if (/\bbeads?\b|\brail\b|wall[- ]?history/.test(q)) return "beads";
  if (/\bwalls?\b/.test(q)) return "walls";
  if (/\bflow\b|\bprints?\b|\btape\b/.test(q)) return "flow";
  return "gex";
}

/**
 * Walk the ordered checklist and return the transparent node list + the single decisive conclusion.
 * Node ORDER is the diagnosis order — the first node that explains an absence wins the conclusion,
 * but every node is reported for transparency.
 */
export function evaluateDiagnostic(ticker: string, surface: DiagSurface, inp: DiagInputs): DiagResult {
  const nodes: DiagNode[] = [];
  const T = ticker.toUpperCase();
  let conclusion: string | null = null;
  let confidence: DiagResult["confidence"] = "high";
  // Record the first decisive cause; later nodes still append for transparency.
  const decide = (c: string, conf: DiagResult["confidence"] = "high") => {
    if (conclusion == null) {
      conclusion = c;
      confidence = conf;
    }
  };

  // 1) Providers configured.
  if (inp.bothProvidersDown) {
    nodes.push({ node: "providers", status: "issue", detail: "Neither Polygon nor UW is configured — no market data at all." });
    decide(`Neither data provider (Polygon / UW) is configured, so no ${surface} data can be built for ${T}. This is a config issue, not a market one.`);
  } else {
    nodes.push({ node: "providers", status: "ok", detail: `Providers configured (${inp.providersConfigured ? "yes" : "partial"}).` });
  }

  // 2) Recorded universe (only material for the persisted rail / beads).
  if (!inp.inUniverse) {
    nodes.push({ node: "universe", status: "expected", detail: `${T} is not in the recorded universe — served on-demand only, no persisted rail.` });
    if (surface === "beads") {
      decide(`${T} isn't in the ~21-ticker recorded universe, so it has no server-persisted bead rail — the beads only build live while someone is viewing it. That's expected, not a fault.`, "high");
    }
  } else {
    nodes.push({ node: "universe", status: "ok", detail: `${T} is in the recorded universe.` });
  }

  // 3) RTH.
  if (!inp.isRth) {
    nodes.push({ node: "session", status: "expected", detail: "Outside cash RTH — the recorder is idle by design." });
    if (surface === "beads" || surface === "flow") {
      decide(`It's outside regular trading hours, so the recorder/flow crons are idle by design — an empty or flat ${surface} rail off-hours is expected, not a failure. Check again during RTH.`, "high");
    }
  } else {
    nodes.push({ node: "session", status: "ok", detail: "RTH — recorder should be ticking." });
  }

  // 4) Recorder cron health.
  if (inp.cron) {
    if (inp.cron.failed) {
      nodes.push({ node: "cron", status: "issue", detail: `Recorder cron FAILED${inp.cron.message ? `: ${inp.cron.message}` : ""}.` });
      decide(`The recorder cron (vector-universe-snapshot) is failing${inp.cron.message ? ` — "${inp.cron.message}"` : ""}, so the ${surface} rail isn't being written. This is a real pipeline failure.`, "high");
    } else if (inp.cron.marketHoursStale) {
      nodes.push({ node: "cron", status: "issue", detail: `Recorder cron STALE during RTH (age ${inp.cron.ageMin ?? "?"}m).` });
      decide(`The recorder cron is stale during RTH (last run ${inp.cron.ageMin ?? "?"}m ago) — the ${surface} rail has stopped updating. This is the silent-death case; the watchdog should be alerting.`, "high");
    } else if (inp.inUniverse && inp.railLen === 0 && inp.cron.rows != null && inp.cron.rows > 0) {
      nodes.push({ node: "cron", status: "issue", detail: `Cron ran (rows=${inp.cron.rows}) but ${T}'s rail is empty — write-path issue.` });
      decide(`The recorder cron is running (rows=${inp.cron.rows}) but ${T}'s rail is still empty — that points to a write-path issue for this ticker, not the cron itself.`, "moderate");
    } else {
      nodes.push({ node: "cron", status: "ok", detail: `Recorder cron healthy (age ${inp.cron.ageMin ?? "?"}m, rows ${inp.cron.rows ?? "?"}).` });
    }
  } else {
    nodes.push({ node: "cron", status: "unknown", detail: "Recorder cron health unavailable." });
  }

  // 5) Rail presence for the ticker.
  if (inp.railLen != null) {
    if (inp.railLen === 0) {
      nodes.push({ node: "rail", status: inp.isRth && inp.inUniverse ? "issue" : "expected", detail: `${T} has 0 rail samples this session.` });
    } else {
      nodes.push({ node: "rail", status: "ok", detail: `${T} rail has ${inp.railLen} samples.` });
    }
  } else {
    nodes.push({ node: "rail", status: "unknown", detail: "Rail length unavailable." });
  }

  // 6) Circuit breaker.
  if (inp.circuitOpen) {
    nodes.push({ node: "circuit", status: "issue", detail: `Provider circuit OPEN${inp.circuitDetail ? ` (${inp.circuitDetail})` : ""} — fetches short-circuited after 429s.` });
    decide(`A provider rate-limit circuit is open${inp.circuitDetail ? ` (${inp.circuitDetail})` : ""}, so ${surface} fetches for ${T} are being short-circuited after repeated 429s. It should recover once the breaker resets.`, "high");
  } else {
    nodes.push({ node: "circuit", status: "ok", detail: "No provider circuit open." });
  }

  // 7) Spot.
  if (inp.spot != null && inp.spot <= 0) {
    nodes.push({ node: "spot", status: "expected", detail: `No live spot for ${T} — thin/unknown name.` });
    decide(`There's no live spot price for ${T} (thin or unrecognized name), so the ${surface} surface can't be built. Honest empty, not a fault.`, "moderate");
  } else if (inp.spot != null) {
    nodes.push({ node: "spot", status: "ok", detail: `Spot ${inp.spot} for ${T}.` });
  } else {
    nodes.push({ node: "spot", status: "unknown", detail: "Spot unavailable." });
  }

  // 8) Chain thickness (gex/walls surfaces).
  if (inp.wallsEmpty === true) {
    nodes.push({ node: "chain", status: "expected", detail: `${T} options chain too thin — no GEX walls form.` });
    if (surface === "gex" || surface === "walls") {
      decide(`${T}'s options chain is too thin (no meaningful open interest / dealer gamma), so no ${surface} walls form. Expected for an illiquid name, not a pipeline fault.`, "moderate");
    }
  } else if (inp.wallsEmpty === false) {
    nodes.push({ node: "chain", status: "ok", detail: `${T} chain has real gamma — walls compute.` });
  } else {
    nodes.push({ node: "chain", status: "unknown", detail: "Chain thickness unavailable." });
  }

  // 9) Errors / incidents.
  if (inp.incidents > 0) {
    nodes.push({ node: "incidents", status: "issue", detail: `${inp.incidents} open admin incident(s) scoped to gex/vector/flow.` });
    decide(`There ${inp.incidents === 1 ? "is" : "are"} ${inp.incidents} open incident(s) affecting the gex/vector/flow pipeline right now — that's the likely cause; it's already being tracked.`, "high");
  } else if (inp.errorSpike) {
    nodes.push({ node: "incidents", status: "issue", detail: `Error spike: ${inp.errorCount} recent error events.` });
    decide(`There's a recent error spike (${inp.errorCount} events) in the ${surface} pipeline — likely the cause; worth escalating.`, "moderate");
  } else {
    nodes.push({ node: "incidents", status: "ok", detail: `No open incidents; ${inp.errorCount} recent errors (no spike).` });
  }

  // 10) Missed flow window.
  if (inp.missedFlow) {
    nodes.push({ node: "flow-crons", status: "issue", detail: "A flow cron (flow-ingest / gex-alerts) is down during RTH." });
    if (surface === "flow") {
      decide(`A flow cron (flow-ingest / gex-alerts) is down during RTH, so flow for ${T} isn't being evaluated. Real pipeline gap.`, "high");
    }
  } else {
    nodes.push({ node: "flow-crons", status: "ok", detail: "Flow crons evaluated." });
  }

  // 11) All-green vs can't-determine.
  if (conclusion == null) {
    const anyIssue = nodes.some((n) => n.status === "issue");
    const anyUnknown = nodes.some((n) => n.status === "unknown");
    if (!anyIssue && !anyUnknown) {
      // Genuinely all-green — every check ran and passed.
      const bits: string[] = [];
      if (inp.spot != null && inp.spot > 0) bits.push(`spot ${inp.spot}`);
      if (inp.railLen != null && inp.railLen > 0) bits.push(`${inp.railLen} rail samples`);
      if (inp.cron?.ageMin != null) bits.push(`cron ${inp.cron.ageMin}m ago`);
      conclusion = `Everything checks out for ${T}'s ${surface}: ${bits.join(", ") || "all ops signals green"} — it's forming normally. If you're not seeing it, it's likely a client/view issue rather than the pipeline.`;
      confidence = "moderate";
    } else {
      // Either a non-decisive issue for this surface, or key signals are unavailable — either way we
      // won't invent a root cause (spec §4).
      conclusion = `I can't pin a single root cause for ${T}'s ${surface} from the ops signals I can read right now — ${anyUnknown ? "some checks are unavailable" : "no single check is decisive"}. Nothing definitively broken, but I won't guess a cause.`;
      confidence = "insufficient";
    }
  }

  return { ticker: T, surface, nodes, conclusion, confidence };
}

/** Render the diagnosis to member-facing markdown (checklist + conclusion). */
export function renderDiagnosis(res: DiagResult): string {
  const icon: Record<DiagStatus, string> = { ok: "✅", issue: "⚠️", expected: "ℹ️", unknown: "·" };
  const lines = [
    `**Diagnosis — ${res.ticker} ${res.surface.toUpperCase()}**`,
    "",
    res.conclusion,
    "",
    "**Checks:**",
    ...res.nodes.map((n) => `- ${icon[n.status]} ${n.node}: ${n.detail}`),
    "",
    `_Confidence: ${res.confidence}. Grounded in live ops signals (cron health, rate limiters, incident log, rail presence) — no guessed cause._`,
  ];
  return lines.join("\n");
}

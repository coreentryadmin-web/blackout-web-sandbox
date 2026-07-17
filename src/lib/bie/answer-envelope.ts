// BieAnswerEnvelope — the STABLE, member-facing answer contract (task #63).
//
// This is the shape the BIE synthesis layer (#59) emits and the member UI renders. It is a
// STRUCTURED answer, not a raw desk-dump string: a headline + bias, one section per sub-question,
// evidence separated from interpretation (fact / calc / inference / scenario per §4 of the master
// spec), calibrated confidence, invalidation, optional bull/base/bear scenarios, key levels, and
// per-item provenance (source + asOf + freshness). It carries a backward-compatible `markdown`
// rendering so the existing string-based Largo path keeps working during the transition — composers
// return the envelope; `renderEnvelopeMarkdown()` produces the string.
//
// The UI binds to THIS type — keep it additive/stable. Bump `version` on a breaking change.

/** Schema version — additive changes keep it 1; a breaking change bumps it and the UI branches. */
export const BIE_ANSWER_ENVELOPE_VERSION = 1 as const;

export type BieBias = "bullish" | "bearish" | "neutral" | "mixed";

/** Evidence-quality-based confidence (NOT an arbitrary %), per master spec §1.7 / §4. */
export type BieConfidenceLevel = "high" | "moderate" | "low" | "insufficient";

/** The honesty taxonomy (master spec §4): keep evidence separate from interpretation. */
export type BieEvidenceKind = "fact" | "calc" | "inference" | "scenario";

/** Freshness of an underlying datum — the honesty spine. Never present stale as live. */
export type BieFreshness = "live" | "recent" | "stale" | "unknown";

/** Where a datum came from + how fresh it is. Attached to evidence/sections/levels. */
export type BieProvenance = {
  /** Human source label, e.g. "Vector GEX", "Polygon quote", "HELIX flow", "Glossary". */
  source: string;
  /** ISO timestamp of the underlying data, when known. */
  asOf?: string | null;
  freshness?: BieFreshness;
};

/** One evidence item — the statement + its honesty kind + provenance. */
export type BieEvidence = {
  kind: BieEvidenceKind;
  /** Member-readable statement. */
  text: string;
  provenance?: BieProvenance;
};

export type BieConfidence = {
  level: BieConfidenceLevel;
  /** One line stating what raises/lowers it (never arbitrary). */
  why: string;
};

/** A bull/base/bear scenario (master spec §1.6). */
export type BieScenario = {
  kind: "bull" | "base" | "bear";
  thesis: string;
  trigger?: string;
  confirm?: string;
  invalidation?: string;
  targets?: string[];
  risks?: string[];
};

/** A key price level for the UI's level table. */
export type BieLevel = {
  /** e.g. "call wall", "gamma flip", "VWAP", "max pain", "PDH". */
  label: string;
  price: number;
  note?: string;
  provenance?: BieProvenance;
};

/** Tabular block the UI can bind to directly (markdown is derived via renderEnvelopeMarkdown). */
export type BieTable = {
  headers: string[];
  rows: string[][];
};

/** One section — typically one per sub-question/topic (title + body), optionally self-contained. */
export type BieSection = {
  title: string;
  /** Member-readable prose/markdown for this section. */
  body: string;
  bias?: BieBias;
  evidence?: BieEvidence[];
  confidence?: BieConfidence;
  levels?: BieLevel[];
  /** Structured table — rendered as markdown when body omits it. */
  table?: BieTable | null;
  /** Set when this section could not be answered — honest, never silently dropped. */
  unavailable?: { reason: string } | null;
  provenance?: BieProvenance;
};

/** A source that was requested but unavailable — surfaced, never silently omitted (§4). */
export type BieUnavailableSource = { source: string; reason: string };

/**
 * The complete structured answer the UI renders. Only `version`, `headline`, `bias`, `sections`,
 * `evidence`, `confidence`, `asOf`, and `markdown` are required; everything else is optional and
 * populated when the question merits it (depth matches merit, master spec §3).
 */
export type BieAnswerEnvelope = {
  version: typeof BIE_ANSWER_ENVELOPE_VERSION;
  headline: string;
  bias: BieBias;
  /** The router intent / route that produced this (analytics + UI hints). */
  intent?: string | null;
  /** One per sub-question/topic. */
  sections: BieSection[];
  /** Cross-cutting top-level evidence. */
  evidence: BieEvidence[];
  confidence: BieConfidence;
  /** The thesis "go flat" line. */
  invalidation?: string | null;
  scenarios?: BieScenario[];
  levels?: BieLevel[];
  followups?: string[];
  /** Sources requested but unavailable this turn — always surfaced. */
  unavailableSources?: BieUnavailableSource[];
  /** When the envelope was assembled (ISO). */
  asOf: string;
  /** Backward-compatible markdown rendering (the existing string Largo path). */
  markdown: string;
};

/** Input to build an envelope — everything except the derived `version`/`asOf`/`markdown`. */
export type BieAnswerEnvelopeInput = Omit<BieAnswerEnvelope, "version" | "asOf" | "markdown"> & {
  asOf?: string;
};

// ── Freshness helper ───────────────────────────────────────────────────────

/** Classify freshness from a data-age in ms: <60s live, <10m recent, else stale. */
export function freshnessFromAgeMs(ageMs: number | null | undefined): BieFreshness {
  if (ageMs == null || !Number.isFinite(ageMs) || ageMs < 0) return "unknown";
  if (ageMs < 60_000) return "live";
  if (ageMs < 10 * 60_000) return "recent";
  return "stale";
}

// ── Markdown rendering (backward-compatible string) ────────────────────────

const KIND_TAG: Record<BieEvidenceKind, string> = {
  fact: "FACT",
  calc: "CALC",
  inference: "INFERENCE",
  scenario: "SCENARIO",
};

const FRESH_TAG: Record<BieFreshness, string> = {
  live: "live",
  recent: "recent",
  stale: "STALE",
  unknown: "age unknown",
};

function provenanceSuffix(p?: BieProvenance): string {
  if (!p) return "";
  const bits: string[] = [p.source];
  if (p.freshness && p.freshness !== "live") bits.push(FRESH_TAG[p.freshness]);
  if (p.asOf) bits.push(p.asOf);
  return ` _(${bits.join(" · ")})_`;
}

function renderEvidence(ev: BieEvidence[] | undefined): string[] {
  if (!ev || ev.length === 0) return [];
  return ev.map((e) => `- [${KIND_TAG[e.kind]}] ${e.text}${provenanceSuffix(e.provenance)}`);
}

function renderLevels(levels: BieLevel[] | undefined): string[] {
  if (!levels || levels.length === 0) return [];
  const rows = levels.map(
    (l) => `- ${l.label}: ${l.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}${l.note ? ` — ${l.note}` : ""}`
  );
  return ["**Key levels:**", ...rows];
}

function renderTable(table: BieTable | null | undefined): string[] {
  if (!table?.headers?.length) return [];
  const esc = (s: string) => s.replace(/\|/g, "\\|");
  const sep = table.headers.map(() => "---");
  const lines = [
    `| ${table.headers.map(esc).join(" | ")} |`,
    `| ${sep.join(" | ")} |`,
    ...table.rows.map((r) => `| ${r.map((c) => esc(String(c))).join(" | ")} |`),
  ];
  return lines;
}

function renderScenarios(scen: BieScenario[] | undefined): string[] {
  if (!scen || scen.length === 0) return [];
  const cards = scen.map((s) => {
    const lines = [`**${s.kind.toUpperCase()}** — ${s.thesis}`];
    if (s.trigger) lines.push(`  trigger: ${s.trigger}`);
    if (s.confirm) lines.push(`  confirm: ${s.confirm}`);
    if (s.invalidation) lines.push(`  invalidation: ${s.invalidation}`);
    if (s.targets?.length) lines.push(`  targets: ${s.targets.join(", ")}`);
    if (s.risks?.length) lines.push(`  risks: ${s.risks.join(", ")}`);
    return lines.join("\n");
  });
  return ["**Scenarios:**", ...cards];
}

/**
 * Render an envelope to member-facing markdown — the backward-compatible string the existing Largo
 * path consumes. Reads only the STRUCTURED fields (ignores any pre-set `markdown`), so a builder can
 * call this to fill `markdown`.
 */
export function renderEnvelopeMarkdown(
  env: Omit<BieAnswerEnvelope, "markdown"> | BieAnswerEnvelope
): string {
  const out: string[] = [];
  out.push(`**${env.headline}**  _(${env.bias})_`);

  for (const s of env.sections) {
    out.push("", `## ${s.title}`);
    if (s.unavailable) {
      out.push(`_unavailable — ${s.unavailable.reason}_`);
      continue;
    }
    const tableLines = renderTable(s.table);
    if (s.body) out.push(s.body);
    if (tableLines.length) out.push(...tableLines);
    const ev = renderEvidence(s.evidence);
    if (ev.length) out.push(...ev);
    const lv = renderLevels(s.levels);
    if (lv.length) out.push(...lv);
    if (s.confidence) out.push(`_Confidence: ${s.confidence.level} — ${s.confidence.why}_`);
  }

  const topEv = renderEvidence(env.evidence);
  if (topEv.length) out.push("", "**Evidence:**", ...topEv);

  const lv = renderLevels(env.levels);
  if (lv.length) out.push("", ...lv);

  const scen = renderScenarios(env.scenarios);
  if (scen.length) out.push("", ...scen);

  out.push("", `**Confidence:** ${env.confidence.level} — ${env.confidence.why}`);
  if (env.invalidation) out.push(`**Invalidation:** ${env.invalidation}`);

  if (env.unavailableSources?.length) {
    out.push(
      "",
      "_Unavailable this turn:_ " + env.unavailableSources.map((u) => `${u.source} (${u.reason})`).join(", ")
    );
  }

  if (env.followups?.length) {
    out.push("", "_Follow-ups:_ " + env.followups.map((f) => `"${f}"`).join(" · "));
  }

  return out.join("\n");
}

/**
 * Build a complete envelope from structured input — fills `version`, `asOf`, and the derived
 * `markdown`. The single constructor synthesis composers use so every envelope is well-formed.
 */
export function makeEnvelope(input: BieAnswerEnvelopeInput): BieAnswerEnvelope {
  const asOf = input.asOf ?? new Date().toISOString();
  const withoutMarkdown: Omit<BieAnswerEnvelope, "markdown"> = {
    ...input,
    version: BIE_ANSWER_ENVELOPE_VERSION,
    asOf,
  };
  return { ...withoutMarkdown, markdown: renderEnvelopeMarkdown(withoutMarkdown) };
}

/**
 * Wrap a plain answer string in a minimal envelope — the transition shim so a composer that still
 * returns only markdown can emit a valid (if shallow) envelope. One section, no fabricated
 * structure; confidence defaults to the caller's assessment (or "moderate").
 */
export function envelopeFromMarkdown(
  markdown: string,
  opts: {
    headline: string;
    bias?: BieBias;
    intent?: string | null;
    confidence?: BieConfidence;
    sectionTitle?: string;
  }
): BieAnswerEnvelope {
  return makeEnvelope({
    headline: opts.headline,
    bias: opts.bias ?? "neutral",
    intent: opts.intent ?? null,
    sections: [{ title: opts.sectionTitle ?? "Read", body: markdown }],
    evidence: [],
    confidence: opts.confidence ?? { level: "moderate", why: "Deterministic read from live platform data." },
  });
}

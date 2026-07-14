// BIE verdict CASE-LAW store (task #83) — pin every rendered verdict so a later "why did you say
// 7500 was good this morning / does that still hold?" is answered FROM THE PINNED RECORD, never
// re-fabricated. Mirrors the cortex-read.ts pinning discipline: the record is the truth of what was
// said (question + evidence snapshot + falsifiers + timestamp); a recall re-evaluates the pinned
// falsifiers against a fresh snapshot but never invents a new verdict, and — when NO record exists —
// says so honestly (the #327/#331 no-record posture), never guesses what "this morning" said.
//
// Split like the rest of bie: PURE builders (record assembly, the recall/no-record envelopes) that
// are directly unit-tested, and a fail-soft persistence layer (sharedCacheGet/Set — Redis with an
// in-memory fallback) reached through a dynamic RELATIVE import so the pure half never pulls IO into
// the test loader.

import {
  makeEnvelope,
  type BieAnswerEnvelope,
  type BieBias,
  type BieConfidenceLevel,
  type BieEvidence,
  type BieFalsifier,
} from "@/lib/bie/answer-envelope";
import {
  reevaluateCase,
  type FalsifierSnapshot,
  type FalsifierStatus,
} from "@/lib/bie/verdict-falsifiers";

/** The pinned record of one rendered verdict. Fully serializable → round-trips through the KV store. */
export type VerdictCaseRecord = {
  ticker: string;
  question: string;
  headline: string;
  bias: BieBias;
  confidence: BieConfidenceLevel;
  /** ISO instant the verdict was rendered/pinned. */
  asOf: string;
  /** The evidence values at verdict time — the baseline the falsifiers were derived from. */
  snapshot: FalsifierSnapshot;
  regime: "long" | "short" | "transition" | "unknown" | null;
  falsifiers: BieFalsifier[];
};

/** How long a pinned verdict stays recallable — long enough that a morning verdict answers a
 *  same-day evening "why did you say that this morning" (18h covers open→after-hours). */
export const VERDICT_CASELAW_TTL_SEC = 18 * 60 * 60;

const cacheKey = (ticker: string): string => `bie:verdict:caselaw:${ticker.toUpperCase().trim()}`;

/** "HH:MM ET" for the pin instant — the "this morning" the member is referring to. */
function etClock(iso: string): string {
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "an earlier time";
  const et = new Date(new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York" }));
  const hh = String(et.getHours()).padStart(2, "0");
  const mm = String(et.getMinutes()).padStart(2, "0");
  return `${hh}:${mm} ET`;
}

// ── PURE builders ────────────────────────────────────────────────────────────

/** Assemble the case record from a rendered verdict envelope + the evidence snapshot it used. PURE. */
export function buildCaseRecord(
  ticker: string,
  question: string,
  env: Pick<BieAnswerEnvelope, "headline" | "bias" | "confidence" | "asOf" | "falsifiers">,
  snapshot: FalsifierSnapshot,
  regime: VerdictCaseRecord["regime"]
): VerdictCaseRecord {
  return {
    ticker: ticker.toUpperCase().trim(),
    question,
    headline: env.headline,
    bias: env.bias,
    confidence: env.confidence.level,
    asOf: env.asOf,
    snapshot,
    regime,
    falsifiers: env.falsifiers ?? [],
  };
}

/** The honest NO-RECORD envelope — no verdict was pinned for this ticker, so we say exactly that and
 *  never reconstruct one (the #327/#331 posture). PURE. */
export function buildNoCaseRecordEnvelope(ticker: string | null): BieAnswerEnvelope {
  const T = ticker ? ticker.toUpperCase().trim() : null;
  return makeEnvelope({
    headline: T ? `No verdict on record for ${T}` : "No verdict on record",
    bias: "neutral",
    intent: "verdict",
    sections: [
      {
        title: "Nothing pinned to recall",
        body:
          `I have no pinned ${T ?? ""} verdict to recall — either none was rendered this session or it has aged out. ` +
          `I won't reconstruct what I "said" from scratch, because that would be a fresh read dressed as a memory. ` +
          `Ask me for a fresh verdict (e.g. "${T ? `is ${T} 7500 a good 0DTE play` : "give me the call on SPX"}") and I'll grade it live — and pin it so this recall works next time.`,
      },
    ],
    evidence: [],
    confidence: { level: "high", why: "An empty case-law store is itself the honest answer — no record, stated plainly." },
    followups: T ? [`Give me the verdict on ${T}`, "What would flip that read?", "What's the SPX setup right now?"] : ["Give me the call on SPX", "What's the SPX setup right now?"],
  });
}

const fmt = (n: number): string => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * The RECALL envelope: answer "why did you say X was good this morning / does it still hold?" straight
 * from the pinned record, re-evaluating each pinned falsifier against `current` (a fresh snapshot, or
 * null when no live read was possible → falsifiers read as indeterminate, still honest). PURE.
 */
export function buildRecallEnvelope(
  record: VerdictCaseRecord,
  current: FalsifierSnapshot | null
): BieAnswerEnvelope {
  const T = record.ticker;
  const when = etClock(record.asOf);
  const reeval = current ? reevaluateCase(record.falsifiers, record.snapshot, current) : null;

  const snapBits: string[] = [];
  if (record.snapshot.spot != null) snapBits.push(`spot ${fmt(record.snapshot.spot)}`);
  if (record.snapshot.flip != null) snapBits.push(`flip ${fmt(record.snapshot.flip)}`);
  if (record.snapshot.call_wall != null) snapBits.push(`call wall ${fmt(record.snapshot.call_wall)}`);
  if (record.snapshot.put_wall != null) snapBits.push(`put wall ${fmt(record.snapshot.put_wall)}`);
  if (record.snapshot.max_pain != null) snapBits.push(`max pain ${fmt(record.snapshot.max_pain)}`);

  const evidence: BieEvidence[] = [
    {
      kind: "fact",
      text: `At ${when} I graded "${record.question}" → ${record.headline} (${record.bias}, ${record.confidence} confidence).`,
      provenance: { source: "Verdict case-law (pinned)", asOf: record.asOf },
    },
    ...(snapBits.length
      ? [{ kind: "fact" as const, text: `Evidence at the time: ${snapBits.join(" · ")}.`, provenance: { source: "Verdict case-law (pinned)", asOf: record.asOf } }]
      : []),
  ];

  const sections: BieAnswerEnvelope["sections"] = [
    {
      title: "What I said, and on what",
      body: `At ${when} I called it: ${record.headline}. That rested on ${snapBits.length ? snapBits.join(" · ") : "the live dealer read"} — pinned exactly as rendered, not re-derived now.`,
      provenance: { source: "Verdict case-law (pinned)", asOf: record.asOf },
    },
  ];

  // Re-check the falsifiers against the live snapshot — the honest "does it still hold" answer.
  let headline: string;
  if (reeval == null) {
    headline = `${T} verdict from ${when} — recalled; no live read to re-check it against now`;
    sections.push({
      title: "Still valid?",
      body: `I can recall exactly what I said, but I have no live ${T} read this turn to re-test the falsifiers against. The pinned conditions are below — re-ask during live data to grade them.`,
      unavailable: { reason: "no live snapshot to re-evaluate" },
    });
  } else {
    const verb = reeval.overall === "holds" ? "STILL HOLDS" : reeval.overall === "invalidated" ? "is INVALIDATED" : "is WEAKENED";
    headline = `${T} verdict from ${when} ${verb} — re-checked against the live read`;
    const lines = reeval.statuses.map((s: FalsifierStatus) => {
      const tag = s.status === "invalidated" ? "TRIPPED (invalidates)" : s.status === "weakened" ? "TRIPPED (weakens)" : s.status === "indeterminate" ? "can't check" : "holding";
      return `- [${tag}] ${s.detail}`;
    });
    sections.push({
      title: "Still valid? (falsifiers re-checked live)",
      body:
        (reeval.overall === "holds"
          ? "None of the conditions I named have tripped — the read still stands on its own terms.\n"
          : reeval.overall === "invalidated"
            ? "An invalidating condition I named has tripped — by its own falsifier the read no longer holds.\n"
            : "A weakening condition I named has tripped — the read is softer than it was, though not invalidated.\n") + lines.join("\n"),
    });
  }

  return makeEnvelope({
    headline,
    bias: record.bias,
    intent: "verdict",
    sections,
    evidence,
    falsifiers: record.falsifiers,
    confidence: {
      level: reeval == null ? "moderate" : "high",
      why:
        reeval == null
          ? "Recalled from the pinned record; no live read to re-grade the falsifiers this turn."
          : "Pinned verdict + a live re-check of the exact falsifiers it named — a record, not a reconstruction.",
    },
    followups: [`Give me a fresh verdict on ${T}`, `What's the ${T} setup right now?`, "What would flip this read?"],
    asOf: record.asOf,
  });
}

// ── Fail-soft persistence (dynamic RELATIVE import — no IO in the pure test loader) ──

/** Pin a rendered verdict for later recall. Fire-and-forget; never throws. */
export async function pinVerdictCase(record: VerdictCaseRecord): Promise<void> {
  try {
    const { sharedCacheSet } = await import("../shared-cache");
    await sharedCacheSet(cacheKey(record.ticker), record, VERDICT_CASELAW_TTL_SEC);
  } catch {
    /* pinning is best-effort — a recall miss degrades to the honest no-record answer */
  }
}

/** Recall the latest pinned verdict for a ticker, or null when none is on record. Never throws. */
export async function recallVerdictCase(ticker: string): Promise<VerdictCaseRecord | null> {
  try {
    const { sharedCacheGet } = await import("../shared-cache");
    const rec = await sharedCacheGet<VerdictCaseRecord>(cacheKey(ticker));
    return rec ?? null;
  } catch {
    return null;
  }
}

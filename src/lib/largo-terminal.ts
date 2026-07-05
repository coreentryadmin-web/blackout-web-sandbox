import {
  anthropicConfigured,
  anthropicText,
  anthropicToolLoop,
  COMMENTARY_MODEL,
  LARGO_MODEL,
  type AnthropicMessage,
  type AnthropicSystemBlock,
  type AnthropicToolLoopEvent,
} from "@/lib/providers/anthropic";
import { dbConfigured, insertBieInteraction } from "@/lib/db";
import { LARGO_SYSTEM_PROMPT } from "@/lib/largo/system-prompt";
import { LARGO_TOOL_DEFS, getToolsForIntent } from "@/lib/largo/tool-defs";
import { runLargoTool } from "@/lib/largo/run-tool";
import { bieFollowups, bieIntentBucket, classifyBieIntent, type BieRoute } from "@/lib/bie/router";
import { composeBieAnswer } from "@/lib/bie/composers";
import { collectContextNumbers, verifyClaims, type ClaimVerification } from "@/lib/bie/verifier";
import { resetLargoSpxDeskCache } from "@/lib/largo/spx-desk-cache";
import {
  appendLargoMessage,
  ensureLargoSession,
  fetchLargoHistory,
  fetchLargoMessagesPublic,
  sessionOwnedByUser,
} from "@/lib/largo/largo-store";
import { analyzeLargoQuestion } from "@/lib/largo/question-intent";
import { captureLargoLiveFeed, formatLargoLiveFeed } from "@/lib/largo/largo-live-feed";
import { polygonConfigured, uwConfigured } from "@/lib/providers/config";
import { webSearchConfigured } from "@/lib/providers/web-search";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { searchKnowledge } from "@/lib/bie/knowledge";
import { readZeroDteLedger } from "@/lib/zerodte/scan";

const MAX_HISTORY = 28;

/** Thrown when the SSE client disconnects before the Largo turn finishes. */
export class SseClientDisconnected extends Error {
  constructor() {
    super("SSE client disconnected");
    this.name = "SseClientDisconnected";
  }
}

export function isSseClientDisconnect(err: unknown): boolean {
  if (err instanceof SseClientDisconnected) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("Controller is already closed") || msg.includes("Invalid state");
}

export type LargoStreamEvent =
  | AnthropicToolLoopEvent
  | {
      type: "done";
      answer: string;
      session_id: string;
      source: string;
      tools_used: string[];
      followups: string[];
      // Always present (audit finding: previously the specific unverified numbers were never
      // surfaced even when the in-text caveat fired, and never at all below its total>=4 &&
      // coverage<0.5 threshold) — the raw ClaimVerification so any caller can inspect exactly
      // which numeric claims traced to this turn's source data, independent of the in-text
      // caveat's own display threshold.
      verification: ClaimVerification;
    }
  | { type: "error"; message: string };

/**
 * Dynamic follow-up prompts — 3 short questions that continue THIS exact exchange
 * (same ticker/topic, drilling deeper or pivoting logically), generated from the
 * user's question + Largo's answer on a cheap fast model. Replaces the old fixed
 * suggestion chips. Fail-open: returns [] on any error / no key / spend-ceiling, so
 * follow-ups are a pure enhancement that never blocks or breaks the answer.
 */
export async function generateLargoFollowups(
  question: string,
  answer: string,
  tickerHint?: string | null
): Promise<string[]> {
  if (!anthropicConfigured() || !answer.trim()) return [];
  const focus = tickerHint ? ` The current focus is ${tickerHint}.` : "";
  const prompt = `You generate follow-up questions for Largo, an institutional options/markets AI desk.${focus}

The member asked: "${question}"

Largo answered:
"""
${answer.slice(0, 1800)}
"""

Write exactly 3 follow-up questions the member would most naturally ask NEXT — each a direct continuation of THIS exchange (reference the same ticker/setup/topic; drill deeper, stress-test, or pivot to the logical next angle). Specific and trader-relevant, not generic. Each ≤ 9 words, plain text, no numbering, no quotes. Return ONLY the 3 questions, one per line.`;
  try {
    const out = await anthropicText(prompt, 160, undefined, {
      model: COMMENTARY_MODEL,
      temperature: 0.7,
      timeoutMs: 12_000,
      maxRetries: 1,
    });
    if (!out) return [];
    return out
      .split("\n")
      .map((l) => l.replace(/^[\s\-*•\d.)]+/, "").replace(/^["']|["']$/g, "").trim())
      .filter((l) => l.length > 0 && l.length <= 90)
      .slice(0, 3);
  } catch {
    return [];
  }
}

function trimHistory(history: AnthropicMessage[]) {
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
}

function buildDynamicSystem(
  question: string,
  history: AnthropicMessage[],
  liveFeedBlock: string
): AnthropicSystemBlock[] {
  const intent = analyzeLargoQuestion(question, history);
  const dynamicPart = `## This turn

Session date (ET): ${todayEtYmd()}

${liveFeedBlock}

${intent.guidance}

Session memory is in Postgres — honor follow-ups. Re-fetch via tools if you need fresher flow or stacks. Facts from the live feed only; opinion in Bottom line.`;

  return [
    {
      type: "text",
      text: LARGO_SYSTEM_PROMPT,
      cache_control: { type: "ephemeral" },
    },
    { type: "text", text: dynamicPart },
  ];
}

export function largoConfigured(): boolean {
  return anthropicConfigured();
}

export function largoDataSources(): {
  polygon: boolean;
  uw: boolean;
  postgres: boolean;
  web_search: boolean;
  anthropic: boolean;
} {
  return {
    polygon: polygonConfigured(),
    uw: uwConfigured(),
    postgres: dbConfigured(),
    web_search: webSearchConfigured(),
    anthropic: anthropicConfigured(),
  };
}

export async function getLargoSessionMessages(sessionId: string, userId: string) {
  const sid = sessionId.trim();
  if (!sid) return { session_id: "", messages: [] };
  if (dbConfigured() && !(await sessionOwnedByUser(sid, userId))) {
    return { session_id: sid, messages: [] };
  }
  const messages = await fetchLargoMessagesPublic(sid, userId);
  return { session_id: sid, messages };
}

async function prepareLargoTurn(
  question: string,
  sessionId: string,
  userId: string
): Promise<{
  sid: string;
  history: AnthropicMessage[];
  system: AnthropicSystemBlock[];
  filteredTools: typeof LARGO_TOOL_DEFS;
  toolsUsed: string[];
  tickerHint: string | null;
}> {
  let sid = sessionId.trim() || `web-${userId}-${Date.now()}`;
  try {
    await ensureLargoSession(sid, userId);
  } catch {
    // The supplied session id is owned by ANOTHER user (a client-generated `web-<ts>` id
    // collision — e.g. a shared device or same-ms timestamp) or is otherwise unusable.
    // ensureLargoSession throws on the ownership mismatch, which previously surfaced to the
    // user as a hard "Connection interrupted" error. Recover gracefully: abandon the foreign
    // id (never grant cross-user access) and start a FRESH session owned by THIS user. The new
    // id flows back in the done event, so the client adopts it for subsequent turns.
    sid = `web-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await ensureLargoSession(sid, userId);
  }

  const history = await fetchLargoHistory(sid, userId);
  history.push({ role: "user", content: question });
  trimHistory(history);

  // The user turn is persisted AFTER the assistant turn completes (see
  // runLargoQuery / runLargoQueryStream). Persisting it here — before a 12-round
  // tool loop that can abort or error — left an orphaned trailing user message,
  // so the next turn pushed a second user message, broke Anthropic role
  // alternation, and 400'd until the orphan aged out (LARGO-3).

  const toolsUsed: string[] = ["live_feed_capture"];
  const intent = analyzeLargoQuestion(question, history.slice(0, -1));
  const liveFeed = await captureLargoLiveFeed(intent, userId);
  const liveFeedBlock = formatLargoLiveFeed(liveFeed, intent.tickerHint ?? "SPX");
  // BIE Layer 2 grounding: retrieved desk knowledge (playbooks, findings, past
  // editions, self-evals) rides into the system prompt when embeddings are
  // configured. Best-effort and bounded — never delays a turn by more than the
  // retrieval itself, never blocks on failure. searchKnowledge is a static import
  // (was a dynamic import("@/lib/bie/knowledge")) — see logBie's doc comment below
  // for why a dynamic "@/" alias import silently breaks under Node 20 test mocking.
  let knowledgeBlock = "";
  try {
    const hits = await searchKnowledge(question, 3);
    if (hits.length > 0) {
      knowledgeBlock =
        "\n\n## Retrieved desk knowledge (BLACKOUT Intelligence — cite when relevant)\n" +
        hits.map((h) => `[${h.kind} · ${h.source}]\n${h.chunk}`).join("\n\n---\n\n");
    }
  } catch {
    // retrieval is optional grounding — never blocks the turn
  }
  const system = buildDynamicSystem(question, history.slice(0, -1), liveFeedBlock + knowledgeBlock);

  resetLargoSpxDeskCache(userId);
  const allowedToolNames = new Set(getToolsForIntent(question));
  const filteredTools = LARGO_TOOL_DEFS.filter((t) => allowedToolNames.has(t.name));

  return { sid, history, system, filteredTools, toolsUsed, tickerHint: intent.tickerHint ?? null };
}

/** BLACKOUT Intelligence router — answers deterministically when the question maps
 *  onto platform truth (0DTE plays, SPX structure, market context). Returns null on
 *  no-match or ANY error: the Claude fallback is never blocked by the router.
 *  readZeroDteLedger is a static import (was a dynamic import("@/lib/zerodte/scan"))
 *  — a real, pre-existing bug found while fixing task #103's own tests: that dynamic
 *  alias import silently threw under Node 20 + node:test's module mocking (never
 *  reaching mock.module("./zerodte/scan", ...) in largo-terminal.test.ts), was caught
 *  by this function's own broad catch, and made tryBieRoute return null unconditionally
 *  — i.e. the deterministic router path was untestable, not "broken in production."
 *  Node/webpack-bundled production code has no such ambiguity (the "@/" alias is
 *  resolved at BUILD time, not by Node's runtime ESM loader), so this was invisible
 *  until largo-terminal.test.ts (this file's first-ever test) exercised it under CI's
 *  Node 20. See logBie's doc comment below for the identical root cause on the DB write. */
async function tryBieRoute(
  question: string
): Promise<{ route: BieRoute; answer: string; context: unknown } | null> {
  try {
    const ledger = await readZeroDteLedger().catch(() => []);
    const route = classifyBieIntent(question, new Set(ledger.map((r) => r.ticker)));
    if (!route) return null;
    const composed = await composeBieAnswer(route);
    if (!composed) return null;
    return { route, answer: composed.answer, context: composed.context };
  } catch {
    return null;
  }
}

function logBie(row: {
  user_id: string | null;
  question: string;
  intent: string | null;
  answer_source: string;
  claims_total: number | null;
  claims_verified: number | null;
  latency_ms: number | null;
  // Task #103 — groundwork for #112's self-eval loop, which needs to know what
  // ACTUALLY happened on a turn: the real tool names invoked (empty for the
  // deterministic router path, which never calls a tool) and the router's
  // decided bucket (see bieIntentBucket() — the intent name, or
  // "claude_fallback"). Every call site below passes both; this function is a
  // pure pass-through so the mapping logic lives in one tested place.
  tools_used: string[];
  intent_bucket: string;
}): void {
  if (!dbConfigured()) return;
  // Static import (not a dynamic import("@/lib/db")): under Node 20 + node:test's
  // --experimental-test-module-mocks, a dynamic alias import from inside a mocked module
  // graph fails to resolve to mock.module("./db", ...) — it silently misses the mock
  // (previously swallowed by a .catch here) and this write never lands, timing out any
  // caller awaiting it. Node 22 doesn't have this issue, which is why it was invisible
  // until largo-terminal.test.ts (this file's first-ever test coverage) exercised it
  // under CI's Node 20. Same fix already applied to spx-play-outcomes.ts's write-path
  // functions earlier in this sweep — a static top-of-file import instead.
  void insertBieInteraction(row).catch(() => {});
}

export async function runLargoQuery(
  question: string,
  sessionId: string,
  userId: string
): Promise<{
  answer: string;
  session_id: string;
  source: string;
  tools_used: string[];
  followups: string[];
  verification: ClaimVerification;
}> {
  if (!anthropicConfigured()) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const startedAt = Date.now();
  // Layer 3 first: deterministic BLACKOUT Intelligence answer when the question
  // maps onto platform truth — instant, free, traceable by construction.
  const routed = await tryBieRoute(question);
  if (routed) {
    const sid = sessionId.trim() || `web-${userId}-${Date.now()}`;
    const ctxNumbers = collectContextNumbers(routed.context);
    const verification = verifyClaims(routed.answer, ctxNumbers);
    await appendLargoMessage(sid, userId, "user", question);
    // Persist the composer's own source payload (routed.context) as this turn's
    // tool_results — the router never calls a Largo *tool*, but composeBieAnswer()
    // (bie/composers.ts) still reads real platform state (SPX desk, market context,
    // 0DTE board) to build the answer, and that payload is exactly the ground truth
    // largo-verifier.ts's nightly grounding audit needs. Wrapped in a single-element
    // array to match the tool_results column's shape (an array of per-call results) —
    // collectContextNumbers() recurses through objects/arrays identically either way,
    // so this doesn't change what numbers are considered "grounded" for THIS turn's
    // in-line verification above; it only makes the same payload durable for later
    // audit (task #166 — previously omitted here by explicit prior design, which left
    // the entire router/composer path with zero nightly-audit coverage; see
    // largo-store.ts's fetchRecentLargoAnswersWithResults doc comment).
    await appendLargoMessage(sid, userId, "assistant", routed.answer, ["blackout_intelligence"], [
      routed.context,
    ]);
    logBie({
      user_id: userId,
      question,
      intent: routed.route.intent,
      answer_source: "bie-router",
      claims_total: verification.total,
      claims_verified: verification.verified,
      latency_ms: Date.now() - startedAt,
      // The router path never invokes a Largo tool — it composes straight from
      // platform truth, so the only "tool" is the router itself.
      tools_used: ["blackout_intelligence"],
      intent_bucket: bieIntentBucket(routed.route.intent),
    });
    return {
      answer: routed.answer,
      session_id: sid,
      source: "blackout-intelligence",
      tools_used: ["blackout_intelligence"],
      followups: bieFollowups(routed.route.intent),
      verification,
    };
  }

  const { sid, history, system, filteredTools, toolsUsed, tickerHint } = await prepareLargoTurn(
    question,
    sessionId,
    userId
  );

  // Layer 4: capture every tool result Claude sees so the answer's numeric claims
  // can be verified against the turn's actual source data.
  const capturedResults: unknown[] = [];

  try {
    const answer = await anthropicToolLoop({
      system,
      tools: filteredTools,
      messages: history,
      model: LARGO_MODEL,
      maxTokens: 4096,
      maxRounds: 12,
      // Per-round timeout so a single slow round falls back to partial text instead of 500ing (#77 E).
      timeoutMs: 60_000,
      maxRetries: 1,
      // Cache the stable Largo system prompt — saves ~50% on system-token cost for repeat calls.
      cacheSystem: true,
      runTool: async (name, input) => {
        toolsUsed.push(name);
        const result = await runLargoTool(name, input, userId);
        capturedResults.push(result);
        return result;
      },
    });

    let text =
      answer?.trim() ||
      "I couldn't pull enough live data to answer that — try naming a ticker or asking about SPX structure.";

    // Layer 4 verification: every numeric claim vs the turn's source data (tool
    // results + the history the model was shown). Heavily-unverified answers get
    // an explicit caution — uncertainty stated, never fake precision.
    const ctxNumbers = collectContextNumbers([capturedResults, history.map((h) => h.content)]);
    const verification = verifyClaims(text, ctxNumbers);
    if (verification.total >= 4 && verification.coverage < 0.5) {
      text += `\n\n_BIE verification: ${verification.total - verification.verified} of ${verification.total} figures in this answer could not be traced to data pulled this turn — treat those specific numbers with caution._`;
    }
    logBie({
      user_id: userId,
      question,
      intent: null,
      answer_source: "claude",
      claims_total: verification.total,
      claims_verified: verification.verified,
      latency_ms: Date.now() - startedAt,
      // Real tool names dispatched this turn (deduped — same set persisted a few
      // lines below via appendLargoMessage) — never null/claude_fallback's raw
      // "no tools" here, since the Claude path can (and usually does) call tools.
      tools_used: Array.from(new Set(toolsUsed)),
      intent_bucket: bieIntentBucket(null),
    });

    // Persist the completed turn now that the model produced an answer: user
    // first, then assistant, so role alternation is always intact (LARGO-3).
    // capturedResults is the ground truth largo-verifier.ts's grounding engine needed but
    // never had — persisted alongside the answer so a later audit can trace this turn's
    // numeric claims back to real tool-call data instead of only a fixture self-test.
    await appendLargoMessage(sid, userId, "user", question);
    await appendLargoMessage(sid, userId, "assistant", text, Array.from(new Set(toolsUsed)), capturedResults);

    const followups = await generateLargoFollowups(question, text, tickerHint);

    return {
      answer: text,
      session_id: sid,
      source: dbConfigured() ? "blackout-web+postgres" : "blackout-web",
      tools_used: Array.from(new Set(toolsUsed)),
      followups,
      verification,
    };
  } catch (error) {
    // Task #165 — this try block previously had ONLY a finally, no catch: any throw out of
    // anthropicToolLoop (a tool-loop timeout, an Anthropic API error, a runTool throw, etc.)
    // propagated straight past logBie() to the caller (route.ts's POST handler, which just
    // 502s), so a failed turn left NO row in bie_interactions at all. Every calibration cohort
    // in bie/calibration.ts computes grounding_pass_rate_pct/router_match_rate_pct only over
    // rows that exist, so a spike in tool-loop failures — exactly when trust in the platform is
    // most at risk — was completely invisible to every report. Log a minimal failure row here:
    // claims are explicitly null (not 0) because a turn that never produced an answer has no
    // claims to have verified — 0 would falsely read as "verified none of the claims," a
    // different and wrong statement. Then RETHROW the original error unchanged so the caller's
    // existing error handling (the 502 response) is completely untouched — this is a pure
    // additive logging side effect, never a swallow.
    logBie({
      user_id: userId,
      question,
      intent: null,
      answer_source: "error",
      claims_total: null,
      claims_verified: null,
      latency_ms: Date.now() - startedAt,
      tools_used: Array.from(new Set(toolsUsed)),
      intent_bucket: bieIntentBucket(null),
    });
    throw error;
  } finally {
    resetLargoSpxDeskCache(userId);
  }
}

export async function runLargoQueryStream(
  question: string,
  sessionId: string,
  userId: string,
  onEvent: (event: LargoStreamEvent) => void
): Promise<void> {
  if (!anthropicConfigured()) {
    onEvent({ type: "error", message: "ANTHROPIC_API_KEY not configured" });
    return;
  }

  const startedAt = Date.now();
  // Layer 3 first: deterministic BLACKOUT Intelligence answer — streamed as one
  // token event + done, so the terminal renders it exactly like a model turn.
  const routed = await tryBieRoute(question);
  if (routed) {
    const rsid = sessionId.trim() || `web-${userId}-${Date.now()}`;
    const ctxNumbers = collectContextNumbers(routed.context);
    const verification = verifyClaims(routed.answer, ctxNumbers);
    await appendLargoMessage(rsid, userId, "user", question);
    // Same tool_results persistence as the non-streaming router branch above (task
    // #166) — see that branch's comment for the full rationale.
    await appendLargoMessage(rsid, userId, "assistant", routed.answer, ["blackout_intelligence"], [
      routed.context,
    ]);
    logBie({
      user_id: userId,
      question,
      intent: routed.route.intent,
      answer_source: "bie-router",
      claims_total: verification.total,
      claims_verified: verification.verified,
      latency_ms: Date.now() - startedAt,
      // Same reasoning as the non-streaming runLargoQuery router branch above.
      tools_used: ["blackout_intelligence"],
      intent_bucket: bieIntentBucket(routed.route.intent),
    });
    try {
      onEvent({ type: "token", text: routed.answer } as LargoStreamEvent);
      onEvent({
        type: "done",
        answer: routed.answer,
        session_id: rsid,
        source: "blackout-intelligence",
        tools_used: ["blackout_intelligence"],
        followups: bieFollowups(routed.route.intent),
        verification,
      } as LargoStreamEvent);
    } catch {
      // client disconnected — turn already persisted
    }
    return;
  }

  const { sid, history, system, filteredTools, toolsUsed, tickerHint } = await prepareLargoTurn(
    question,
    sessionId,
    userId
  );
  const capturedResults: unknown[] = [];

  try {
    const emit = (event: LargoStreamEvent) => {
      try {
        onEvent(event);
      } catch (err) {
        if (isSseClientDisconnect(err)) throw new SseClientDisconnected();
        throw err;
      }
    };

    const answer = await anthropicToolLoop({
      system,
      tools: filteredTools,
      messages: history,
      model: LARGO_MODEL,
      maxTokens: 4096,
      maxRounds: 12,
      // Per-round timeout so a single slow round falls back to partial text instead of 500ing (#77 E).
      timeoutMs: 60_000,
      maxRetries: 1,
      // Cache the stable Largo system prompt — saves ~50% on system-token cost for repeat calls.
      cacheSystem: true,
      // Forward tool_start live (deterministic tool names, safe to show as soon as Largo starts
      // pulling data — feeds the "thinking" tool-trace UI). Deliberately DROP raw "token" text
      // deltas here: audit finding — streaming the model's free text live meant a fabricated
      // strike/premium could be read and acted on before the Layer-4 verifier below ever ran.
      // anthropicToolLoop's own resolved return value still carries the full text regardless of
      // which events are forwarded, so nothing here affects what `answer` receives below.
      onEvent: (event) => {
        if (event.type === "tool_start") emit(event);
      },
      runTool: async (name, input) => {
        toolsUsed.push(name);
        const result = await runLargoTool(name, input, userId);
        capturedResults.push(result);
        return result;
      },
    });

    let text =
      answer?.trim() ||
      "I couldn't pull enough live data to answer that — try naming a ticker or asking about SPX structure.";

    // Layer 4 verification: every numeric claim vs the turn's source data (tool
    // results + the history the model was shown). Heavily-unverified answers get
    // an explicit caution — uncertainty stated, never fake precision.
    const ctxNumbers = collectContextNumbers([capturedResults, history.map((h) => h.content)]);
    const verification = verifyClaims(text, ctxNumbers);
    if (verification.total >= 4 && verification.coverage < 0.5) {
      text += `\n\n_BIE verification: ${verification.total - verification.verified} of ${verification.total} figures in this answer could not be traced to data pulled this turn — treat those specific numbers with caution._`;
    }
    logBie({
      user_id: userId,
      question,
      intent: null,
      answer_source: "claude",
      claims_total: verification.total,
      claims_verified: verification.verified,
      latency_ms: Date.now() - startedAt,
      // Same reasoning as the non-streaming runLargoQuery Claude branch above.
      tools_used: Array.from(new Set(toolsUsed)),
      intent_bucket: bieIntentBucket(null),
    });

    // Persist the completed turn now that the model produced an answer: user
    // first, then assistant, so role alternation is always intact (LARGO-3).
    // capturedResults is the ground truth largo-verifier.ts's grounding engine needed but
    // never had — persisted alongside the answer so a later audit can trace this turn's
    // numeric claims back to real tool-call data instead of only a fixture self-test.
    await appendLargoMessage(sid, userId, "user", question);
    await appendLargoMessage(sid, userId, "assistant", text, Array.from(new Set(toolsUsed)), capturedResults);

    // Dynamic, conversation-aware follow-up prompts (fail-open → []). Generated after the
    // answer is persisted so a follow-up hiccup can never lose the turn.
    const followups = await generateLargoFollowups(question, text, tickerHint);

    // Deliver the fully-verified text in one shot — mirrors the BIE-router fast path a few
    // lines up (which also emits one token event with its whole answer before "done"), rather
    // than the raw incremental stream this branch used to forward live. Verification has
    // already run against the complete answer by this point (audit fix, see onEvent above).
    emit({ type: "token", text } as LargoStreamEvent);
    emit({
      type: "done",
      answer: text,
      session_id: sid,
      source: dbConfigured() ? "blackout-web+postgres" : "blackout-web",
      tools_used: Array.from(new Set(toolsUsed)),
      followups,
      verification,
    });
  } catch (error) {
    if (isSseClientDisconnect(error)) return;
    const message = error instanceof Error ? error.message : "Largo query failed";
    // Task #165 — same gap as runLargoQuery's try block above, on the streaming path: this
    // catch already existed (it emits an "error" SSE event), but it never called logBie either,
    // so a failed streaming turn was equally invisible to every BIE calibration cohort. Log a
    // minimal failure row — same null-claims rationale as the non-streaming path above — BEFORE
    // emitting the error event, so the write is attempted even if the client has already gone
    // away by the time emit() throws. Purely additive: the error event still fires exactly as
    // before, nothing here changes what the client sees.
    logBie({
      user_id: userId,
      question,
      intent: null,
      answer_source: "error",
      claims_total: null,
      claims_verified: null,
      latency_ms: Date.now() - startedAt,
      tools_used: Array.from(new Set(toolsUsed)),
      intent_bucket: bieIntentBucket(null),
    });
    try {
      onEvent({ type: "error", message });
    } catch (emitErr) {
      if (!isSseClientDisconnect(emitErr)) throw emitErr;
    }
  } finally {
    resetLargoSpxDeskCache(userId);
  }
}

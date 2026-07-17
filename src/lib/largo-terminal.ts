import {
  anthropicText,
  anthropicToolLoop,
  COMMENTARY_MODEL,
  LARGO_MODEL,
  type AnthropicMessage,
  type AnthropicSystemBlock,
  type AnthropicToolLoopEvent,
} from "@/lib/providers/anthropic";
import { largoAvailable, largoBieOnly, largoClaudeEnabled } from "@/lib/ai-env";
import { dbConfigured } from "@/lib/db";
import { LARGO_SYSTEM_PROMPT } from "@/lib/largo/system-prompt";
import { LARGO_TOOL_DEFS, getToolsForIntent } from "@/lib/largo/tool-defs";
import { runLargoTool } from "@/lib/largo/run-tool";
import { resolveLargoBieRoute } from "@/lib/largo/turn-pipeline";
import {
  applyVerificationCaveat,
  finalizeBieRoutedTurn,
  logClaudeTurn,
  persistClaudeTurn,
} from "@/lib/largo/turn-outcome";
import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";
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
  | { type: "status"; message: string }
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
      // The structured BieAnswerEnvelope (task #59/#63/#64) — present ONLY when the composer produced
      // a genuinely RICH envelope (verdict/synthesis). The client renders it as evidence/level/
      // scenario cards; a trivial string leg omits it and the client falls back to `answer` markdown.
      envelope?: BieAnswerEnvelope;
    }
  | { type: "error"; message: string };

/**
 * Re-exported from `@/lib/bie/envelope-richness` — structural test for rich synthesis envelopes.
 */
export { isRichBieEnvelope } from "@/lib/bie/envelope-richness";

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
  if (!largoClaudeEnabled() || !answer.trim()) return [];
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
      aiGate: "largo",
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
  return largoAvailable();
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
    anthropic: largoClaudeEnabled(),
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
  // Structured answer for the rich member cards — present ONLY on a genuinely rich BIE synthesis
  // (verdict/etc.); undefined for a trivial string answer or a Claude turn, so JSON serialization
  // omits it and the client falls back to `answer` markdown (its own shim). See isRichBieEnvelope.
  envelope?: BieAnswerEnvelope;
}> {
  const startedAt = Date.now();
  const routed = await resolveLargoBieRoute({ question, userId });
  if (routed) {
    const result = await finalizeBieRoutedTurn({
      sessionId,
      userId,
      question,
      routed,
      startedAt,
    });
    return {
      answer: result.answer,
      session_id: result.session_id,
      source: result.source,
      tools_used: result.tools_used,
      followups: result.followups,
      verification: result.verification,
      envelope: result.envelope,
    };
  }

  if (largoBieOnly()) {
    throw new Error(
      "Largo couldn't map that question to a platform read. Try SPX desk, market context, flow tape, track record, or a named ticker."
    );
  }

  if (!largoClaudeEnabled()) {
    throw new Error("Largo requires Anthropic — not configured in this environment.");
  }

  const { sid, history, system, filteredTools, toolsUsed, tickerHint } = await prepareLargoTurn(
    question,
    sessionId,
    userId
  );

  const capturedResults: unknown[] = [];

  try {
    const answer = await anthropicToolLoop({
      system,
      tools: filteredTools,
      messages: history,
      model: LARGO_MODEL,
      maxTokens: 4096,
      maxRounds: 12,
      timeoutMs: 60_000,
      maxRetries: 1,
      cacheSystem: true,
      aiGate: "largo",
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

    const ctxNumbers = collectContextNumbers([capturedResults, history.map((h) => h.content)]);
    const verification = verifyClaims(text, ctxNumbers);
    text = applyVerificationCaveat(text, verification);

    logClaudeTurn({ userId, question, toolsUsed, verification, startedAt });
    await persistClaudeTurn({ sessionId: sid, userId, question, answer: text, toolsUsed, capturedResults });

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
    logClaudeTurn({
      userId,
      question,
      toolsUsed,
      verification: { total: 0, verified: 0, coverage: 1, unverified: [] },
      startedAt,
      answerSource: "error",
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
  const startedAt = Date.now();
  const emitStatus = (message: string) => {
    try {
      onEvent({ type: "status", message });
    } catch (err) {
      if (isSseClientDisconnect(err)) throw new SseClientDisconnected();
    }
  };

  const routed = await resolveLargoBieRoute({ question, userId, onStatus: emitStatus });
  if (routed) {
    const result = await finalizeBieRoutedTurn({
      sessionId,
      userId,
      question,
      routed,
      startedAt,
    });
    try {
      onEvent({ type: "token", text: result.answer } as LargoStreamEvent);
      onEvent({
        type: "done",
        answer: result.answer,
        session_id: result.session_id,
        source: result.source,
        tools_used: result.tools_used,
        followups: result.followups,
        verification: result.verification,
        envelope: result.envelope,
      } as LargoStreamEvent);
    } catch {
      // client disconnected — turn already persisted
    }
    return;
  }

  if (largoBieOnly()) {
    onEvent({
      type: "error",
      message:
        "Largo couldn't map that question to a platform read. Try SPX desk, market context, flow tape, track record, or a named ticker.",
    });
    return;
  }

  if (!largoClaudeEnabled()) {
    onEvent({
      type: "error",
      message: "Largo requires Anthropic — not configured in this environment.",
    });
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
      aiGate: "largo",
      // Forward tool_start only — verified full text emitted once below.
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
    text = applyVerificationCaveat(text, verification);

    logClaudeTurn({ userId, question, toolsUsed, verification, startedAt });
    await persistClaudeTurn({ sessionId: sid, userId, question, answer: text, toolsUsed, capturedResults });

    const followups = await generateLargoFollowups(question, text, tickerHint);

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
    logClaudeTurn({
      userId,
      question,
      toolsUsed,
      verification: { total: 0, verified: 0, coverage: 1, unverified: [] },
      startedAt,
      answerSource: "error",
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

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
import { dbConfigured } from "@/lib/db";
import { LARGO_SYSTEM_PROMPT } from "@/lib/largo/system-prompt";
import { LARGO_TOOL_DEFS, getToolsForIntent } from "@/lib/largo/tool-defs";
import { runLargoTool } from "@/lib/largo/run-tool";
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
  const system = buildDynamicSystem(question, history.slice(0, -1), liveFeedBlock);

  resetLargoSpxDeskCache(userId);
  const allowedToolNames = new Set(getToolsForIntent(question));
  const filteredTools = LARGO_TOOL_DEFS.filter((t) => allowedToolNames.has(t.name));

  return { sid, history, system, filteredTools, toolsUsed, tickerHint: intent.tickerHint ?? null };
}

export async function runLargoQuery(
  question: string,
  sessionId: string,
  userId: string
): Promise<{ answer: string; session_id: string; source: string; tools_used: string[]; followups: string[] }> {
  if (!anthropicConfigured()) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const { sid, history, system, filteredTools, toolsUsed, tickerHint } = await prepareLargoTurn(
    question,
    sessionId,
    userId
  );

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
        return runLargoTool(name, input, userId);
      },
    });

    const text =
      answer?.trim() ||
      "I couldn't pull enough live data to answer that — try naming a ticker or asking about SPX structure.";

    // Persist the completed turn now that the model produced an answer: user
    // first, then assistant, so role alternation is always intact (LARGO-3).
    await appendLargoMessage(sid, userId, "user", question);
    await appendLargoMessage(sid, userId, "assistant", text, Array.from(new Set(toolsUsed)));

    const followups = await generateLargoFollowups(question, text, tickerHint);

    return {
      answer: text,
      session_id: sid,
      source: dbConfigured() ? "blackout-web+postgres" : "blackout-web",
      tools_used: Array.from(new Set(toolsUsed)),
      followups,
    };
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

  const { sid, history, system, filteredTools, toolsUsed, tickerHint } = await prepareLargoTurn(
    question,
    sessionId,
    userId
  );

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
      onEvent: (event) => emit(event),
      runTool: async (name, input) => {
        toolsUsed.push(name);
        return runLargoTool(name, input, userId);
      },
    });

    const text =
      answer?.trim() ||
      "I couldn't pull enough live data to answer that — try naming a ticker or asking about SPX structure.";

    // Persist the completed turn now that the model produced an answer: user
    // first, then assistant, so role alternation is always intact (LARGO-3).
    await appendLargoMessage(sid, userId, "user", question);
    await appendLargoMessage(sid, userId, "assistant", text, Array.from(new Set(toolsUsed)));

    // Dynamic, conversation-aware follow-up prompts (fail-open → []). Generated after the
    // answer is persisted so a follow-up hiccup can never lose the turn.
    const followups = await generateLargoFollowups(question, text, tickerHint);

    emit({
      type: "done",
      answer: text,
      session_id: sid,
      source: dbConfigured() ? "blackout-web+postgres" : "blackout-web",
      tools_used: Array.from(new Set(toolsUsed)),
      followups,
    });
  } catch (error) {
    if (isSseClientDisconnect(error)) return;
    const message = error instanceof Error ? error.message : "Largo query failed";
    try {
      onEvent({ type: "error", message });
    } catch (emitErr) {
      if (!isSseClientDisconnect(emitErr)) throw emitErr;
    }
  } finally {
    resetLargoSpxDeskCache(userId);
  }
}

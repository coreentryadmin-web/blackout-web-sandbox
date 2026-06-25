import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlock,
  MessageCreateParamsNonStreaming,
  MessageCreateParams,
  MessageParam,
  OutputConfig,
  Tool,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages/messages";
import { recordApiCall } from "@/lib/api-telemetry";
import { SpendTracker, type AnthropicUsage, type SpendRecord } from "@/lib/ai-spend";
import {
  aiSpendKey,
  aiSpendAlertThresholdUsd,
  aiSpendKillSwitchUsd,
  isOverAiSpendCeiling,
  spendThresholdJustCrossed,
  AI_SPEND_INCR_LUA,
  secondsUntilEtMidnight,
} from "@/lib/ai-spend-ledger";
import { getUwCacheRedis } from "@/lib/providers/uw-shared-cache";
import { notifyOpsDiscord } from "@/lib/spx-play-notify";

// Per-process daily AI-spend tripwire. It survives Redis loss, so it is kept as the
// FALLBACK alerter (used only when the cross-replica ledger below is unreachable). The
// per-process multi-replica caveat is documented in ai-spend.ts.
const spendTracker = new SpendTracker({
  thresholdUsd: aiSpendAlertThresholdUsd(),
});

// Minimal Redis surface needed for the org-wide ledger. getUwCacheRedis returns a narrower
// type; cast to this so we can call eval/get, which ioredis supports at runtime (same cast
// approach as the Largo gate in largo/query/route.ts).
type SpendRedis = {
  get(key: string): Promise<string | null>;
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
} | null;

/** Fire one ops-Discord alert describing a threshold crossing. `orgWide` distinguishes the
 *  authoritative cross-replica total from the degraded per-process fallback in the message. */
function fireSpendAlert(a: { day: string; total: number; threshold: number; orgWide: boolean }): void {
  const scope = a.orgWide
    ? "ORG-WIDE total (cross-replica Redis ledger)"
    : "per-process only — Redis ledger unavailable, true org-wide total is higher";
  void notifyOpsDiscord({
    title: "AI spend threshold crossed",
    body:
      `Anthropic spend for ET day ${a.day} reached $${a.total.toFixed(2)} ` +
      `(threshold $${a.threshold.toFixed(2)}). Scope: ${scope}.`,
    severity: "warning",
  });
}

/**
 * Cross-replica spend accounting. Atomically INCRBYFLOATs the org-wide daily counter in shared
 * Redis and alerts ONCE when the org total crosses the threshold (the atomic increment makes
 * "just crossed" cluster-unique — no flag needed). If Redis is unreachable, falls back to the
 * per-process tripwire's crossing so an alert can still fire (under-counting true org spend).
 * Best-effort throughout: never throws into the AI path.
 */
async function recordOrgSpend(localRec: SpendRecord): Promise<void> {
  const added = localRec.added;
  if (!(added > 0)) return; // unknown model / zero usage — nothing to record

  let redis: SpendRedis = null;
  try {
    redis = (await getUwCacheRedis()) as SpendRedis;
  } catch {
    redis = null;
  }

  // Redis unavailable: the per-process tripwire is the only signal we have.
  if (!redis) {
    if (localRec.thresholdJustCrossed) {
      fireSpendAlert({ day: localRec.day, total: localRec.dayTotal, threshold: localRec.threshold, orgWide: false });
    }
    return;
  }

  try {
    // Format to micro-dollar precision: avoids INCRBYFLOAT rejecting JS scientific notation
    // (e.g. "3e-7") for tiny costs, and keeps the crossing math consistent with what Redis stored.
    const addedStr = added.toFixed(6);
    const addedNum = Number(addedStr);
    const newTotal = Number(
      await redis.eval(AI_SPEND_INCR_LUA, 1, aiSpendKey(), addedStr, secondsUntilEtMidnight())
    );
    const threshold = aiSpendAlertThresholdUsd();
    if (spendThresholdJustCrossed(newTotal, addedNum, threshold)) {
      fireSpendAlert({ day: localRec.day, total: newTotal, threshold, orgWide: true });
    }
  } catch {
    // Redis write failed mid-flight — fall back to the per-process crossing if it fired.
    if (localRec.thresholdJustCrossed) {
      fireSpendAlert({ day: localRec.day, total: localRec.dayTotal, threshold: localRec.threshold, orgWide: false });
    }
  }
}

/**
 * Fire-and-forget spend accounting. MUST NOT add latency to the AI path: no await, no throw.
 * Always advances the per-process tripwire (cheap, sync) — its crossing is consumed only as the
 * Redis-down fallback inside recordOrgSpend, so there is no double-alert when Redis is healthy.
 * No-ops when usage is missing or the model is unknown (estimateCostUsd returns null).
 */
function trackSpend(model: string, usage: AnthropicUsage | null | undefined): void {
  let rec: SpendRecord;
  try {
    rec = spendTracker.record(model, usage);
  } catch {
    return; // spend telemetry is best-effort — never throw into the AI path
  }
  void recordOrgSpend(rec).catch(() => {
    /* best-effort: a failed ledger write must never surface in the AI path */
  });
}

/** Client-level retry budget passed to the Anthropic SDK. The SDK retries
 *  internally, so a single client.messages.create() call may make up to
 *  DEFAULT_MAX_RETRIES + 1 HTTP attempts. Telemetry max_attempts is derived
 *  from this so the dashboard reflects the real retry budget (P3 fix). */
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MODEL = "claude-sonnet-4-6";
export const LARGO_MODEL = "claude-sonnet-4-6";
export const COMMENTARY_MODEL = "claude-haiku-4-5";
const TEMPERATURE = 0.3;
/** Per-tool_result size cap. Heavy tools (GEX bundles, full flow payloads) are
 *  re-sent every loop round; without a cap they overflow the context window and
 *  Anthropic 400s with prompt-too-long (LARGO-5). */
const MAX_TOOL_RESULT_CHARS = 16_000;

export type AnthropicSystemBlock = {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
};

export type AnthropicSystem = string | AnthropicSystemBlock[];

export function anthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  return new Anthropic({ apiKey: key, maxRetries: DEFAULT_MAX_RETRIES, timeout: 20_000 });
}

function resolveModel(explicit?: string): string {
  return explicit?.trim() || process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
}

async function withTelemetry<T>(
  endpointKey: string,
  fn: () => Promise<T>,
  // Configured SDK retry budget for this call; max_attempts = maxRetries + 1.
  // The SDK retries internally within fn(), so we observe only the final
  // outcome and cannot know which attempt succeeded — attempt stays 1, but
  // max_attempts now reflects the real budget instead of a hardcoded 1.
  maxRetries: number = DEFAULT_MAX_RETRIES
): Promise<T> {
  const maxAttempts = maxRetries + 1;
  const start = Date.now();
  try {
    const result = await fn();
    recordApiCall({
      provider: "anthropic",
      endpoint: endpointKey,
      method: "POST",
      status: 200,
      ok: true,
      latency_ms: Date.now() - start,
      error: null,
      correlation_id: `anthropic-${Date.now()}`,
      attempt: 1,
      max_attempts: maxAttempts,
      phase: "success",
      request_url: "https://api.anthropic.com/v1/messages",
      request_body: null,
      response_snippet: null,
      rate_limited: false,
      headers_sent: [],
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      err instanceof Anthropic.APIError ? err.status ?? null : null;
    recordApiCall({
      provider: "anthropic",
      endpoint: endpointKey,
      method: "POST",
      status,
      ok: false,
      latency_ms: Date.now() - start,
      error: message.slice(0, 200),
      correlation_id: `anthropic-${Date.now()}`,
      attempt: maxAttempts,
      max_attempts: maxAttempts,
      phase: "failure",
      request_url: "https://api.anthropic.com/v1/messages",
      request_body: null,
      response_snippet: null,
      rate_limited: status === 429,
      headers_sent: [],
    });
    console.error("[anthropic]", status ?? "error", message);
    throw err;
  }
}


function extractTextFromBlocks(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((b): b is { type: "text"; text: string } => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

function extractTextFromLastAssistant(messages: AnthropicMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "assistant") continue;
    const content = messages[i].content;
    if (typeof content === "string") {
      const trimmed = content.trim();
      if (trimmed) return trimmed;
      continue;
    }
    if (Array.isArray(content)) {
      const text = extractTextFromBlocks(
        content as Array<{ type: string; text?: string }>
      );
      if (text) return text;
    }
  }
  return null;
}

/**
 * Org-wide hard AI-spend kill-switch, shared by EVERY Anthropic surface — not just Largo (audit S-5;
 * previously only largo/query checked it, so SPX commentary, GEX explain, NW narrative, NH critic etc.
 * spent ungated). OPT-IN: a fast no-op when DAILY_AI_SPEND_KILL_USD is unset. Fails OPEN on Redis loss
 * so an infra blip never blocks AI. When org daily spend is at/over the ceiling, callers degrade
 * (skip the request) instead of adding more spend.
 */
async function isAiSpendCeilingTripped(): Promise<boolean> {
  const ceiling = aiSpendKillSwitchUsd();
  if (ceiling == null) return false; // kill-switch not armed
  try {
    const redis = await getUwCacheRedis();
    if (!redis) return false; // fail-open on Redis loss
    const raw = await redis.get(aiSpendKey());
    return isOverAiSpendCeiling(Number(raw ?? 0), ceiling);
  } catch {
    return false; // fail-open on any Redis error
  }
}

export async function anthropicText(
  prompt: string,
  maxTokens = 600,
  system?: AnthropicSystem,
  options?: {
    output_config?: OutputConfig;
    temperature?: number;
    model?: string;
    /** Per-request timeout override (ms). The client default is 20s, too tight for
     *  large generations (e.g. the 3000-token desk commentary). */
    timeoutMs?: number;
    /** Per-request retry override. Client default is 3; lower it for big calls so a
     *  slow generation doesn't retry 3× and stack to ~60s before failing. */
    maxRetries?: number;
  }
): Promise<string | null> {
  const client = getClient();
  if (!client) return null;
  if (await isAiSpendCeilingTripped()) {
    console.warn("[anthropic] daily AI spend ceiling reached — skipping anthropic-text");
    return null;
  }

  const model = resolveModel(options?.model);
  const body: MessageCreateParamsNonStreaming = {
    model,
    max_tokens: maxTokens,
    temperature: options?.temperature ?? TEMPERATURE,
    messages: [{ role: "user", content: prompt }],
  };
  if (system) {
    body.system = typeof system === "string" ? system.trim() : system;
  }
  if (options?.output_config) {
    body.output_config = options.output_config;
  }

  const reqOpts: { timeout?: number; maxRetries?: number } = {};
  if (options?.timeoutMs != null) reqOpts.timeout = options.timeoutMs;
  if (options?.maxRetries != null) reqOpts.maxRetries = options.maxRetries;

  try {
    const data = await withTelemetry(
      "anthropic-text",
      () => client.messages.create(body, reqOpts),
      options?.maxRetries ?? DEFAULT_MAX_RETRIES
    );
    trackSpend(model, data.usage);
    const block = data.content.find((c) => c.type === "text");
    return block?.type === "text" ? block.text.trim() || null : null;
  } catch {
    return null;
  }
}

export type AnthropicToolDef = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

type AnthropicContentBlock = Record<string, unknown>;
export type AnthropicMessage = { role: string; content: string | AnthropicContentBlock[] };

export type AnthropicToolLoopEvent =
  | { type: "token"; text: string }
  | { type: "tool_start"; name: string };

export async function anthropicToolLoop(params: {
  system: AnthropicSystem;
  tools: AnthropicToolDef[];
  messages: AnthropicMessage[];
  model?: string;
  maxTokens?: number;
  maxRounds?: number;
  temperature?: number;
  runTool: (name: string, input: Record<string, unknown>) => Promise<unknown>;
  onEvent?: (event: AnthropicToolLoopEvent) => void;
}): Promise<string | null> {
  const client = getClient();
  if (!client) return null;
  if (await isAiSpendCeilingTripped()) {
    console.warn("[anthropic] daily AI spend ceiling reached — skipping anthropic tool loop");
    return null;
  }

  const model = resolveModel(params.model);
  const maxTokens = params.maxTokens ?? 4096;
  const maxRounds = params.maxRounds ?? 12;
  const loopTemperature = params.temperature ?? TEMPERATURE;
  const messages: MessageParam[] = params.messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content as MessageParam["content"],
  }));

  const tools: Tool[] = params.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Tool["input_schema"],
  }));

  const systemParam =
    typeof params.system === "string"
      ? params.system
      : params.system;

  for (let round = 0; round < maxRounds; round++) {
    const createParams: MessageCreateParams = {
      model,
      max_tokens: maxTokens,
      temperature: loopTemperature,
      system: systemParam,
      tools,
      messages,
    };

    let content: ContentBlock[];

    if (params.onEvent) {
      const stream = client.messages.stream(createParams);
      stream.on("text", (delta) => {
        try {
          params.onEvent?.({ type: "token", text: delta });
        } catch {
          /* SSE client disconnected — stop forwarding tokens */
        }
      });
      const finalMessage = await withTelemetry(
        "anthropic-tool-loop-stream",
        () => stream.finalMessage(),
        DEFAULT_MAX_RETRIES
      );
      trackSpend(model, finalMessage.usage);
      content = finalMessage.content;
    } else {
      const data = await withTelemetry(
        "anthropic-tool-loop",
        () => client.messages.create(createParams),
        DEFAULT_MAX_RETRIES
      );
      trackSpend(model, data.usage);
      content = data.content;
    }

    const toolCalls = content.filter((b): b is ToolUseBlock => b.type === "tool_use");

    if (!toolCalls.length) {
      const text = extractTextFromBlocks(content as Array<{ type: string; text?: string }>);
      return text || null;
    }

    messages.push({ role: "assistant", content: content as unknown as MessageParam["content"] });

    const results = await Promise.all(
      toolCalls.map(async (tc) => {
        const name = tc.name;
        try {
          params.onEvent?.({ type: "tool_start", name });
        } catch {
          /* SSE client disconnected */
        }
        const input = tc.input as Record<string, unknown>;
        try {
          return await params.runTool(name, input);
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      })
    );

    messages.push({
      role: "user",
      content: toolCalls.map((tc, i) => {
        const raw = JSON.stringify(results[i]) ?? "null";
        const capped =
          raw.length > MAX_TOOL_RESULT_CHARS
            ? raw.slice(0, MAX_TOOL_RESULT_CHARS) + "…[truncated]"
            : raw;
        return {
          type: "tool_result" as const,
          tool_use_id: tc.id,
          content: capped,
        };
      }),
    });
    // No end_turn break here: a response carrying tool_use blocks always has
    // stop_reason "tool_use", so the loop exits via the no-tool-calls return
    // above or maxRounds — the old end_turn check was dead code (LARGO-4).
  }

  // maxRounds exhausted: one non-streaming synthesis pass to coerce a final answer.
  // Guard it — if this call throws (timeout/429/network), do NOT crash the loop and
  // its callers. Fall back to the last assistant text already accumulated in `messages`
  // (often a usable partial answer), else null. (Streaming of this final pass is out of scope.)
  try {
    const final = await withTelemetry(
      "anthropic-tool-loop-final",
      () =>
        client.messages.create({
          model,
          max_tokens: maxTokens,
          temperature: loopTemperature,
          system: systemParam,
          messages,
        }),
      DEFAULT_MAX_RETRIES
    );
    trackSpend(model, final.usage);
    return extractTextFromBlocks(final.content as Array<{ type: string; text?: string }>) || null;
  } catch (err) {
    console.error(
      "[anthropic] tool-loop final synthesis failed",
      err instanceof Error ? err.message : String(err)
    );
    return extractTextFromLastAssistant(messages as unknown as AnthropicMessage[]) ?? null;
  }
}

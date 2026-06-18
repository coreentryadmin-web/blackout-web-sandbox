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

const DEFAULT_MODEL = "claude-opus-4-6";
const TEMPERATURE = 0.3;

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
  return new Anthropic({ apiKey: key, maxRetries: 3 });
}

function getModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
}

async function withTelemetry<T>(
  endpointKey: string,
  fn: () => Promise<T>
): Promise<T> {
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
      max_attempts: 1,
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
      attempt: 1,
      max_attempts: 1,
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

export async function anthropicText(
  prompt: string,
  maxTokens = 600,
  system?: AnthropicSystem,
  options?: {
    output_config?: OutputConfig;
    temperature?: number;
  }
): Promise<string | null> {
  const client = getClient();
  if (!client) return null;

  const model = getModel();
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

  try {
    const data = await withTelemetry("anthropic-text", () => client.messages.create(body));
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
  maxTokens?: number;
  maxRounds?: number;
  runTool: (name: string, input: Record<string, unknown>) => Promise<unknown>;
  onEvent?: (event: AnthropicToolLoopEvent) => void;
}): Promise<string | null> {
  const client = getClient();
  if (!client) return null;

  const model = getModel();
  const maxTokens = params.maxTokens ?? 4096;
  const maxRounds = params.maxRounds ?? 12;
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
      temperature: TEMPERATURE,
      system: systemParam,
      tools,
      messages,
    };

    let content: ContentBlock[];
    let stopReason: string | null = null;

    if (params.onEvent) {
      const stream = client.messages.stream(createParams);
      stream.on("text", (delta) => {
        params.onEvent?.({ type: "token", text: delta });
      });
      const finalMessage = await withTelemetry("anthropic-tool-loop-stream", () =>
        stream.finalMessage()
      );
      content = finalMessage.content;
      stopReason = finalMessage.stop_reason;
    } else {
      const data = await withTelemetry("anthropic-tool-loop", () =>
        client.messages.create(createParams)
      );
      content = data.content;
      stopReason = data.stop_reason;
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
        params.onEvent?.({ type: "tool_start", name });
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
      content: toolCalls.map((tc, i) => ({
        type: "tool_result" as const,
        tool_use_id: tc.id,
        content: JSON.stringify(results[i]),
      })),
    });

    if (stopReason === "end_turn") break;
  }

  return extractTextFromLastAssistant(messages as AnthropicMessage[]);
}

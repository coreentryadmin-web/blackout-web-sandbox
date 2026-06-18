import { trackedFetch } from "@/lib/api-tracked-fetch";

const API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-20250514";

export function anthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export async function anthropicText(prompt: string, maxTokens = 600): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;

  const model = process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;

  const res = await trackedFetch("anthropic", "/v1/messages", API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    console.error("[anthropic]", res.status, await res.text().catch(() => ""));
    return null;
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const block = data.content?.find((c) => c.type === "text");
  return block?.text?.trim() ?? null;
}

export type AnthropicToolDef = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

type AnthropicContentBlock = Record<string, unknown>;
export type AnthropicMessage = { role: string; content: string | AnthropicContentBlock[] };

export async function anthropicToolLoop(params: {
  system: string;
  tools: AnthropicToolDef[];
  messages: AnthropicMessage[];
  maxTokens?: number;
  maxRounds?: number;
  runTool: (name: string, input: Record<string, unknown>) => Promise<unknown>;
}): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;

  const model = process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
  const maxTokens = params.maxTokens ?? 4096;
  const maxRounds = params.maxRounds ?? 12;
  const messages = [...params.messages];

  for (let round = 0; round < maxRounds; round++) {
    const res = await trackedFetch("anthropic", "/v1/messages", API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: params.system,
        tools: params.tools,
        messages,
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      console.error("[anthropic-tools]", res.status, await res.text().catch(() => ""));
      return null;
    }

    const data = (await res.json()) as {
      content?: AnthropicContentBlock[];
      stop_reason?: string;
    };
    const content = data.content ?? [];
    const toolCalls = content.filter((b) => b.type === "tool_use");

    if (!toolCalls.length) {
      const text = content
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string)
        .join("\n")
        .trim();
      return text || null;
    }

    messages.push({ role: "assistant", content });

    const results = await Promise.all(
      toolCalls.map(async (tc) => {
        const name = String(tc.name ?? "");
        const input = (tc.input as Record<string, unknown>) ?? {};
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
        type: "tool_result",
        tool_use_id: tc.id,
        content: JSON.stringify(results[i]),
      })),
    });

    if (data.stop_reason === "end_turn") break;
  }

  return null;
}

import {
  anthropicConfigured,
  anthropicToolLoop,
  type AnthropicMessage,
} from "@/lib/providers/anthropic";
import { dbConfigured } from "@/lib/db";
import { LARGO_SYSTEM_PROMPT } from "@/lib/largo/system-prompt";
import { LARGO_TOOL_DEFS } from "@/lib/largo/tool-defs";
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
import { finnhubConfigured, polygonConfigured, uwConfigured } from "@/lib/providers/config";
import { webSearchConfigured } from "@/lib/providers/web-search";
import { todayEtYmd } from "@/lib/providers/spx-session";

const MAX_HISTORY = 28;

function trimHistory(history: AnthropicMessage[]) {
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
}

function buildDynamicSystem(question: string, history: AnthropicMessage[]): string {
  const intent = analyzeLargoQuestion(question, history);
  return `${LARGO_SYSTEM_PROMPT}

## This turn (mandatory)
Session date (ET): ${todayEtYmd()}

${intent.guidance}

Remember: you are in a multi-turn chat stored in Postgres. Use prior messages for pronouns and follow-ups, but always refresh live numbers via tools before citing prices, GEX, or flow.`;
}

export function largoConfigured(): boolean {
  return anthropicConfigured();
}

export function largoDataSources(): {
  polygon: boolean;
  uw: boolean;
  finnhub: boolean;
  postgres: boolean;
  web_search: boolean;
  anthropic: boolean;
} {
  return {
    polygon: polygonConfigured(),
    uw: uwConfigured(),
    finnhub: finnhubConfigured(),
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

export async function runLargoQuery(
  question: string,
  sessionId: string,
  userId: string
): Promise<{ answer: string; session_id: string; source: string; tools_used: string[] }> {
  if (!anthropicConfigured()) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const sid = sessionId.trim() || `web-${userId}-${Date.now()}`;
  await ensureLargoSession(sid, userId);

  const history = await fetchLargoHistory(sid, userId);
  history.push({ role: "user", content: question });
  trimHistory(history);

  await appendLargoMessage(sid, userId, "user", question);

  const toolsUsed: string[] = [];
  const system = buildDynamicSystem(question, history.slice(0, -1));

  resetLargoSpxDeskCache();
  try {
    const answer = await anthropicToolLoop({
      system,
      tools: LARGO_TOOL_DEFS,
      messages: history,
      maxTokens: 4096,
      maxRounds: 16,
      runTool: async (name, input) => {
        toolsUsed.push(name);
        return runLargoTool(name, input);
      },
    });

    const text =
      answer?.trim() ||
      "I couldn't pull enough live data to answer that — try naming a ticker or asking about SPX structure.";

    await appendLargoMessage(sid, userId, "assistant", text, Array.from(new Set(toolsUsed)));

    return {
      answer: text,
      session_id: sid,
      source: dbConfigured() ? "blackout-web+postgres" : "blackout-web",
      tools_used: Array.from(new Set(toolsUsed)),
    };
  } finally {
    resetLargoSpxDeskCache();
  }
}

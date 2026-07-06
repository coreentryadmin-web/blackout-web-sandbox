"use client";

import { useEffect, useRef, useState } from "react";
import { queryLargoStream, fetchLargoSession } from "@/lib/api";
import { LARGO_SESSION_KEY } from "@/lib/session-cache";
import { isIosAppShell } from "@/lib/ios-app-shell";
import { largoStreamErrorMessage } from "@/lib/largo-stream-errors";

export type LargoMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools?: string[];
};

const TOOL_LABEL: Record<string, string> = {
  live_feed_capture: "live desk feed",
  get_spx_structure: "SPX desk",
  get_spx_confluence: "confluence engine",
  get_spx_play: "SPX play",
  get_gex: "GEX map",
  get_positioning: "dealer positioning",
  get_greek_flow: "dealer greek flow",
  get_options_flow: "options flow",
  get_global_flow: "market flow",
  get_flow_tape: "HELIX flow tape",
  get_dark_pool: "dark pool",
  get_market_context: "market context",
  get_market_breadth: "market breadth",
  get_technicals: "technicals",
  get_quote: "live quote",
  get_nbbo: "NBBO",
  get_news: "news",
  get_web_search: "web search",
  get_nighthawk_edition: "Night Hawk",
  get_zerodte_plays: "0DTE Command plays",
  get_my_positions: "your positions",
  get_greeks: "greeks",
  get_max_pain: "max pain",
  get_iv_stats: "IV rank",
  get_options_chain: "options chain",
  get_open_plays: "open plays",
  get_lotto_live: "lotto play",
  get_earnings: "earnings",
  get_analyst_ratings: "analyst ratings",
  get_catalysts: "catalysts",
  get_congress_trades: "congress trades",
  get_predictions_consensus: "predictions",
};

export function largoToolLabel(name: string): string {
  return TOOL_LABEL[name] ?? name.replace(/^get_/, "").replace(/_/g, " ");
}

export const LARGO_WELCOME: LargoMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Largo online. Ask anything specific — SPX levels, a ticker, flow, news. I pull live data on every question and keep the thread.",
};

export const LARGO_SUGGESTIONS = [
  "What's the SPX setup right now?",
  "Is this flow real or noise?",
  "Where are dealers trapped on the gamma map?",
  "Give me today's market structure in 3 lines",
] as const;

function upsertAssistantMessage(
  messages: LargoMessage[],
  assistantId: string,
  patch: Partial<LargoMessage> & { content: string }
): LargoMessage[] {
  const existing = messages.find((msg) => msg.id === assistantId);
  if (!existing) {
    return [...messages, { id: assistantId, role: "assistant", ...patch }];
  }
  return messages.map((msg) => (msg.id === assistantId ? { ...msg, ...patch } : msg));
}

/** Shared Largo chat session + streaming (web desk + native mobile). */
export function useLargoChat() {
  const [messages, setMessages] = useState<LargoMessage[]>([LARGO_WELCOME]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [followups, setFollowups] = useState<string[]>([]);
  const [activeTools, setActiveTools] = useState<string[]>([]);
  const sessionId = useRef("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const msgId = useRef(1);
  const streamBufRef = useRef("");
  const streamFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const stored =
      typeof window !== "undefined" ? sessionStorage.getItem(LARGO_SESSION_KEY) : null;
    sessionId.current = stored || `web-${Date.now()}`;

    fetchLargoSession(sessionId.current)
      .then((data) => {
        if (data.session_id) sessionId.current = data.session_id;
        sessionStorage.setItem(LARGO_SESSION_KEY, sessionId.current);
        if (data.messages?.length) {
          setMessages(
            data.messages.map((m) => ({
              id: `m-${m.id}`,
              role: m.role,
              content: m.content,
              tools: m.tools_used?.length ? m.tools_used : undefined,
            }))
          );
        }
      })
      .catch(() => {
        /* keep welcome */
      })
      .finally(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search).get("q");
    if (q?.trim()) setInput(q.trim().slice(0, 500));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, activeTools]);

  async function runQuery(rawQ: string) {
    const q = rawQ.trim();
    if (!q || loading || !hydrated) return;

    setInput("");
    setFollowups([]);
    setActiveTools([]);
    const userId = `u-${++msgId.current}`;
    setMessages((m) => [...m.filter((x) => x.id !== "welcome"), { id: userId, role: "user", content: q }]);
    setLoading(true);
    setStreaming(false);

    const assistantId = `a-${++msgId.current}`;

    streamBufRef.current = "";
    if (streamFlushRef.current) {
      clearTimeout(streamFlushRef.current);
      streamFlushRef.current = null;
    }

    try {
      const res = await queryLargoStream(
        q,
        sessionId.current,
        (token) => {
          streamBufRef.current += token;
          setStreaming(true);
          if (!streamFlushRef.current) {
            streamFlushRef.current = setTimeout(() => {
              streamFlushRef.current = null;
              const content = streamBufRef.current;
              setMessages((m) => upsertAssistantMessage(m, assistantId, { content }));
            }, 50);
          }
        },
        (toolName) => {
          const label = largoToolLabel(toolName);
          setActiveTools((prev) => (prev.includes(label) ? prev : [...prev, label]));
        }
      );
      sessionId.current = res.session_id;
      sessionStorage.setItem(LARGO_SESSION_KEY, sessionId.current);
      setMessages((m) =>
        upsertAssistantMessage(m, assistantId, {
          content: res.answer,
          tools: res.tools_used,
        })
      );
      setFollowups(Array.isArray(res.followups) ? res.followups.slice(0, 3) : []);
    } catch (err) {
      const content = largoStreamErrorMessage(err instanceof Error ? err.message : "", {
        ios: isIosAppShell(),
      });
      setMessages((m) => upsertAssistantMessage(m, assistantId, { content }));
    } finally {
      if (streamFlushRef.current) {
        clearTimeout(streamFlushRef.current);
        streamFlushRef.current = null;
      }
      setLoading(false);
      setStreaming(false);
      setActiveTools([]);
    }
  }

  const isFresh = messages.length === 1 && messages[0]?.id === "welcome";

  return {
    messages,
    input,
    setInput,
    loading,
    streaming,
    hydrated,
    followups,
    activeTools,
    bottomRef,
    runQuery,
    isFresh,
  };
}

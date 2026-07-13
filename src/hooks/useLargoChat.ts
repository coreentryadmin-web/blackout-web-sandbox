"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { queryLargoStream, fetchLargoSession, LargoStreamAborted } from "@/lib/api";
import { LARGO_SESSION_KEY } from "@/lib/session-cache";
import { isIosAppShell } from "@/lib/ios-app-shell";
import { largoStreamErrorMessage } from "@/lib/largo-stream-errors";
import {
  conversationTitle,
  loadConversations,
  removeConversation,
  saveConversations,
  upsertConversation,
  type LargoConversation,
} from "@/features/largo/conversation-history";

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

/**
 * Curated empty-state showcase prompts (BIE Master Spec §6 — example prompts).
 * These span the intent range the engine must handle — a terse directional read,
 * a cross-tool setup verdict, and a self-diagnosis question — so a first-time
 * member immediately sees the terminal is more than a search box.
 */
export const LARGO_EXAMPLE_PROMPTS: { label: string; hint: string }[] = [
  { label: "SPX trend?", hint: "Fast directional read + key levels + invalidation" },
  { label: "Is 7500 0DTE good today?", hint: "Cross-tool setup verdict, graded" },
  { label: "Why isn't MSFT forming?", hint: "Self-diagnosis from real ops signals" },
  { label: "Where are dealers trapped on the gamma map?", hint: "GEX + dealer positioning" },
];

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

function firstUserQuestion(messages: LargoMessage[]): string {
  return messages.find((m) => m.role === "user")?.content ?? "";
}

function newSessionId(): string {
  return `web-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
  const [conversations, setConversations] = useState<LargoConversation[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [canRegenerate, setCanRegenerate] = useState(false);
  const sessionId = useRef("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const msgId = useRef(1);
  const streamBufRef = useRef("");
  const streamFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // First question of the active thread — the stable label for the history index.
  const threadTitleRef = useRef("");
  // Last user question, replayed by regenerate().
  const lastQueryRef = useRef("");

  const setSession = useCallback((id: string) => {
    sessionId.current = id;
    setActiveSessionId(id);
    if (typeof window !== "undefined") sessionStorage.setItem(LARGO_SESSION_KEY, id);
  }, []);

  useEffect(() => {
    setConversations(loadConversations());
  }, []);

  useEffect(() => {
    const stored =
      typeof window !== "undefined" ? sessionStorage.getItem(LARGO_SESSION_KEY) : null;
    const initial = stored || newSessionId();
    setSession(initial);

    fetchLargoSession(initial)
      .then((data) => {
        if (data.session_id) setSession(data.session_id);
        if (data.messages?.length) {
          const hydratedMsgs = data.messages.map((m) => ({
            id: `m-${m.id}`,
            role: m.role,
            content: m.content,
            tools: m.tools_used?.length ? m.tools_used : undefined,
          }));
          setMessages(hydratedMsgs);
          threadTitleRef.current = firstUserQuestion(hydratedMsgs);
          setCanRegenerate(
            hydratedMsgs.some((m) => m.role === "assistant" && m.id !== "welcome")
          );
        }
      })
      .catch(() => {
        /* keep welcome */
      })
      .finally(() => setHydrated(true));
  }, [setSession]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search).get("q");
    if (q?.trim()) setInput(q.trim().slice(0, 500));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, activeTools]);

  const recordConversation = useCallback((id: string, title: string, drop?: string) => {
    setConversations((prev) => {
      let next = prev;
      // A provisional id may differ from the server's authoritative session_id;
      // drop the stale provisional entry so the thread appears once.
      if (drop && drop !== id) next = removeConversation(next, drop);
      next = upsertConversation(next, {
        id,
        title: conversationTitle(title),
        updatedAt: Date.now(),
      });
      saveConversations(next);
      return next;
    });
  }, []);

  const runQuery = useCallback(
    async (rawQ: string, opts?: { regenerate?: boolean }) => {
      const q = rawQ.trim();
      if (!q || loading || !hydrated) return;

      const regenerate = opts?.regenerate ?? false;
      setInput("");
      setFollowups([]);
      setActiveTools([]);
      setCanRegenerate(false);
      lastQueryRef.current = q;

      if (!threadTitleRef.current) threadTitleRef.current = q;

      if (!regenerate) {
        const userId = `u-${++msgId.current}`;
        setMessages((m) => [
          ...m.filter((x) => x.id !== "welcome"),
          { id: userId, role: "user", content: q },
        ]);
      } else {
        // Replace the previous answer in place: drop the trailing assistant turn.
        setMessages((m) => {
          const lastAssistant = [...m].reverse().find((x) => x.role === "assistant");
          return lastAssistant ? m.filter((x) => x.id !== lastAssistant.id) : m;
        });
      }

      setLoading(true);
      setStreaming(false);

      const assistantId = `a-${++msgId.current}`;
      const provisionalSid = sessionId.current;

      streamBufRef.current = "";
      if (streamFlushRef.current) {
        clearTimeout(streamFlushRef.current);
        streamFlushRef.current = null;
      }

      const controller = new AbortController();
      abortRef.current = controller;

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
          },
          controller.signal
        );
        setSession(res.session_id);
        setMessages((m) =>
          upsertAssistantMessage(m, assistantId, {
            content: res.answer,
            tools: res.tools_used,
          })
        );
        setFollowups(Array.isArray(res.followups) ? res.followups.slice(0, 3) : []);
        setCanRegenerate(true);
        recordConversation(res.session_id, threadTitleRef.current || q, provisionalSid);
      } catch (err) {
        if (err instanceof LargoStreamAborted) {
          // User pressed Stop. Keep whatever streamed so far; if nothing did,
          // drop the empty assistant bubble rather than showing an error.
          const partial = streamBufRef.current;
          if (partial.trim()) {
            setMessages((m) =>
              upsertAssistantMessage(m, assistantId, {
                content: `${partial}\n\n_Stopped._`,
              })
            );
            setCanRegenerate(true);
          } else {
            setMessages((m) => m.filter((x) => x.id !== assistantId));
          }
        } else {
          const content = largoStreamErrorMessage(err instanceof Error ? err.message : "", {
            ios: isIosAppShell(),
          });
          setMessages((m) => upsertAssistantMessage(m, assistantId, { content }));
          setCanRegenerate(true);
        }
      } finally {
        if (streamFlushRef.current) {
          clearTimeout(streamFlushRef.current);
          streamFlushRef.current = null;
        }
        abortRef.current = null;
        setLoading(false);
        setStreaming(false);
        setActiveTools([]);
      }
    },
    [loading, hydrated, setSession, recordConversation]
  );

  /** Abort the in-flight turn; partial streamed content is preserved. */
  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /** Re-run the last question, replacing the previous answer in place. */
  const regenerate = useCallback(() => {
    if (loading || !lastQueryRef.current) return;
    void runQuery(lastQueryRef.current, { regenerate: true });
  }, [loading, runQuery]);

  /** Start a fresh thread (new server session on the next question). */
  const newConversation = useCallback(() => {
    if (loading) return;
    setSession(newSessionId());
    setMessages([LARGO_WELCOME]);
    setFollowups([]);
    setInput("");
    setCanRegenerate(false);
    threadTitleRef.current = "";
    lastQueryRef.current = "";
  }, [loading, setSession]);

  /** Re-open a stored conversation by session id. */
  const switchConversation = useCallback(
    async (id: string) => {
      if (loading || id === sessionId.current) return;
      setSession(id);
      setFollowups([]);
      setInput("");
      setHydrated(false);
      try {
        const data = await fetchLargoSession(id);
        if (data.session_id) setSession(data.session_id);
        const msgs: LargoMessage[] = data.messages?.length
          ? data.messages.map((m) => ({
              id: `m-${m.id}`,
              role: m.role,
              content: m.content,
              tools: m.tools_used?.length ? m.tools_used : undefined,
            }))
          : [LARGO_WELCOME];
        setMessages(msgs);
        threadTitleRef.current = firstUserQuestion(msgs);
        setCanRegenerate(msgs.some((m) => m.role === "assistant" && m.id !== "welcome"));
      } catch {
        setMessages([LARGO_WELCOME]);
      } finally {
        setHydrated(true);
      }
    },
    [loading, setSession]
  );

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
    conversations,
    activeSessionId,
    canRegenerate,
    bottomRef,
    runQuery,
    cancel,
    regenerate,
    newConversation,
    switchConversation,
    isFresh,
  };
}

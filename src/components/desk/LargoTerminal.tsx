"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import { queryLargoStream, fetchLargoSession } from "@/lib/api";
import { LARGO_SESSION_KEY } from "@/lib/session-cache";
import { isIosAppShell } from "@/lib/ios-app-shell";
import { Panel, PanelHeader, FreshnessChip, Button } from "@/components/ui";
import { LargoThinkingState } from "./LargoThinkingState";
import { LargoMessageBody } from "./LargoMessageBody";

type Message = { id: string; role: "user" | "assistant"; content: string; tools?: string[] };

const INPUT_PLACEHOLDER = "Ask the desk — SPX levels, a ticker, flow, news…";
const INPUT_PLACEHOLDER_BUSY = "Pulling live data…";

// Friendly labels for the live tool-trace — what data Largo is pulling, in real time.
// Falls back to a humanized name (get_flow_tape → "flow tape") for anything unmapped.
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

function toolLabel(name: string): string {
  return TOOL_LABEL[name] ?? name.replace(/^get_/, "").replace(/_/g, " ");
}

const WELCOME: Message = {
  id: "welcome",
  role: "assistant",
  content:
    "Largo online. Ask anything specific — SPX levels, a ticker, flow, news. I pull live data on every question and keep the thread.",
};

// Starter prompts shown in the empty state — fill the void + teach what Largo can do.
const LARGO_SUGGESTIONS = [
  "What's the SPX setup right now?",
  "Is this flow real or noise?",
  "Where are dealers trapped on the gamma map?",
  "Give me today's market structure in 3 lines",
] as const;

export function LargoTerminal({ fullPage = false }: { fullPage?: boolean }) {
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  // Dynamic, conversation-aware follow-up prompts returned with each answer (replaces the
  // fixed starter chips once the conversation is underway).
  const [followups, setFollowups] = useState<string[]>([]);
  // Live tool-trace — the real data sources Largo pulls this turn (streamed via tool_start).
  const [activeTools, setActiveTools] = useState<string[]>([]);
  const sessionId = useRef("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const msgId = useRef(1);
  // R-47: batch streaming token updates. Without this, every streamed token called
  // setMessages → full messages.map() re-render + Framer Motion reconciliation.
  // We accumulate tokens in a ref and flush to state at most every 50ms.
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

  // Deep-link prefill (?q=…) from other desk surfaces (e.g. the 0DTE board's
  // "Ask LARGO" buttons). Prefill ONLY — never auto-submit, so the send still
  // goes through the user's hands and every budget/concurrency gate as usual.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search).get("q");
    if (q?.trim()) setInput(q.trim().slice(0, 500));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function runQuery(rawQ: string) {
    const q = rawQ.trim();
    if (!q || loading || !hydrated) return;

    setInput("");
    setFollowups([]); // clear stale follow-ups while the new turn runs
    setActiveTools([]); // reset the live tool-trace for the new turn
    const userId = `u-${++msgId.current}`;
    setMessages((m) => [...m.filter((x) => x.id !== "welcome"), { id: userId, role: "user", content: q }]);
    setLoading(true);
    setStreaming(false);

    const assistantId = `a-${++msgId.current}`;
    setMessages((m) => [...m, { id: assistantId, role: "assistant", content: "" }]);

    // Reset streaming buffer for this turn.
    streamBufRef.current = "";
    if (streamFlushRef.current) { clearTimeout(streamFlushRef.current); streamFlushRef.current = null; }

    try {
      const res = await queryLargoStream(
        q,
        sessionId.current,
        (token) => {
          // Accumulate in a ref (no re-render). Schedule a 50ms flush that batches
          // all tokens received in that window into one setMessages call. At 20 flushes/
          // second the message list re-renders at most 20× instead of once per token.
          streamBufRef.current += token;
          setStreaming(true);
          if (!streamFlushRef.current) {
            streamFlushRef.current = setTimeout(() => {
              streamFlushRef.current = null;
              const content = streamBufRef.current;
              setMessages((m) =>
                m.map((msg) => (msg.id === assistantId ? { ...msg, content } : msg))
              );
            }, 50);
          }
        },
        (toolName) => {
          const label = toolLabel(toolName);
          setActiveTools((prev) => (prev.includes(label) ? prev : [...prev, label]));
        }
      );
      sessionId.current = res.session_id;
      sessionStorage.setItem(LARGO_SESSION_KEY, sessionId.current);
      setMessages((m) =>
        m.map((msg) =>
          msg.id === assistantId
            ? { ...msg, content: res.answer, tools: res.tools_used }
            : msg
        )
      );
      setFollowups(Array.isArray(res.followups) ? res.followups.slice(0, 3) : []);
    } catch (err) {
      const raw = err instanceof Error ? err.message : "";
      let content =
        "Connection interrupted — couldn't reach live data. Send your question again.";
      if (raw.includes("401")) content = "Sign in with Premium to reach Largo.";
      else if (raw.includes("403")) {
        // App Store guideline 3.1.1 — no purchase-flow language inside the iOS app.
        // Runs from a user-triggered handler (never during initial render), so a
        // direct client-side check is safe here — no hydration mismatch risk.
        content = isIosAppShell()
          ? "Largo is a Premium instrument. Membership is managed on the web."
          : "Largo is a Premium instrument. Unlock Premium to deploy it.";
      }
      else if (raw.includes("503")) content = "Largo offline — the desk will reconnect shortly.";
      setMessages((m) =>
        m.map((msg) => (msg.id === assistantId ? { ...msg, content } : msg))
      );
    } finally {
      // Cancel any pending 50ms flush — the final answer will be written immediately
      // below (success path) or content is already set (error path).
      if (streamFlushRef.current) { clearTimeout(streamFlushRef.current); streamFlushRef.current = null; }
      setLoading(false);
      setStreaming(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    void runQuery(input);
  }

  const isFresh = messages.length === 1 && messages[0]?.id === "welcome";

  return (
    <Panel
      accent="accent"
      strip={!fullPage}
      header={
        fullPage ? undefined : (
          <PanelHeader
            kicker="Desk AI"
            title="Largo Terminal"
            actions={
              loading ? undefined : hydrated ? <FreshnessChip status="live" /> : undefined
            }
          >
            <p className="mt-1 text-sm text-secondary">Grounded in live platform data</p>
          </PanelHeader>
        )
      }
      className={clsx(
        "flex flex-col largo-chat-shell",
        fullPage ? "largo-terminal-fullpage" : "min-h-[560px]",
        loading && "largo-chat-shell-processing"
      )}
      bodyClassName="flex flex-1 flex-col min-h-0 !p-0 desk-panel-body-bare"
    >
      <div className="flex-1 flex flex-col min-h-0 largo-chat-container">
        <div
          role="log"
          aria-live="polite"
          aria-atomic="false"
          className={clsx(
            "flex-1 overflow-y-auto flex flex-col gap-4 mb-4 pr-2 largo-messages-scroll",
            fullPage ? "largo-messages-fullpage" : "max-h-[420px]",
            // Empty state: center the welcome + starter prompts in the tall chat area so it reads as an
            // intentional resting state instead of content stuck at the top above a large empty void.
            isFresh && !loading && "justify-center"
          )}
        >
          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={
                  msg.role === "user"
                    ? { opacity: 0, x: 18, scale: 0.98 }
                    : { opacity: 0, y: 14, scale: 0.98 }
                }
                animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className={clsx(
                  "largo-msg-bubble",
                  msg.role === "user" ? "desk-largo-user largo-msg-user" : "desk-largo-assistant largo-msg-assistant",
                  msg.id === "welcome" && "largo-msg-welcome"
                )}
              >
                <p className="largo-msg-label">
                  {msg.role === "user" ? "You" : "Largo"}
                </p>
                {msg.role === "assistant" ? (
                  <LargoMessageBody
                    content={msg.content}
                    className={fullPage ? "text-sm md:text-[15px] lg:text-base" : "text-sm"}
                  />
                ) : (
                  <p
                    className={clsx(
                      "largo-msg-text leading-relaxed whitespace-pre-wrap",
                      fullPage ? "text-sm md:text-[15px] lg:text-base" : "text-sm"
                    )}
                  >
                    {msg.content}
                  </p>
                )}
                {msg.role === "assistant" && msg.tools && msg.tools.length > 0 && (
                  <div className="largo-tools-used">
                    {msg.tools.map((t) => (
                      <span key={t} className="largo-tool-chip">
                        {toolLabel(t)}
                      </span>
                    ))}
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Empty-state starter prompts — one tap deploys the question. */}
          {isFresh && !loading && hydrated && (
            <motion.div
              className="largo-suggestions"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
            >
              <p className="largo-suggestions-label">Try asking</p>
              <div className="largo-suggestions-grid">
                {LARGO_SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="largo-suggestion-chip"
                    onClick={() => void runQuery(s)}
                  >
                    <span aria-hidden className="largo-suggestion-arrow">▸</span>
                    {s}
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {/* Dynamic, conversation-aware follow-ups — generated from the last exchange,
              shown after each answer. One tap continues the thread. */}
          {!isFresh && !loading && followups.length > 0 && (
            <motion.div
              className="largo-suggestions largo-followups"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            >
              <p className="largo-suggestions-label">Ask next</p>
              <div className="largo-suggestions-grid">
                {followups.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="largo-suggestion-chip"
                    onClick={() => void runQuery(s)}
                  >
                    <span aria-hidden className="largo-suggestion-arrow">▸</span>
                    {s}
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          <AnimatePresence mode="wait">
            {loading && !streaming && (
              <div className="largo-msg-bubble largo-thinking-wrap">
                <LargoThinkingState key="largo-thinking" tools={activeTools} />
              </div>
            )}
          </AnimatePresence>
          <div ref={bottomRef} />
        </div>

        <form
          onSubmit={submit}
          className={clsx(
            // `desk-largo-input-row` border-top is grey in globals.css → cyan brand override.
            "desk-largo-input-row largo-input-form !border-cyan-400/15",
            fullPage && "largo-input-form-fullpage"
          )}
        >
          <div className="relative flex-1 largo-input-wrap">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={loading ? INPUT_PLACEHOLDER_BUSY : INPUT_PLACEHOLDER}
              aria-label="Ask Largo"
              className={clsx(
                // `desk-largo-input` base border is grey in globals.css → cyan brand override.
                "desk-largo-input w-full !border-cyan-400/25",
                loading && "largo-input-busy",
                !input && !loading && hydrated && "largo-input-idle",
                fullPage && "largo-input-fullpage"
              )}
              disabled={loading || !hydrated}
            />
            {!input && !loading && hydrated && (
              <span className="largo-input-placeholder" aria-hidden>
                <span className="largo-input-placeholder-marquee">{INPUT_PLACEHOLDER}</span>
              </span>
            )}
            {loading && (
              <span className="largo-input-placeholder" aria-hidden>
                <span className="largo-input-placeholder-marquee">{INPUT_PLACEHOLDER_BUSY}</span>
              </span>
            )}
          </div>
          {/*
            Send action → <Button>. We drop the off-brand `.desk-largo-send`
            (bg-purple / purple hover glow lives in globals.css, out of scope) and
            give the Button explicit Largo-cyan brand utilities instead. All
            handlers + the loading/idle label content are preserved verbatim.
          */}
          <Button
            type="submit"
            variant="ghost"
            size="md"
            disabled={loading || !hydrated || !input.trim()}
            className={clsx(
              "rounded-none font-syne text-xs uppercase tracking-[0.2em]",
              "!bg-cyan-400/12 !border-cyan-400/40 !text-cyan-300",
              "hover:!bg-cyan-400/20 hover:!border-cyan-400/60",
              "shadow-[0_0_20px_-6px_rgba(34,211,238,0.5)]"
            )}
          >
            {loading ? (
              <span className="largo-send-pulse">
                <span className="largo-send-dot" />
                WORKING
              </span>
            ) : (
              "Send"
            )}
          </Button>
        </form>
      </div>
    </Panel>
  );
}

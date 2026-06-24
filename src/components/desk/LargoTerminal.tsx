"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import { queryLargoStream, fetchLargoSession } from "@/lib/api";
import { LARGO_SESSION_KEY } from "@/lib/session-cache";
import { DeskPanel } from "./DeskPanel";
import { LargoThinkingState } from "./LargoThinkingState";
import { LargoMessageBody } from "./LargoMessageBody";
import { Button } from "@/components/ui";

type Message = { id: string; role: "user" | "assistant"; content: string; tools?: string[] };

const INPUT_PLACEHOLDER = "Ask the desk — SPX levels, a ticker, flow, news ...";
const INPUT_PLACEHOLDER_BUSY = "Pulling live data ...";

const WELCOME: Message = {
  id: "welcome",
  role: "assistant",
  content:
    "Largo online. Ask anything specific — SPX levels, a ticker, flow, news. I pull live data on every question and keep the thread.",
};

export function LargoTerminal({ fullPage = false }: { fullPage?: boolean }) {
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const sessionId = useRef("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const msgId = useRef(1);

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
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q || loading || !hydrated) return;

    setInput("");
    const userId = `u-${++msgId.current}`;
    setMessages((m) => [...m.filter((x) => x.id !== "welcome"), { id: userId, role: "user", content: q }]);
    setLoading(true);
    setStreaming(false);

    const assistantId = `a-${++msgId.current}`;
    setMessages((m) => [...m, { id: assistantId, role: "assistant", content: "" }]);

    try {
      const res = await queryLargoStream(q, sessionId.current, (token) => {
        setStreaming(true);
        setMessages((m) =>
          m.map((msg) =>
            msg.id === assistantId ? { ...msg, content: msg.content + token } : msg
          )
        );
      });
      sessionId.current = res.session_id;
      sessionStorage.setItem(LARGO_SESSION_KEY, sessionId.current);
      setMessages((m) =>
        m.map((msg) =>
          msg.id === assistantId
            ? { ...msg, content: res.answer, tools: res.tools_used }
            : msg
        )
      );
    } catch (err) {
      const raw = err instanceof Error ? err.message : "";
      let content =
        "Connection interrupted — couldn't reach live data. Send your question again.";
      if (raw.includes("401")) content = "Sign in with Premium to reach Largo.";
      else if (raw.includes("403")) content = "Largo is a Premium instrument. Unlock Premium to deploy it.";
      else if (raw.includes("503")) content = "Largo offline — the desk will reconnect shortly.";
      setMessages((m) =>
        m.map((msg) => (msg.id === assistantId ? { ...msg, content } : msg))
      );
    } finally {
      setLoading(false);
      setStreaming(false);
    }
  }

  return (
    <DeskPanel
      title="Largo Terminal"
      subtitle="Your AI desk officer · grounded in live data"
      variant="neutral"
      bare={fullPage}
      feedStatus={loading ? undefined : hydrated ? "live" : undefined}
      className={clsx(
        // Largo accent = cyan (#22d3ee). Override DeskPanel's grey `neutral`
        // border + drop the hardcoded-purple `glow`/`purple` variants in favour
        // of a brand-correct cyan border + glow.
        "flex flex-col largo-chat-shell !border-cyan-400/30 shadow-[0_0_30px_rgba(34,211,238,0.15),inset_0_0_40px_rgba(34,211,238,0.06)]",
        fullPage ? "largo-terminal-fullpage" : "min-h-[560px]",
        loading && "largo-chat-shell-processing"
      )}
    >
      <div className="flex-1 flex flex-col min-h-0 largo-chat-container">
        <div
          className={clsx(
            "flex-1 overflow-y-auto flex flex-col gap-4 mb-4 pr-2 largo-messages-scroll",
            fullPage ? "largo-messages-fullpage" : "max-h-[420px]"
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
                  {msg.role === "user" ? "◆ YOU" : "◆ LARGO"}
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
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          <AnimatePresence mode="wait">
            {loading && !streaming && (
              <div className="largo-msg-bubble largo-thinking-wrap">
                <LargoThinkingState key="largo-thinking" />
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
              "DEPLOY"
            )}
          </Button>
        </form>
      </div>
    </DeskPanel>
  );
}

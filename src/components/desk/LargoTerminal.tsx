"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import { queryLargo, fetchLargoSession } from "@/lib/api";
import { DeskPanel } from "./DeskPanel";
import { SpxLiveStrip } from "./SpxLiveStrip";
import { LargoThinkingState } from "./LargoThinkingState";
import { LargoMessageBody } from "./LargoMessageBody";

type Message = { id: string; role: "user" | "assistant"; content: string; tools?: string[] };

const LARGO_SESSION_KEY = "largo-terminal-session";

const WELCOME: Message = {
  id: "welcome",
  role: "assistant",
  content:
    "Largo online — neural link established. Ask anything specific: SPX levels, a ticker, flow, news. I'll pull live data and remember our thread.",
};

export function LargoTerminal({ fullPage = false }: { fullPage?: boolean }) {
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
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

    try {
      const res = await queryLargo(q, sessionId.current);
      sessionId.current = res.session_id;
      sessionStorage.setItem(LARGO_SESSION_KEY, sessionId.current);
      setMessages((m) => [
        ...m,
        {
          id: `a-${++msgId.current}`,
          role: "assistant",
          content: res.answer,
          tools: res.tools_used,
        },
      ]);
    } catch (err) {
      const raw = err instanceof Error ? err.message : "";
      let content =
        "Link interrupted — couldn't pull live data. Hit me again with your question.";
      if (raw.includes("401")) content = "Sign in with Premium to access Largo neural link.";
      else if (raw.includes("403")) content = "Largo requires a Premium subscription.";
      else if (raw.includes("503")) content = "Largo offline — ANTHROPIC_API_KEY not set on server.";
      setMessages((m) => [...m, { id: `e-${++msgId.current}`, role: "assistant", content }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <DeskPanel
      title="Largo Terminal"
      subtitle="Neural desk · live market intelligence"
      variant="purple"
      glow
      bare={fullPage}
      feedStatus={loading ? undefined : hydrated ? "live" : undefined}
      className={clsx(
        "flex flex-col largo-chat-shell",
        fullPage ? "largo-terminal-fullpage" : "min-h-[560px]",
        loading && "largo-chat-shell-processing"
      )}
    >
      <div className="largo-terminal-top">
        <SpxLiveStrip className="flex-1 min-w-0" />
        <div className={clsx("largo-link-badge", loading && "largo-link-badge-active")}>
          <span className="largo-link-badge-dot" />
          {loading ? "PROCESSING" : "ONLINE"}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0 largo-chat-container">
        <div
          className={clsx(
            "flex-1 overflow-y-auto space-y-4 mb-4 pr-2 largo-messages-scroll",
            fullPage ? "largo-messages-fullpage" : "max-h-[420px]"
          )}
        >
          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 14, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className={clsx(
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
                      "text-grey-100 leading-relaxed whitespace-pre-wrap",
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
            {loading && <LargoThinkingState key="largo-thinking" />}
          </AnimatePresence>
          <div ref={bottomRef} />
        </div>

        <form
          onSubmit={submit}
          className={clsx("desk-largo-input-row largo-input-form", fullPage && "largo-input-form-fullpage")}
        >
          <div className="relative flex-1">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={loading ? "Largo is working…" : "Drop your question — SPX, flow, any ticker…"}
              className={clsx(
                "desk-largo-input w-full",
                loading && "largo-input-busy",
                fullPage && "largo-input-fullpage"
              )}
              disabled={loading || !hydrated}
            />
            {!input && !loading && hydrated && (
              <span className="largo-input-cursor" aria-hidden>
                |
              </span>
            )}
          </div>
          <button
            type="submit"
            disabled={loading || !hydrated || !input.trim()}
            className={clsx("desk-largo-send", loading && "desk-largo-send-busy")}
          >
            {loading ? (
              <span className="largo-send-pulse">
                <span className="largo-send-dot" />
                SYNC
              </span>
            ) : (
              "EXECUTE"
            )}
          </button>
        </form>
      </div>
    </DeskPanel>
  );
}

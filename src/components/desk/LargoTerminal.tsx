"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { queryLargo } from "@/lib/api";
import { DeskPanel } from "./DeskPanel";

type Message = { id: string; role: "user" | "assistant"; content: string };

function ThinkingDots() {
  return (
    <div className="largo-thinking-dots" aria-label="Largo thinking">
      {[0, 0.18, 0.36].map((delay) => (
        <span
          key={delay}
          className="largo-thinking-dot"
          style={{ animationDelay: `${delay}s` }}
        />
      ))}
    </div>
  );
}

export function LargoTerminal() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Largo online. Ask about tickers, flows, macro, or tonight's setups — powered by your UW + Polygon + Finnhub stack.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const sessionId = useRef(`web-${Date.now()}`);
  const bottomRef = useRef<HTMLDivElement>(null);
  const msgId = useRef(1);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q || loading) return;

    setInput("");
    const userId = `u-${++msgId.current}`;
    setMessages((m) => [...m, { id: userId, role: "user", content: q }]);
    setLoading(true);

    try {
      const res = await queryLargo(q, sessionId.current);
      sessionId.current = res.session_id;
      setMessages((m) => [...m, { id: `a-${++msgId.current}`, role: "assistant", content: res.answer }]);
    } catch {
      setMessages((m) => [
        ...m,
        {
          id: `e-${++msgId.current}`,
          role: "assistant",
          content: "Engine unreachable. Deploy BlackOut-Uw-Alerts and set NEXT_PUBLIC_API_BASE.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <DeskPanel title="Largo Terminal" subtitle="AI desk · Claude + live data" variant="purple" glow className="min-h-[560px] flex flex-col largo-chat-shell">
      <div className="flex-1 flex flex-col min-h-0 largo-chat-container">
        <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2 max-h-[420px]">
          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className={msg.role === "user" ? "desk-largo-user" : "desk-largo-assistant"}
              >
                <p className="text-[9px] font-mono uppercase tracking-widest text-grey-500 mb-1">
                  {msg.role === "user" ? "You" : "Largo"}
                </p>
                <p className="text-sm text-grey-100 leading-relaxed whitespace-pre-wrap">{msg.content}</p>
              </motion.div>
            ))}
          </AnimatePresence>
          {loading && <ThinkingDots />}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={submit} className="desk-largo-input-row">
          <div className="relative flex-1">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask Largo anything…"
              className="desk-largo-input w-full"
              disabled={loading}
            />
            {!input && !loading && (
              <span className="largo-input-cursor" aria-hidden>
                |
              </span>
            )}
          </div>
          <button type="submit" disabled={loading || !input.trim()} className="desk-largo-send">
            Send
          </button>
        </form>
      </div>
    </DeskPanel>
  );
}

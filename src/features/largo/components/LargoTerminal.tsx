"use client";

import { clsx } from "clsx";
import { motion, AnimatePresence } from "framer-motion";
import { Square } from "lucide-react";
import { useIosKeyboardInset } from "@/hooks/useIosKeyboardInset";
import {
  LARGO_SUGGESTIONS,
  largoToolLabel,
  useLargoChat,
} from "@/hooks/useLargoChat";
import { Panel, PanelHeader, FreshnessChip, Button } from "@/components/ui";
import { LargoThinkingState } from "./LargoThinkingState";
import { LargoMessageBody } from "./LargoMessageBody";
import { LargoAnswerMessage } from "./LargoAnswerMessage";
import { LargoTerminalToolbar } from "./LargoTerminalToolbar";
import { LargoEmptyState } from "./LargoEmptyState";

const INPUT_PLACEHOLDER = "Ask the desk — SPX levels, a ticker, flow, news…";
const INPUT_PLACEHOLDER_BUSY = "Pulling live data…";

export function LargoTerminal({
  fullPage = false,
  nativeShell = false,
  onToggleFullscreen,
  isFullscreen = false,
  fullscreenSupported = false,
}: {
  fullPage?: boolean;
  /** Passed from LargoPageShell when iOS native chrome is active. */
  nativeShell?: boolean;
  /** Full-screen controls, owned by LargoPageShell (which holds the shell ref). */
  onToggleFullscreen?: () => void;
  isFullscreen?: boolean;
  fullscreenSupported?: boolean;
}) {
  const {
    messages,
    input,
    setInput,
    loading,
    streaming,
    hydrated,
    followups,
    activeTools,
    statusMessage,
    awaitingFirstToken,
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
  } = useLargoChat();

  useIosKeyboardInset(nativeShell);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    void runQuery(input);
  }

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
        nativeShell && fullPage && "largo-terminal-native",
        loading && "largo-chat-shell-processing"
      )}
      bodyClassName="flex flex-1 flex-col min-h-0 !p-0 desk-panel-body-bare"
    >
      <div className="flex-1 flex flex-col min-h-0 largo-chat-container">
        {fullPage && (
          <LargoTerminalToolbar
            conversations={conversations}
            activeSessionId={activeSessionId}
            onSwitch={(id) => void switchConversation(id)}
            onNew={newConversation}
            onRegenerate={regenerate}
            canRegenerate={canRegenerate}
            loading={loading}
            onToggleFullscreen={onToggleFullscreen ?? (() => {})}
            isFullscreen={isFullscreen}
            fullscreenSupported={fullscreenSupported}
          />
        )}
        <div
          role="log"
          aria-live="polite"
          aria-atomic="false"
          className={clsx(
            "flex-1 overflow-y-auto flex flex-col gap-4 mb-4 pr-2 largo-messages-scroll",
            fullPage ? "largo-messages-fullpage" : "max-h-[420px]",
            isFresh && !loading && "justify-center"
          )}
        >
          <AnimatePresence initial={false}>
            {messages.map((msg, idx) => (
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
                  msg.id === "welcome" ? (
                    // Welcome intro stays plain — nothing to structure.
                    <LargoMessageBody
                      content={msg.content}
                      className={fullPage ? "text-sm md:text-[15px] lg:text-base" : "text-sm"}
                    />
                  ) : (
                    // Rich structured rendering; streams as markdown then swaps to the
                    // structured card once the full answer is in (idx === last & loading).
                    <LargoAnswerMessage
                      content={msg.content}
                      envelope={msg.envelope}
                      streaming={
                        loading && idx === messages.length - 1 && msg.role === "assistant"
                      }
                      className={fullPage ? "text-sm md:text-[15px] lg:text-base" : "text-sm"}
                    />
                  )
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
                        {largoToolLabel(t)}
                      </span>
                    ))}
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {isFresh && !loading && hydrated && fullPage && (
            <LargoEmptyState onPick={(prompt) => void runQuery(prompt)} />
          )}

          {isFresh && !loading && hydrated && !fullPage && (
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
            {loading && (awaitingFirstToken || !streaming) && (
              <div className="largo-msg-bubble largo-thinking-wrap">
                <LargoThinkingState
                  key="largo-thinking"
                  tools={activeTools}
                  statusMessage={statusMessage}
                />
              </div>
            )}
          </AnimatePresence>
          <div ref={bottomRef} />
        </div>

        <form
          onSubmit={submit}
          className={clsx(
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
                "desk-largo-input w-full !border-cyan-400/25",
                loading && "largo-input-busy",
                !input && !loading && hydrated && "largo-input-idle",
                fullPage && "largo-input-fullpage"
              )}
              disabled={loading || !hydrated}
            />
            {!input && !loading && hydrated && !nativeShell && (
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
          {loading && (
            <button
              type="button"
              onClick={cancel}
              aria-label="Stop generating"
              className="largo-stop-btn"
            >
              <Square size={13} aria-hidden fill="currentColor" />
              <span className="largo-stop-btn-label">Stop</span>
            </button>
          )}
          <Button
            type="submit"
            variant="ghost"
            size="md"
            disabled={loading || !hydrated || !input.trim()}
            className={clsx(
              "rounded-none font-syne text-xs uppercase tracking-[0.2em]",
              "!bg-cyan-400/12 !border-cyan-400/40 !text-cyan-300",
              "hover:!bg-cyan-400/20 hover:!border-cyan-400/60",
              "shadow-[0_0_20px_-6px_rgba(34,211,238,0.5)]",
              nativeShell && "!rounded-xl !min-h-[2.75rem] !px-4 largo-send-btn-native"
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

"use client";

import { clsx } from "clsx";
import { LargoMessageBody } from "@/features/largo/components/LargoMessageBody";
import { LargoAnswerMessage } from "@/features/largo/components/LargoAnswerMessage";
import { LargoThinkingState } from "@/features/largo/components/LargoThinkingState";
import { resetIosViewport } from "@/hooks/useIosKeyboardInset";
import { LARGO_SUGGESTIONS, largoToolLabel, useLargoChat } from "@/hooks/useLargoChat";

const PLACEHOLDER = "Ask Largo — SPX, flow, news…";
const PLACEHOLDER_BUSY = "Pulling live data…";

/** Mobile-only Largo desk — no web Panel, no responsive breakpoints. */
export function LargoNativeTerminal() {
  const {
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
    cancel,
    newConversation,
    isFresh,
  } = useLargoChat();

  return (
    <div className="largo-native-desk">
      {!isFresh && (
        <div className="largo-native-topbar">
          <button
            type="button"
            className="largo-native-newchat"
            onClick={newConversation}
            disabled={loading}
          >
            + New chat
          </button>
        </div>
      )}
      <div className="largo-native-messages" role="log" aria-live="polite" aria-atomic="false">
        {messages.map((msg, idx) => (
          <div
            key={msg.id}
            className={clsx(
              "largo-native-bubble",
              msg.role === "user" ? "largo-native-bubble-user" : "largo-native-bubble-assistant",
              msg.id === "welcome" && "largo-native-bubble-welcome"
            )}
          >
            <p className="largo-native-bubble-label">{msg.role === "user" ? "You" : "Largo"}</p>
            {msg.role === "assistant" ? (
              msg.id === "welcome" ? (
                <LargoMessageBody content={msg.content} className="largo-native-body" />
              ) : (
                <LargoAnswerMessage
                  content={msg.content}
                  streaming={
                    loading && idx === messages.length - 1 && msg.role === "assistant"
                  }
                  className="largo-native-body"
                  onFollowup={(q) => void runQuery(q)}
                />
              )
            ) : (
              <p className="largo-native-body whitespace-pre-wrap">{msg.content}</p>
            )}
            {msg.role === "assistant" && msg.tools && msg.tools.length > 0 && (
              <div className="largo-native-tools">
                {msg.tools.map((t) => (
                  <span key={t} className="largo-native-tool-chip">
                    {largoToolLabel(t)}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}

        {isFresh && !loading && hydrated && (
          <div className="largo-native-suggestions">
            <p className="largo-native-suggestions-label">Try asking</p>
            {LARGO_SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                className="largo-native-suggestion"
                onClick={() => void runQuery(s)}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {!isFresh && !loading && followups.length > 0 && (
          <div className="largo-native-suggestions">
            <p className="largo-native-suggestions-label">Ask next</p>
            {followups.map((s) => (
              <button
                key={s}
                type="button"
                className="largo-native-suggestion"
                onClick={() => void runQuery(s)}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {loading && !streaming && (
          <div className="largo-native-bubble largo-native-bubble-assistant">
            <LargoThinkingState tools={activeTools} />
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <form
        className="largo-native-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void runQuery(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" })}
          onBlur={() => window.setTimeout(() => resetIosViewport(), 160)}
          placeholder={loading ? PLACEHOLDER_BUSY : PLACEHOLDER}
          aria-label="Ask Largo"
          className="largo-native-input"
          disabled={loading || !hydrated}
          enterKeyHint="send"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {loading ? (
          <button
            type="button"
            className="largo-native-send largo-native-stop"
            onClick={cancel}
            aria-label="Stop generating"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            className="largo-native-send"
            disabled={!hydrated || !input.trim()}
          >
            Send
          </button>
        )}
      </form>
    </div>
  );
}

"use client";

import { clsx } from "clsx";
import { useEffect, useRef, useState } from "react";
import { History, Plus, RefreshCw, Maximize2, Minimize2, X } from "lucide-react";
import type { LargoConversation } from "@/features/largo/conversation-history";

/**
 * Command bar for the full-page Largo terminal (BIE Master Spec §6 — persistent,
 * commanding surface with conversation history, regenerate, and full-screen).
 * Purely presentational: every action is a prop wired to useLargoChat / useFullscreen.
 */
export function LargoTerminalToolbar({
  conversations,
  activeSessionId,
  onSwitch,
  onNew,
  onRegenerate,
  canRegenerate,
  loading,
  onToggleFullscreen,
  isFullscreen,
  fullscreenSupported,
}: {
  conversations: LargoConversation[];
  activeSessionId: string;
  onSwitch: (id: string) => void;
  onNew: () => void;
  onRegenerate: () => void;
  canRegenerate: boolean;
  loading: boolean;
  onToggleFullscreen: () => void;
  isFullscreen: boolean;
  fullscreenSupported: boolean;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyWrapRef = useRef<HTMLDivElement>(null);

  // Close the history popover on outside-click or Escape.
  useEffect(() => {
    if (!historyOpen) return;
    function onDown(e: MouseEvent) {
      if (historyWrapRef.current && !historyWrapRef.current.contains(e.target as Node)) {
        setHistoryOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setHistoryOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [historyOpen]);

  return (
    <div className="largo-toolbar">
      <div className="largo-toolbar-brand">
        <span className="largo-toolbar-dot" aria-hidden />
        <span className="largo-toolbar-name">Largo Terminal</span>
        <span className="largo-toolbar-sub">Grounded in live platform data</span>
      </div>

      <div className="largo-toolbar-actions">
        <div className="largo-history-wrap" ref={historyWrapRef}>
          <button
            type="button"
            className={clsx("largo-toolbar-btn", historyOpen && "is-active")}
            aria-haspopup="menu"
            aria-expanded={historyOpen}
            aria-label="Conversation history"
            onClick={() => setHistoryOpen((v) => !v)}
          >
            <History size={15} aria-hidden />
            <span className="largo-toolbar-btn-label">History</span>
          </button>

          {historyOpen && (
            <div className="largo-history-menu" role="menu" aria-label="Recent conversations">
              <div className="largo-history-head">
                <span>Recent conversations</span>
                <button
                  type="button"
                  className="largo-history-close"
                  aria-label="Close history"
                  onClick={() => setHistoryOpen(false)}
                >
                  <X size={13} aria-hidden />
                </button>
              </div>
              {conversations.length === 0 ? (
                <p className="largo-history-empty">
                  No saved conversations yet. Ask a question to start one.
                </p>
              ) : (
                <ul className="largo-history-list">
                  {conversations.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        role="menuitem"
                        disabled={loading}
                        className={clsx(
                          "largo-history-item",
                          c.id === activeSessionId && "is-active"
                        )}
                        onClick={() => {
                          onSwitch(c.id);
                          setHistoryOpen(false);
                        }}
                      >
                        <span className="largo-history-item-title">{c.title}</span>
                        <span className="largo-history-item-time">
                          {formatRelative(c.updatedAt)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          className="largo-toolbar-btn"
          aria-label="New conversation"
          disabled={loading}
          onClick={onNew}
        >
          <Plus size={15} aria-hidden />
          <span className="largo-toolbar-btn-label">New</span>
        </button>

        <button
          type="button"
          className="largo-toolbar-btn"
          aria-label="Regenerate last answer"
          disabled={loading || !canRegenerate}
          onClick={onRegenerate}
        >
          <RefreshCw size={15} aria-hidden />
          <span className="largo-toolbar-btn-label">Regenerate</span>
        </button>

        {fullscreenSupported && (
          <button
            type="button"
            className="largo-toolbar-btn largo-toolbar-btn-icon"
            aria-label={isFullscreen ? "Exit full screen" : "Enter full screen"}
            aria-pressed={isFullscreen}
            onClick={onToggleFullscreen}
          >
            {isFullscreen ? (
              <Minimize2 size={15} aria-hidden />
            ) : (
              <Maximize2 size={15} aria-hidden />
            )}
          </button>
        )}
      </div>
    </div>
  );
}

/** Compact "5m / 2h / 3d ago" label for the history list. */
function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

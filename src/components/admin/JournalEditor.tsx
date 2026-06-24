"use client";

// Additive trade-journal editor rendered inside an expanded Outcomes row.
// Dual-mode persistence mirroring spx-play-outcomes.ts: it POSTs to the
// per-user journal API; if that fails (no DB / offline) it falls back to
// localStorage so the user never loses a note. Annotation-only — no money-path.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  journalStorageKey,
  parseJournalMap,
  serializeJournalMap,
  upsertEntry,
  getEntry,
  parseTags,
  type JournalEntry,
  type JournalMap,
} from "@/lib/journal/journal-core";

type Props = {
  openPlayId: number;
  /** Clerk user id for localStorage namespacing; pass "anon" when unknown. */
  userId: string;
  /** Server-provided entry (DB path) to seed the editor, if any. */
  initial?: JournalEntry | null;
};

function readLocal(userId: string): JournalMap {
  if (typeof window === "undefined") return {};
  return parseJournalMap(window.localStorage.getItem(journalStorageKey(userId)));
}

function writeLocal(userId: string, map: JournalMap) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(journalStorageKey(userId), serializeJournalMap(map));
}

export function JournalEditor({ openPlayId, userId, initial }: Props) {
  const seeded = useMemo(() => {
    if (initial) return initial;
    return getEntry(readLocal(userId), openPlayId);
  }, [initial, userId, openPlayId]);

  const [note, setNote] = useState(seeded?.note ?? "");
  const [tags, setTags] = useState((seeded?.tags ?? []).join(", "));
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [savedAt, setSavedAt] = useState<string | null>(seeded?.updated_at ?? null);
  const dirty = useRef(false);

  useEffect(() => {
    setNote(seeded?.note ?? "");
    setTags((seeded?.tags ?? []).join(", "));
    setSavedAt(seeded?.updated_at ?? null);
    setStatus("idle");
    dirty.current = false;
  }, [seeded]);

  async function save() {
    setStatus("saving");
    const now = new Date().toISOString();
    // Optimistic localStorage write so a note survives even if the API call fails.
    writeLocal(userId, upsertEntry(readLocal(userId), openPlayId, note, tags, now));
    try {
      const res = await fetch("/api/market/spx/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ open_play_id: openPlayId, note, tags: parseTags(tags) }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setStatus("saved");
      setSavedAt(now);
      dirty.current = false;
    } catch {
      // Saved locally already; surface a soft error but don't lose the note.
      setStatus("error");
      setSavedAt(now);
    }
  }

  return (
    <div className="admin-journal">
      <div className="admin-journal-head">
        <span className="admin-journal-title">Journal</span>
        {savedAt && (
          <span className="admin-journal-saved">
            saved {new Date(savedAt).toLocaleString()}
          </span>
        )}
      </div>
      <textarea
        className="admin-filter-input admin-journal-note"
        value={note}
        placeholder="Why did this play work / fail? Lesson for next time…"
        aria-label="Why did this play work / fail? Lesson for next time"
        rows={3}
        onChange={(e) => {
          setNote(e.target.value);
          dirty.current = true;
          if (status !== "idle") setStatus("idle");
        }}
      />
      <input
        type="text"
        className="admin-filter-input admin-journal-tags"
        value={tags}
        placeholder="tags (comma separated): chased, good-entry…"
        aria-label="tags (comma separated): chased, good-entry"
        onChange={(e) => {
          setTags(e.target.value);
          dirty.current = true;
          if (status !== "idle") setStatus("idle");
        }}
      />
      <div className="admin-journal-actions">
        <button
          type="button"
          className="admin-deck-nav-tab"
          disabled={status === "saving"}
          onClick={(e) => {
            e.stopPropagation();
            void save();
          }}
        >
          {status === "saving" ? "Saving…" : "Save note"}
        </button>
        {status === "saved" && <span className="admin-td-bull">Saved</span>}
        {status === "error" && (
          <span className="admin-td-bull">Saved locally (sync retry on next save)</span>
        )}
      </div>
    </div>
  );
}

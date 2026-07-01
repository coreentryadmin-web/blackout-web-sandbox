// DB-backed persistence for the trade journal, mirroring the dual-mode pattern in
// spx-play-outcomes.ts: localStorage is the client default; when dbConfigured()
// the API routes use this module. Annotation-only — isolated user_journal table,
// no FK into and no mutation of any money-path table.
import { dbConfigured } from "@/lib/db";
import {
  sanitizeNote,
  parseTags,
  isEmptyEntry,
  type JournalEntry,
} from "@/lib/journal/journal-core";

/** Fetch all journal entries for a user, keyed by open_play_id (string). */
export async function fetchUserJournal(userId: string): Promise<Record<string, JournalEntry>> {
  if (!dbConfigured()) return {};
  const { fetchUserJournalRows } = await import("@/lib/db");
  const rows = await fetchUserJournalRows(userId);
  const out: Record<string, JournalEntry> = {};
  for (const r of rows) {
    out[String(r.open_play_id)] = {
      open_play_id: r.open_play_id,
      note: r.note,
      tags: r.tags,
      updated_at: r.updated_at,
    };
  }
  return out;
}

/**
 * Upsert (or delete-on-empty) a single journal entry for a user.
 * Returns the saved entry, or null when the edit cleared it.
 */
export async function saveUserJournalEntry(
  userId: string,
  openPlayId: number,
  noteRaw: string,
  tagsRaw: string | string[]
): Promise<JournalEntry | null> {
  const note = sanitizeNote(noteRaw);
  const tags = Array.isArray(tagsRaw) ? parseTags(tagsRaw.join(",")) : parseTags(tagsRaw);
  if (!dbConfigured()) {
    // No DB: the client owns localStorage; return the normalized shape so the
    // caller can echo it. (Routes still require a DB in production via the guard.)
    if (isEmptyEntry(note, tags)) return null;
    return { open_play_id: openPlayId, note, tags, updated_at: new Date().toISOString() };
  }
  if (isEmptyEntry(note, tags)) {
    const { deleteUserJournalEntry } = await import("@/lib/db");
    await deleteUserJournalEntry(userId, openPlayId);
    return null;
  }
  const { upsertUserJournalEntry } = await import("@/lib/db");
  return upsertUserJournalEntry(userId, openPlayId, note, tags);
}

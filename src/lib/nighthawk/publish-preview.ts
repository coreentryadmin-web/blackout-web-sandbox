import {
  fetchLatestNighthawkEdition,
  fetchNighthawkEditionByDate,
  fetchNighthawkJob,
} from "@/lib/db";
import type { PlaybookPlay } from "./types";

export type NighthawkPublishPreviewPlay = {
  ticker: string;
  score: number;
  conviction: string;
  direction: string;
  unvetted_fallback: boolean;
};

export type NighthawkPublishPreview = {
  edition_for: string;
  published_at: string | null;
  build_duration_ms: number | null;
  job: {
    status: string;
    stage: string | null;
    error: string | null;
  } | null;
  recap_headline: string | null;
  play_count: number;
  plays: NighthawkPublishPreviewPlay[];
  critic_notes: string[];
  unvetted_fallback: boolean;
  error: string | null;
};

function editionUnvettedFallback(meta: Record<string, unknown>): boolean {
  if (meta.unvetted_fallback === true) return true;
  const notes = meta.critic_notes;
  if (!Array.isArray(notes)) return false;
  return notes.some((n) => String(n).toLowerCase().includes("unvetted fallback"));
}

function parseCriticNotes(meta: Record<string, unknown>): string[] {
  const notes = meta.critic_notes;
  if (!Array.isArray(notes)) return [];
  return notes.map((n) => String(n));
}

export async function getNighthawkPublishPreview(
  editionFor?: string
): Promise<NighthawkPublishPreview | null> {
  const edition = editionFor
    ? await fetchNighthawkEditionByDate(editionFor)
    : await fetchLatestNighthawkEdition();

  if (!edition) return null;

  const job = await fetchNighthawkJob(edition.edition_for);
  const meta = edition.meta ?? {};
  const unvettedFallback = editionUnvettedFallback(meta);
  const criticNotes = parseCriticNotes(meta);
  const plays = (Array.isArray(edition.plays) ? edition.plays : []) as PlaybookPlay[];

  const jobPublishedAt = job?.published_at ?? edition.published_at;
  let buildDurationMs: number | null = null;
  if (job?.started_at && jobPublishedAt) {
    buildDurationMs = new Date(jobPublishedAt).getTime() - new Date(job.started_at).getTime();
  }

  return {
    edition_for: edition.edition_for,
    published_at: edition.published_at,
    build_duration_ms: buildDurationMs,
    job: job
      ? {
          status: job.status,
          stage: job.current_stage,
          error: job.error,
        }
      : null,
    recap_headline: edition.recap_headline,
    play_count: plays.length,
    plays: plays.map((play) => ({
      ticker: String(play.ticker ?? "").toUpperCase(),
      score: Number(play.score ?? 0),
      conviction: String(play.conviction ?? ""),
      direction: String(play.direction ?? ""),
      unvetted_fallback: unvettedFallback,
    })),
    critic_notes: criticNotes,
    unvetted_fallback: unvettedFallback,
    error: job?.error ?? null,
  };
}

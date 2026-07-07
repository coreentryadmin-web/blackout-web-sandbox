import { fetchLatestNighthawkEdition, fetchNighthawkEditionByDate } from "@/lib/db";
import { rowToNightHawkEdition } from "@/features/nighthawk/lib/edition-builder";
import type { NightHawkEdition } from "@/features/nighthawk/lib/types";
import type { NightHawkEditionSummary } from "./types";

export function summarizeNightHawkEdition(edition: NightHawkEdition | null): NightHawkEditionSummary {
  if (!edition?.available) {
    return {
      available: false,
      edition_for: edition?.edition_for ?? null,
      published_at: edition?.published_at ?? null,
      recap_headline: edition?.recap_headline ?? null,
      play_count: 0,
      top_tickers: [],
    };
  }

  return {
    available: true,
    edition_for: edition.edition_for,
    published_at: edition.published_at,
    recap_headline: edition.recap_headline,
    play_count: edition.plays.length,
    top_tickers: edition.plays.slice(0, 5).map((p) => p.ticker),
  };
}

export async function getLatestNightHawkEdition(): Promise<NightHawkEdition | null> {
  const row = await fetchLatestNighthawkEdition();
  if (!row) return null;
  return rowToNightHawkEdition(row);
}

export async function getNightHawkEditionForDate(date: string): Promise<NightHawkEdition | null> {
  const row = await fetchNighthawkEditionByDate(date);
  if (!row) return null;
  return rowToNightHawkEdition(row);
}

export async function getLatestNightHawkSummary(): Promise<NightHawkEditionSummary> {
  const edition = await getLatestNightHawkEdition();
  return summarizeNightHawkEdition(edition);
}

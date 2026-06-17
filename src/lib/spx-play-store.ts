import {
  dbConfigured,
  ensureSchema,
  getMeta,
  setMeta,
} from "@/lib/db";
import type { SpxPlayDirection } from "@/lib/spx-signals";
import type { PlayCloseSnapshot } from "@/lib/spx-play-outcomes";

export type OpenPlayRow = {
  id: number;
  session_date: string;
  direction: SpxPlayDirection;
  entry_price: number;
  stop: number | null;
  target: number | null;
  grade: string;
  headline: string;
  trim_done: boolean;
  mfe_pts: number;
  mae_pts: number;
  opened_at: string;
  status: "open" | "closed";
  option_strike?: number | null;
  option_type?: string | null;
  option_label?: string | null;
  option_premium?: string | null;
};

export type PlaySessionMeta = {
  last_buy_at: number | null;
  last_sell_at: number | null;
  last_sell_was_loss: boolean;
  last_direction: SpxPlayDirection | null;
};

const SESSION_META_KEY = "spx_play_session_meta";
const MEMORY_OPEN: { row: OpenPlayRow | null } = { row: null };
const MEMORY_SESSION: PlaySessionMeta = {
  last_buy_at: null,
  last_sell_at: null,
  last_sell_was_loss: false,
  last_direction: null,
};

function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(new Date());
}

export async function loadPlaySessionMeta(): Promise<PlaySessionMeta> {
  if (!dbConfigured()) return { ...MEMORY_SESSION };
  const raw = await getMeta(SESSION_META_KEY);
  if (!raw) {
    return { last_buy_at: null, last_sell_at: null, last_sell_was_loss: false, last_direction: null };
  }
  try {
    const p = JSON.parse(raw) as PlaySessionMeta;
    return {
      last_buy_at: p.last_buy_at ?? null,
      last_sell_at: p.last_sell_at ?? null,
      last_sell_was_loss: Boolean(p.last_sell_was_loss),
      last_direction: p.last_direction ?? null,
    };
  } catch {
    return { last_buy_at: null, last_sell_at: null, last_sell_was_loss: false, last_direction: null };
  }
}

export async function savePlaySessionMeta(meta: PlaySessionMeta): Promise<void> {
  Object.assign(MEMORY_SESSION, meta);
  if (!dbConfigured()) return;
  await setMeta(SESSION_META_KEY, JSON.stringify(meta));
}

export async function loadOpenPlay(): Promise<OpenPlayRow | null> {
  if (!dbConfigured()) return MEMORY_OPEN.row;

  await ensureSchema();
  const { fetchOpenSpxPlay } = await import("@/lib/db");
  const row = await fetchOpenSpxPlay(todayEt());
  MEMORY_OPEN.row = row;
  return row;
}

export async function openPlay(row: Omit<OpenPlayRow, "id" | "status" | "trim_done" | "mfe_pts" | "mae_pts">): Promise<OpenPlayRow> {
  const full: OpenPlayRow = {
    ...row,
    id: Date.now(),
    trim_done: false,
    mfe_pts: 0,
    mae_pts: 0,
    status: "open",
  };

  MEMORY_OPEN.row = full;
  if (!dbConfigured()) return full;

  const { insertOpenSpxPlay } = await import("@/lib/db");
  const id = await insertOpenSpxPlay(full);
  return { ...full, id };
}

export async function updateOpenPlay(
  id: number,
  patch: Partial<Pick<OpenPlayRow, "stop" | "target" | "trim_done" | "mfe_pts" | "mae_pts">>
): Promise<void> {
  if (MEMORY_OPEN.row?.id === id) {
    MEMORY_OPEN.row = { ...MEMORY_OPEN.row, ...patch };
  }
  if (!dbConfigured()) return;
  const { updateOpenSpxPlayRow } = await import("@/lib/db");
  await updateOpenSpxPlayRow(id, patch);
}

export async function closeOpenPlay(
  id: number,
  outcome: {
    was_loss: boolean;
    direction: SpxPlayDirection;
    close?: PlayCloseSnapshot;
  }
): Promise<void> {
  if (outcome.close) {
    const { recordPlayClose } = await import("@/lib/spx-play-outcomes");
    await recordPlayClose(id, outcome.close);
  }
  MEMORY_OPEN.row = null;
  if (dbConfigured()) {
    const { closeOpenSpxPlayRow } = await import("@/lib/db");
    await closeOpenSpxPlayRow(id);
  }
  const meta = await loadPlaySessionMeta();
  await savePlaySessionMeta({
    last_buy_at: meta.last_buy_at,
    last_sell_at: Date.now(),
    last_sell_was_loss: outcome.was_loss,
    last_direction: outcome.direction,
  });
}

export async function recordBuy(direction: SpxPlayDirection): Promise<void> {
  const meta = await loadPlaySessionMeta();
  await savePlaySessionMeta({
    ...meta,
    last_buy_at: Date.now(),
    last_direction: direction,
  });
}

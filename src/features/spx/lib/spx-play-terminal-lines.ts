import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { SpxPlayPayload } from "@/features/spx/lib/spx-play-engine";
import type { LottoPlayPayload } from "@/features/spx/lib/spx-lotto-engine";
import type { PowerHourPlayPayload } from "@/features/spx/lib/spx-power-hour-engine";
import type { PlayConfirmationLayer } from "@/features/spx/hooks/useStablePlayConfirmations";
import type { TradeAlertPlay, TradeStageId } from "@/features/spx/lib/spx-trade-alert-plays";
import type { PlaybookShadowPanel } from "@/features/spx/lib/playbook-shadow-panel";
import { PLAYBOOK_REGISTRY, type PlaybookId } from "@/features/spx/lib/playbook-registry";
import { playbookLiveGateEnabled } from "@/features/spx/lib/spx-play-config";
import { fmtPrice } from "@/lib/api";

export type PlayTerminalIcon =
  | "prompt"
  | "section"
  | "ok"
  | "no"
  | "vwap"
  | "flow"
  | "gamma"
  | "level"
  | "news"
  | "trim"
  | "sell"
  | "watch"
  | "dim"
  | "pulse";

export type PlayTerminalLine = {
  icon: PlayTerminalIcon;
  tone: "bull" | "bear" | "neutral" | "accent" | "warn" | "dim";
  text: string;
  indent?: number;
};

function moneyShort(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

function section(title: string): PlayTerminalLine {
  return { icon: "section", tone: "accent", text: title };
}

function stageGlyph(stage: TradeStageId, active: boolean, done: boolean): PlayTerminalLine["icon"] {
  if (active) return stage === "sell" ? "sell" : stage === "trim" ? "trim" : "pulse";
  if (done) return "ok";
  return "dim";
}

function stageTone(active: boolean, warn?: boolean): PlayTerminalLine["tone"] {
  if (warn) return "warn";
  if (active) return "accent";
  return "dim";
}

function runwayDetail(
  stage: TradeStageId,
  active: boolean,
  selected: TradeAlertPlay,
  play: SpxPlayPayload | null,
  lotto: LottoPlayPayload | null,
  powerHour: PowerHourPlayPayload | null
): string {
  if (stage === "hold") {
    if (active) {
      if (selected.chip.kind === "structure" && play?.action === "HOLD") {
        return "Active — defending position; watch invalidation + MFE";
      }
      if (selected.chip.kind === "power" && powerHour?.phase === "HOLD") {
        return `Active — power hour hold${powerHour.pnl_pts != null ? ` (${powerHour.pnl_pts >= 0 ? "+" : ""}${powerHour.pnl_pts.toFixed(1)} pts)` : ""}`;
      }
      if (selected.chip.kind === "lotto" && lotto?.phase === "HOLD") {
        return "Active — lotto runner; trail catalyst + flow";
      }
      return "Active — let the thesis work";
    }
    return "Entry filled — manage risk to stop";
  }

  if (stage === "trim") {
    if (active) {
      if (play?.action === "TRIM") return "Active now — scale partial; protect open profits";
      if (selected.trimDone) return "Done — trim logged; remainder on trailing plan";
      return "Armed — MFE in trim zone; watch for scale signal";
    }
    if (selected.trimDone) return "Completed";
    const mfe = play?.open_play?.mfe_pts;
    return mfe && mfe > 0 ? `Next — lock gains (MFE +${mfe.toFixed(1)} pts)` : "Next — partial take when extension confirms";
  }

  if (selected.chip.column === "closed") return "Closed — session log only";
  if (active) {
    if (play?.action === "SELL" || lotto?.phase === "SELL" || powerHour?.phase === "SELL") {
      return "Active — exit in progress / logged";
    }
    if (play?.levels.invalidation) return `Plan — exit if invalidation hits (${play.levels.invalidation})`;
    return "Plan — full exit at target or hard stop";
  }
  return "Final — close remainder on stop, target, or thesis break";
}

function tradeRunwayLines(
  selected: TradeAlertPlay,
  play: SpxPlayPayload | null,
  lotto: LottoPlayPayload | null,
  powerHour: PowerHourPlayPayload | null
): PlayTerminalLine[] {
  const lines: PlayTerminalLine[] = [section("TRADE RUNWAY")];
  const active = selected.activeStage;

  for (const stage of selected.stages) {
    const isActive = stage === active && selected.chip.column !== "closed";
    const done =
      (stage === "trim" && selected.trimDone) ||
      (stage === "sell" && selected.chip.column === "closed");
    const label = stage.toUpperCase();
    const detail = runwayDetail(stage, isActive, selected, play, lotto, powerHour);
    lines.push({
      icon: stageGlyph(stage, isActive, done),
      tone: stageTone(isActive, stage === "sell" && isActive),
      text: `${label}${isActive ? " ★" : done ? " ✓" : ""} — ${detail}`,
      indent: 1,
    });
  }

  return lines;
}

function contractHeadline(
  selected: TradeAlertPlay,
  play: SpxPlayPayload | null,
  lotto: LottoPlayPayload | null,
  powerHour: PowerHourPlayPayload | null
): PlayTerminalLine | null {
  const label = selected.chip.label;
  if (!label || label === "—") return null;
  let status = "live";
  if (selected.chip.column === "watch") status = "watching";
  if (selected.chip.column === "closed") status = "closed";
  if (selected.chip.kind === "structure" && play) status = play.action.toLowerCase();
  if (selected.chip.kind === "lotto" && lotto) status = lotto.phase.toLowerCase();
  if (selected.chip.kind === "power" && powerHour) status = powerHour.phase.toLowerCase();
  return { icon: "prompt", tone: "accent", text: `${label} — ${status}`, indent: 0 };
}

function structureSectionTitle(play: SpxPlayPayload): string {
  switch (play.action) {
    case "TRIM":
      return "WHY TRIM";
    case "SELL":
      return "EXIT LOG";
    case "WATCHING":
      return "WHY WATCH";
    case "BUY":
      return "ENTRY SIGNAL";
    default:
      return "WHY HOLD";
  }
}

function structureLines(
  play: SpxPlayPayload,
  desk: SpxDeskPayload | undefined,
  confirmationLayer: PlayConfirmationLayer | null
): PlayTerminalLine[] {
  const lines: PlayTerminalLine[] = [];
  const dir = play.direction;
  const open = play.open_play;

  lines.push(section(structureSectionTitle(play)));
  lines.push({ icon: "dim", tone: "dim", text: play.headline, indent: 1 });
  if (play.thesis) {
    lines.push({ icon: "prompt", tone: "neutral", text: play.thesis, indent: 1 });
  }

  const ticket = play.option_ticket;
  if (ticket?.mid != null && ticket.mid > 0) {
    const spread =
      ticket.bid != null && ticket.ask != null
        ? ` · bid ${ticket.bid.toFixed(2)} / ask ${ticket.ask.toFixed(2)}`
        : "";
    lines.push({
      icon: "level",
      tone: "accent",
      text: `Live chain · ${ticket.contract_label} @ ${ticket.mid.toFixed(2)}${spread}`,
      indent: 1,
    });
  }

  if (desk?.vwap != null && desk.price > 0) {
    const above = desk.above_vwap ?? desk.price >= desk.vwap;
    const dist = desk.price - desk.vwap;
    lines.push({
      icon: "vwap",
      tone: above ? "bull" : "bear",
      text: above
        ? `Above VWAP ${fmtPrice(desk.vwap)} (+${Math.abs(dist).toFixed(1)} pts) — buyers in control`
        : `Below VWAP ${fmtPrice(desk.vwap)} (−${Math.abs(dist).toFixed(1)} pts) — sellers pressing`,
      indent: 1,
    });
  }

  if (desk?.flow_0dte_net != null && Math.abs(desk.flow_0dte_net) > 0) {
    const net = desk.flow_0dte_net;
    const aligned =
      dir === "long" ? net > 0 : dir === "short" ? net < 0 : net !== 0;
    lines.push({
      icon: "flow",
      tone: aligned ? "bull" : "bear",
      text: `0DTE flow net ${moneyShort(net)}${aligned ? " · aligned with bias" : " · opposes bias"}`,
      indent: 1,
    });
  }

  const flowFactor = play.factors.find((f) => /flow|helix|sweep|premium/i.test(f.label + f.detail));
  if (flowFactor) {
    lines.push({
      icon: "flow",
      tone: flowFactor.weight > 0 ? "bull" : flowFactor.weight < 0 ? "bear" : "neutral",
      text: `${flowFactor.label}: ${flowFactor.detail}`,
      indent: 1,
    });
  }

  for (const f of play.factors) {
    if (flowFactor && f === flowFactor) continue;
    if (/vwap/i.test(f.label)) continue;
    lines.push({
      icon: /gamma|gex|flip|king|wall/i.test(f.label) ? "gamma" : /level|hod|lod|pdh|pdl|or/i.test(f.label) ? "level" : "ok",
      tone: f.weight > 0 ? "bull" : f.weight < 0 ? "bear" : "neutral",
      text: `${f.label}: ${f.detail}`,
      indent: 1,
    });
  }

  const checks = confirmationLayer?.confirmations.checks ?? play.confirmations?.checks ?? [];
  if (checks.length > 0) {
    lines.push(section("CONFIRMATIONS"));
    for (const c of checks.slice(0, 8)) {
      lines.push({
        icon: c.passed ? "ok" : "no",
        tone: c.passed ? "bull" : "bear",
        text: `${c.label} — ${c.detail}`,
        indent: 1,
      });
    }
  }

  if (open) {
    lines.push(section("POSITION"));
    lines.push({
      icon: "level",
      tone: "neutral",
      text: `Entry ${fmtPrice(open.entry_price)} · stop ${fmtPrice(open.stop)} · target ${fmtPrice(open.target)}`,
      indent: 1,
    });
    if (open.mfe_pts > 0) {
      lines.push({
        icon: play.action === "TRIM" || open.trim_done ? "trim" : "pulse",
        tone: "accent",
        text: `MFE +${open.mfe_pts.toFixed(1)} pts${open.trim_done ? " · trim logged" : play.action === "TRIM" ? " · trim zone" : ""}`,
        indent: 1,
      });
    }
    if (play.levels.invalidation) {
      lines.push({
        icon: "sell",
        tone: "warn",
        text: `Invalidation: ${play.levels.invalidation}`,
        indent: 1,
      });
    }
  }

  if (play.watch?.active && play.action === "WATCHING") {
    lines.push(section("WATCH ARM"));
    if (play.watch.reason) {
      lines.push({ icon: "watch", tone: "accent", text: play.watch.reason, indent: 1 });
    }
    if (play.watch.promote_ready) {
      lines.push({ icon: "ok", tone: "bull", text: "Promote ready — confirmations stacking", indent: 1 });
    }
  }

  return lines;
}

function liveChainLine(input: {
  contractLabel: string | null;
  mid: number | null | undefined;
  bid?: number | null;
  ask?: number | null;
}): PlayTerminalLine | null {
  const { contractLabel, mid, bid, ask } = input;
  if (!contractLabel || mid == null || mid <= 0) return null;
  const spread =
    bid != null && ask != null && bid > 0 && ask > 0
      ? ` · bid ${bid.toFixed(2)} / ask ${ask.toFixed(2)}`
      : "";
  return {
    icon: "level",
    tone: "accent",
    text: `Live chain · ${contractLabel} @ ${mid.toFixed(2)}${spread}`,
    indent: 1,
  };
}

function lottoLines(lotto: LottoPlayPayload): PlayTerminalLine[] {
  const lines: PlayTerminalLine[] = [];
  const title =
    lotto.phase === "WATCH" ? "WHY WATCH" : lotto.phase === "SELL" || lotto.phase === "INVALID" ? "EXIT LOG" : "WHY HOLD";
  lines.push(section(title));
  lines.push({ icon: "dim", tone: "dim", text: lotto.headline, indent: 1 });
  if (lotto.thesis) lines.push({ icon: "prompt", tone: "neutral", text: lotto.thesis, indent: 1 });
  const chain = liveChainLine({
    contractLabel: lotto.contract_label,
    mid: lotto.option_mid,
    bid: lotto.option_bid,
    ask: lotto.option_ask,
  });
  if (chain) lines.push(chain);
  if (lotto.catalyst_summary) {
    lines.push({ icon: "news", tone: "accent", text: `Catalyst: ${lotto.catalyst_summary}`, indent: 1 });
  }
  if (lotto.flow_summary) {
    lines.push({ icon: "flow", tone: "bull", text: lotto.flow_summary, indent: 1 });
  }
  for (const c of lotto.catalysts.slice(0, 6)) {
    lines.push({ icon: "ok", tone: "neutral", text: c, indent: 1 });
  }
  if (lotto.invalidation) {
    lines.push({ icon: "sell", tone: "warn", text: `Invalidation: ${lotto.invalidation}`, indent: 1 });
  }
  lines.push({ icon: "pulse", tone: "dim", text: lotto.status_message, indent: 1 });
  return lines;
}

function powerLines(power: PowerHourPlayPayload): PlayTerminalLine[] {
  const lines: PlayTerminalLine[] = [];
  const title = power.phase === "WATCH" ? "WHY WATCH" : power.phase === "SELL" ? "EXIT LOG" : "WHY HOLD";
  lines.push(section(title));
  lines.push({ icon: "dim", tone: "dim", text: power.headline, indent: 1 });
  if (power.thesis) lines.push({ icon: "prompt", tone: "neutral", text: power.thesis, indent: 1 });
  const chain = liveChainLine({
    contractLabel: power.contract_label,
    mid: power.option_mid,
    bid: power.option_bid,
    ask: power.option_ask,
  });
  if (chain) lines.push(chain);
  if (power.pnl_pts != null) {
    lines.push({
      icon: "level",
      tone: power.pnl_pts >= 0 ? "bull" : "bear",
      text: `PnL ${power.pnl_pts >= 0 ? "+" : ""}${power.pnl_pts.toFixed(1)} pts`,
      indent: 1,
    });
  }
  lines.push({ icon: "pulse", tone: "dim", text: power.status_message, indent: 1 });
  return lines;
}

export function buildPlayTerminalLines(input: {
  selected: TradeAlertPlay | null;
  play: SpxPlayPayload | null;
  lotto: LottoPlayPayload | null;
  powerHour: PowerHourPlayPayload | null;
  desk?: SpxDeskPayload;
  confirmationLayer: PlayConfirmationLayer | null;
  closedThesis?: string;
}): PlayTerminalLine[] {
  const { selected, play, lotto, powerHour, desk, confirmationLayer, closedThesis } = input;
  if (!selected) {
    return [
      { icon: "prompt", tone: "dim", text: "awaiting play selection…" },
      { icon: "dim", tone: "dim", text: "select a play from Open, Watch, or Closed" },
    ];
  }

  const head = contractHeadline(selected, play, lotto, powerHour);
  const runway = tradeRunwayLines(selected, play, lotto, powerHour);
  const prefix = head ? [head, ...runway] : runway;

  if (selected.chip.kind === "structure" && play) {
    const lines = structureLines(play, desk, confirmationLayer);
    if (selected.chip.column === "closed" && closedThesis) {
      lines.push(section("SESSION WRAP"));
      lines.push({ icon: "dim", tone: "dim", text: closedThesis, indent: 1 });
    }
    return [...prefix, ...lines];
  }
  if (selected.chip.kind === "lotto" && lotto) return [...prefix, ...lottoLines(lotto)];
  if (selected.chip.kind === "power" && powerHour) return [...prefix, ...powerLines(powerHour)];

  return [...prefix, { icon: "dim", tone: "dim", text: "No live feed for this play." }];
}

export function playTerminalTitle(selected: TradeAlertPlay | null): string {
  if (!selected) return "blackout — play terminal";
  return `blackout — ${selected.chip.label} · ${selected.chip.column}`;
}

function registryEntry(id: PlaybookId | string | null | undefined) {
  if (!id) return null;
  return PLAYBOOK_REGISTRY.find((p) => p.id === id) ?? null;
}

function sessionWindowLabel(id: PlaybookId): string {
  const def = registryEntry(id);
  if (!def) return "";
  const { startEtHour, startEtMin, endEtHour, endEtMin } = def.sessionWindow;
  const fmt = (h: number, m: number) =>
    `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")}${h < 12 ? "a" : "p"}`;
  return `${fmt(startEtHour, startEtMin)}–${fmt(endEtHour, endEtMin)} ET`;
}

function shadowStatus(
  v: PlaybookShadowPanel["verdicts"][number]
): "FIRED" | "ARMED" | "WATCH" | "IDLE" {
  if (v.trigger_fired) return "FIRED";
  if (v.precondition_match && v.session_window_open) return "ARMED";
  if (v.session_window_open) return "WATCH";
  return "IDLE";
}

function statusHint(v: PlaybookShadowPanel["verdicts"][number]): string | null {
  const def = registryEntry(v.playbook_id);
  const status = shadowStatus(v);
  if (status === "FIRED") return v.detail || def?.trigger || null;
  if (status === "ARMED") return def ? `Trigger: ${def.trigger}` : null;
  if (status === "WATCH") {
    if (!v.precondition_match && def) return `Waiting: ${def.preconditions}`;
    return "Window open — preconditions not yet met";
  }
  if (!v.session_window_open) {
    return `Window closed (${sessionWindowLabel(v.playbook_id)})`;
  }
  return null;
}

export function buildPlaybookTerminalLines(
  panel: PlaybookShadowPanel | null | undefined,
  sessionLive: boolean
): PlayTerminalLine[] {
  const lines: PlayTerminalLine[] = [];
  const live = playbookLiveGateEnabled();
  lines.push({
    icon: "section",
    tone: "accent",
    text: sessionLive
      ? live
        ? "PLAYBOOK · LIVE (gates BUY on staging)"
        : "PLAYBOOK · SHADOW (live)"
      : live
        ? "PLAYBOOK · LIVE (session closed)"
        : "PLAYBOOK · SHADOW (session closed)",
  });

  if (!panel?.verdicts.length) {
    if (sessionLive) {
      lines.push({
        icon: "dim",
        tone: "dim",
        text: "All 14 PB rules — awaiting first poll…",
        indent: 1,
      });
    } else {
      lines.push({
        icon: "dim",
        tone: "dim",
        text: "Session closed — no live playbook state this load.",
        indent: 1,
      });
      lines.push({
        icon: "dim",
        tone: "dim",
        text: live ? "Catalog (live gate on staging):" : "Catalog (shadow — does not gate trades):",
        indent: 1,
      });
      for (const pb of PLAYBOOK_REGISTRY) {
        lines.push({
          icon: "dim",
          tone: "dim",
          text: `${pb.id} ${pb.name} · ${sessionWindowLabel(pb.id)}`,
          indent: 2,
        });
      }
    }
    return lines;
  }

  if (!live) {
    lines.push({
      icon: "dim",
      tone: "dim",
      text: "Informational only — does not gate BUY/WATCH/HOLD.",
      indent: 1,
    });
  } else {
    lines.push({
      icon: "pulse",
      tone: "accent",
      text: "Live gate — primary PB must FIRE before BUY on staging.",
      indent: 1,
    });
  }

  const primary = panel.verdicts.find((v) => v.primary) ?? null;
  if (panel.primary_playbook_id || primary) {
    const id = (panel.primary_playbook_id ?? primary?.playbook_id) as PlaybookId;
    const name = primary?.name ?? registryEntry(id)?.name ?? id;
    const dir =
      primary?.direction && primary.direction !== "neutral"
        ? ` · ${primary.direction.toUpperCase()}`
        : "";
    const st = primary ? shadowStatus(primary) : "IDLE";
    lines.push({
      icon: "pulse",
      tone: st === "FIRED" ? "bull" : st === "ARMED" ? "accent" : "warn",
      text: `Primary ★ ${id} ${name} · ${st}${dir}`,
      indent: 1,
    });
  } else {
    lines.push({
      icon: "dim",
      tone: "dim",
      text: "Primary — none (no trigger fired this tick)",
      indent: 1,
    });
  }

  for (const v of panel.verdicts) {
    const status = shadowStatus(v);
    const dir =
      status === "FIRED" && v.direction && v.direction !== "neutral"
        ? ` · ${v.direction.toUpperCase()}`
        : "";
    const star = v.primary ? " ★" : "";
    lines.push({
      icon: status === "FIRED" ? "ok" : status === "ARMED" ? "watch" : status === "WATCH" ? "pulse" : "dim",
      tone:
        status === "FIRED" ? "bull" : status === "ARMED" ? "accent" : status === "WATCH" ? "warn" : "dim",
      text: `${v.playbook_id}${star} ${status} · ${v.name}${dir}`,
      indent: 1,
    });
    const hint = statusHint(v);
    if (hint) {
      lines.push({ icon: "dim", tone: "dim", text: hint, indent: 2 });
    }
  }

  return lines;
}

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
} from "docx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(root, "public", "docs");
const outFile = path.join(outDir, "SPX-Sniper-Playbook.docx");

function h1(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 200 } });
}

function h2(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 160 } });
}

function p(text) {
  return new Paragraph({
    spacing: { after: 160 },
    children: [new TextRun({ text, size: 22 })],
  });
}

function bullet(text) {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 80 },
    children: [new TextRun({ text, size: 22 })],
  });
}

function mono(text) {
  return new Paragraph({
    spacing: { after: 200 },
    children: [new TextRun({ text, font: "Courier New", size: 20 })],
  });
}

function table(headers, rows) {
  const headerRow = new TableRow({
    children: headers.map(
      (h) =>
        new TableCell({
          width: { size: 100 / headers.length, type: WidthType.PERCENTAGE },
          children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 20 })] })],
        })
    ),
  });
  const dataRows = rows.map(
    (row) =>
      new TableRow({
        children: row.map(
          (cell) =>
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: cell, size: 20 })] })],
            })
        ),
      })
  );
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1 },
      bottom: { style: BorderStyle.SINGLE, size: 1 },
      left: { style: BorderStyle.SINGLE, size: 1 },
      right: { style: BorderStyle.SINGLE, size: 1 },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1 },
      insideVertical: { style: BorderStyle.SINGLE, size: 1 },
    },
    rows: [headerRow, ...dataRows],
  });
}

const children = [
  new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text: "BLACKOUT TRADING", bold: true, size: 24, color: "22C55E" })],
  }),
  h1("SPX Sniper — Play Engine Playbook"),
  p(
    "How SCANNING, WATCH, BUY, HOLD, TRIM, and SELL work — what the desk checks, when entries fire, and how open plays are managed through the session."
  ),
  p("Document version: June 2026 · blackouttrades.com"),

  h2("State machine overview"),
  p(
    "SPX Sniper runs one play at a time. The engine polls every ~3 seconds, merges live desk data, scores confluence, runs confirmations, then picks a single action for the center panel."
  ),
  mono(`SCANNING ──► WATCHING ──► BUY (CALL/PUT)
    ▲              │              │
    │              │              ▼
    └──── SELL ◄── TRIM ◄── HOLD (open play)`),
  bullet("SCANNING — No entry. Desk is live but gates or confirmations have not cleared."),
  bullet("WATCHING — Setup forming. MTF and structure close; engine tracks WATCH→ENTRY promote."),
  bullet("BUY CALL / BUY PUT — Entry fired. One open 0DTE play with stop, target, option ticket."),
  bullet("HOLD — Open play working; thesis and structure still support direction."),
  bullet("TRIM — Partial take-profit: MFE into target; bank ~50%, trail runner."),
  bullet("SELL — Flatten: stop, target, thesis break, or session close."),

  h2("Confluence score & grade"),
  p(
    "Weighted score from VWAP, gamma regime, GEX walls, flow, VIX term, tide, dark pool, EMAs, TICK breadth proxy, and more. Positive = calls; negative = puts."
  ),
  table(
    ["Grade", "Typical conditions"],
    [
      ["A+", "|score| ≥ 72, ≤1 opposing factor"],
      ["A", "|score| ≥ 58, ≤2 opposing factors"],
      ["B", "|score| ≥ 45, ≤3 opposing factors"],
      ["C / D", "Weaker alignment — usually SCAN / WATCH only"],
    ]
  ),
  p(
    "Conflicts = factors against your direction. Too many block entry; the panel shows dynamic play-idea intel (suggested strike) instead of generic headwinds copy."
  ),

  h2("Entry gates (cold BUY)"),
  p("All must pass before a cold BUY (not WATCH→ENTRY promote):"),
  table(
    ["Gate", "Default", "Meaning"],
    [
      ["Min grade", "B or better", "Confluence quality floor"],
      ["Full entry score", "|score| ≥ 58", "Strong directional read"],
      ["Starter entry", "|score| ≥ 48", "Smaller B-grade entries"],
      ["Watch band", "|score| ≥ 38", "Minimum to stay on WATCH"],
      ["Promote score", "|score| ≥ 44", "WATCH→ENTRY threshold"],
      ["Confirmations", "6+ of 11", "MTF, structure, flow, etc."],
      ["Agreeing factors", "4+", "Factors aligned with direction"],
      ["Conflicts", "< 4", "Opposing factors before hard block"],
      ["Claude gate", "On if API key", "Final arbiter on B+ + confirmations"],
      ["Session", "6:30 AM – 1 PM PT", "No new 0DTE after 2:30 PM ET"],
    ]
  ),
  p("Railway env vars override defaults. Adaptive telemetry can raise floors after enough closed trades."),

  h2("11-point confirmation checklist"),
  bullet("3m MTF (required) — 3m close holds key level. B/A can soft-pass with strong 5m."),
  bullet("5m trend (required) — T1 trigger → T2 3m → T3 5m ladder."),
  bullet("S/R structure (required) — GEX wall, VWAP, or session level in your favor."),
  bullet("Breakout / level (required) — PDH/PDL, HOD/LOD, VWAP reclaim/reject."),
  bullet("0DTE flow (optional) — SPX 0DTE premium skew aligned."),
  bullet("Dark pool (optional) — No institutional bias against your side."),
  bullet("Market tide (optional) — UW tide neutral or aligned."),
  bullet("Internals (optional) — TICK breadth proxy not fighting direction."),
  bullet("News catalyst (optional) — Headline sentiment not opposing trade."),
  bullet("Dealer GEX (optional) — Gamma regime + flip context."),
  bullet("Vol regime (optional) — VIX not extreme for new 0DTE."),

  h2("BUY — opening a play"),
  bullet("Direction locks: long (CALL) or short (PUT)."),
  bullet("Entry = current SPX. Stop = GEX / LOD/HOD/VWAP. Target = opposite wall or session extreme."),
  bullet("Polygon SPXW chain builds option ticket (strike, premium, delta) when liquid."),
  bullet("One open play at a time. Outcomes logged for admin analytics."),
  p(
    "WATCH→ENTRY promote: After WATCH with MTF confirmed, enter when score ≥ promote floor, price drift OK, watch age < 30m."
  ),

  h2("HOLD — managing an open play"),
  bullet("Action HOLD — e.g. \"A PUT working\"."),
  bullet("MFE / MAE tracked every poll."),
  bullet("Confirmations panel stays live."),
  bullet("Thesis includes option label/premium when logged at open."),

  h2("TRIM — partial profit"),
  bullet("MFE ≥ 12 pts (SPX_PLAY_TRIM_MFE_PTS)."),
  bullet("Price in final ~20% of distance to target."),
  bullet("Trim not already done on this play."),
  p("Message: TRIM — bank partial, trail runner. Reduce size manually; engine marks trim_done."),

  h2("SELL — closing the play"),
  table(
    ["Exit", "Condition"],
    [
      ["STOP", "Price through stop (structure broken)"],
      ["TARGET", "Price reaches target zone"],
      ["THESIS", "Confluence flips hard against position"],
      ["SESSION", "Desk closed — flatten 0DTE"],
    ]
  ),
  p("Closed plays → spx_play_outcomes for win rate and adaptive gate tuning."),

  h2("Panel UI"),
  bullet("SCANNING headline — Rotating copy or play-idea intel."),
  bullet("Score / confidence — Raw score and confidence %."),
  bullet("Confirmations — 11-point checklist (session-persisted)."),
  bullet("Play idea line — Actionable call/put strike suggestion."),
  bullet("Blocks — Hard reasons (cooldown, stale GEX, grade, etc.)."),

  h2("Railway tuning reference"),
  mono(`SPX_PLAY_FULL_MIN_SCORE=58
SPX_PLAY_STARTER_MIN_SCORE=48
SPX_PLAY_WATCH_MIN_SCORE=38
SPX_PLAY_PROMOTE_MIN_SCORE=44
SPX_PLAY_MIN_GRADE=B
SPX_PLAY_CONFLICT_BLOCK_MIN=4
SPX_PLAY_MIN_CONFIRMATIONS=6
SPX_PLAY_ONLY_FULL_ENTRY=false
SPX_CLAUDE_GATE=1
SPX_PLAY_TRIM_MFE_PTS=12
SPX_PLAY_THESIS_BREAK_SCORE=40`),
  p("© Blackout Trading · https://blackouttrades.com"),
];

const doc = new Document({
  creator: "Blackout Trading",
  title: "SPX Sniper Play Engine Playbook",
  description: "BUY, HOLD, TRIM, SELL and gate reference for SPX Sniper",
  sections: [{ children }],
});

fs.mkdirSync(outDir, { recursive: true });
const buffer = await Packer.toBuffer(doc);
fs.writeFileSync(outFile, buffer);
console.log(`Wrote ${outFile} (${buffer.length} bytes)`);

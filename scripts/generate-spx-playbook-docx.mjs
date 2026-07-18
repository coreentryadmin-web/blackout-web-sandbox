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
const outDir = path.join(root, "private", "docs");
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
    "Full reference for the SPX Sniper desk: the main 0DTE play state machine, the parallel pre-market lotto engine, entry gates, exit cooldowns, confirmations, session cutoffs, and panel behavior."
  ),
  p("Document version: June 2026 · blackouttrades.com"),

  h2("Architecture — two parallel tracks"),
  p(
    "SPX Sniper runs two independent state machines. They share desk data (Polygon + Unusual Whales + Finnhub) but never share play slots or bias each other."
  ),
  table(
    ["Track", "Window", "Purpose", "Slot"],
    [
      ["Main 0DTE plays", "9:30 AM – 3:50 PM ET", "Intraday momentum — one open play", "spx_open_play"],
      ["Lotto engine", "7:00 AM – 10:30 AM ET", "Pre-market catalyst thesis — far OTM ±25pt", "lotto_plays"],
    ]
  ),
  p(
    "CRITICAL: If lotto is CALL at 8 AM and desk signals PUT at 10:15 AM, take the PUT. Lotto never blocks or consumes the main spx_open_play slot."
  ),

  h2("Session timeline (ET, weekdays)"),
  table(
    ["Time", "Main engine", "Lotto engine"],
    [
      ["Before 7:00 AM", "Closed", "Off"],
      ["7:00 – 9:30 AM", "Desk live · SCAN/WATCH only · no BUY", "Scans catalysts · LOTTO WATCH"],
      ["9:30 – 9:45 AM", "WATCH ok · no cold BUY (opening range)", "Open confirm · BUY LOTTO possible"],
      ["9:45 AM – 3:30 PM", "Full entry · BUY/HOLD/TRIM/SELL", "Manages lotto HOLD · no new entries after 10:30"],
      ["3:30 – 3:50 PM", "No new entries (flat path) · open plays managed", "Off"],
      ["3:50 PM+", "Force-exit open 0DTE (THETA)", "Off"],
    ]
  ),
  p(
    "Independent cutoffs: SPX_PLAY_NO_ENTRY (3:30 PM) blocks flat-path entries only. SPX_PLAY_FORCE_EXIT (3:50 PM) force-flattens open plays only."
  ),

  h2("Main play state machine"),
  p("Polls ~3s via /api/market/spx/play. One open play at a time."),
  mono(`SCANNING ──► WATCHING ──► BUY (CALL/PUT)
    ▲              │              │
    │              │              ▼
    └──── SELL ◄── TRIM ◄── HOLD (open play)`),
  bullet("SCANNING — No entry. Gates or confirmations not cleared."),
  bullet("WATCHING — Setup forming. Watch record for WATCH→ENTRY promote."),
  bullet("BUY CALL/PUT — Entry fired. Stop, target, option ticket."),
  bullet("HOLD — Open play working. MFE/MAE tracked."),
  bullet("TRIM — Partial take-profit at 70% progress + 12pt MFE."),
  bullet("SELL — Flatten: stop, target, thesis, or session close."),

  h2("Confluence score & grade"),
  p("Weighted score from VWAP, gamma, GEX, flow, VIX term, tide, dark pool, EMAs, TICK, news. Positive = calls; negative = puts."),
  table(
    ["Grade", "Conditions"],
    [
      ["A+", "|score| ≥ 72, ≤1 opposing factor"],
      ["A", "|score| ≥ 58, ≤2 opposing"],
      ["B", "|score| ≥ 45, ≤3 opposing"],
      ["C/D", "Weaker — SCAN/WATCH only"],
    ]
  ),
  p("Entry min grade is B (|score| ≥ 45). No separate B+ tier — weighted conflicts filter weak B setups."),

  h2("Weighted conflicts"),
  p("Hard opposes count 2× before blocking entry (default block at ≥4 weighted):"),
  bullet("Market tide against direction"),
  bullet("News sentiment against direction"),
  bullet("GEX wall / gamma regime against direction"),
  bullet("VIX extreme — VIX >28 opposes longs; VIX <14 opposes shorts"),
  bullet("IV rank — IV rank >70 opposes longs (fade risk); IV rank <30 opposes shorts (squeeze risk)"),
  p("Other opposing factors count 1×. γ/GEX-labeled confluence factors count 2× when opposing."),

  h2("Entry gates (flat path)"),
  table(
    ["Gate", "Default", "Meaning"],
    [
      ["Min grade", "B or better", "Confluence quality floor (|score| ≥ 45)"],
      ["Full entry", "|score| ≥ 58", "Full size entry"],
      ["Starter", "|score| ≥ 48", "Smaller B entries"],
      ["Watch band", "|score| ≥ 38", "Minimum for WATCH"],
      ["Promote", "|score| ≥ 48", "WATCH→ENTRY + 0DTE flow"],
      ["Opening range", "Until 9:45 AM", "No cold BUY first 15m"],
      ["Pre-market", "Before 9:30 AM", "No BUY — WATCH ok"],
      ["Post-STOP cooldown", "20 min", "STOP exits only — any direction, no BUY"],
      ["Buy cooldown", "10 min", "Any exit — A+ bypasses block with warning"],
      ["Re-entry lock", "20 min", "Loss exit (STOP + THESIS) — same direction"],
      ["Weighted conflicts", "< 4", "Hard opposes 2×"],
      ["Confirmations", "6+ of 11", "MTF, structure, flow"],
      ["Agreeing factors", "4+", "Factors aligned with direction"],
      ["GEX walls", "Required", "No entry without dealer map"],
      ["Desk freshness", "< 120s", "Stale data blocks"],
      ["Macro hard block", "8:25–10:30 AM", "CPI/FOMC window"],
      ["VIX ceiling", "> 32", "Too hot for 0DTE"],
      ["No-entry cutoff", "3:30 PM", "Flat path only"],
      ["Claude gate", "If API key", "Final arbiter on A/A+ setups"],
    ]
  ),
  p("Adaptive telemetry raises floors after 8+ trades over 14 days with win rate <45%."),
  p(
    "Cooldown overlap: STOP loss triggers post-STOP (any dir) + re-entry lock (same dir). THESIS loss triggers re-entry lock + buy cooldown only. Winning TARGET triggers buy cooldown only (A+ bypasses buy cooldown block)."
  ),

  h2("Exit cooldowns & session memory"),
  p(
    "After every closed play, timing metadata is stored in platform_meta key spx_play_session_meta. Three independent gates read this state on the flat path (SCANNING → BUY)."
  ),
  p("Session meta JSON (written on every BUY and SELL):"),
  mono(`{
  "last_buy_at": 1718635200000,
  "last_sell_at": 1718636400000,
  "last_sell_was_loss": true,
  "last_direction": "long",
  "last_stop_at": 1718636400000
}`),
  p("last_stop_at is set ONLY when exit_action === STOP. THESIS losses set last_sell_was_loss but do NOT update last_stop_at."),
  table(
    ["Gate", "Env var", "Default", "Triggered by", "Scope"],
    [
      ["Buy cooldown", "SPX_PLAY_BUY_COOLDOWN_SEC", "600s (10m)", "Any exit (win or loss)", "Blocks BUY any direction"],
      ["Post-STOP cooldown", "SPX_PLAY_COOLDOWN_AFTER_STOP_MIN", "20 min", "STOP exits only", "Blocks BUY any direction"],
      ["Re-entry lock", "SPX_PLAY_REENTRY_LOCK_SEC", "1200s (20m)", "Loss exits (STOP + THESIS)", "Blocks BUY same direction"],
    ]
  ),
  table(
    ["Exit", "Loss?", "Sets last_stop_at?", "Buy cooldown", "Post-STOP", "Re-entry lock"],
    [
      ["STOP", "Yes", "Yes", "Yes", "Yes", "Yes (same dir)"],
      ["THESIS", "Yes", "No", "Yes", "No", "Yes (same dir)"],
      ["TARGET", "No", "No", "Yes", "No", "No"],
      ["THETA", "No", "No", "Yes", "No", "No"],
      ["SESSION", "No*", "No", "Yes", "No", "No"],
    ]
  ),
  p("*SESSION flatten is not scored as a loss unless stop or thesis break fired on the same tick."),
  bullet("STOP long 10:00 — buy cooldown until 10:10; post-STOP until 10:20 (any dir); re-entry lock until 10:20 (long only). Short at 10:05 blocked by post-STOP only."),
  bullet("THESIS loss short 11:00 — buy cooldown + re-entry lock on shorts. No post-STOP. Long allowed if gates pass."),
  bullet("TARGET win long 14:00 — buy cooldown only until 14:10."),
  p("A+ buy-cooldown bypass: inside the 10m buy window, A+ grade surfaces a warning instead of blocking. SPX_PLAY_BUY_COOLDOWN_APLUS_BYPASS=1 (default). Does NOT bypass post-STOP or re-entry lock. Grade A does not bypass."),
  p("WATCH→ENTRY promote strips buy-cooldown, grade-floor, and re-entry-lock blocks from promote evaluation — post-STOP is never stripped."),

  h2("11-point confirmation checklist"),
  bullet("3m MTF (required) — 3m close holds key level."),
  bullet("5m trend (required) — T1→T2 3m→T3 5m ladder."),
  bullet("S/R structure (required) — GEX wall, VWAP, session level."),
  bullet("Breakout/level (required) — PDH/PDL, HOD/LOD, VWAP."),
  bullet("0DTE flow (required) — SPX 0DTE skew aligned."),
  bullet("Dark pool (optional) — No institutional oppose."),
  bullet("Market tide (optional) — UW tide aligned."),
  bullet("Internals (optional) — TICK not fighting."),
  bullet("News (optional) — Headlines not opposing."),
  bullet("Dealer GEX (optional) — Gamma regime supports."),
  bullet("Vol regime (optional) — VIX not extreme."),

  h2("WATCH → ENTRY promote"),
  bullet("|score| ≥ 48 + 0DTE flow aligned."),
  bullet("Price hasn't drifted from watch level."),
  bullet("Watch age < 30m (extends to 45m if flow + TICK aligned)."),
  bullet("All entry gates pass + Claude approves."),

  h2("Adaptive telemetry (outcome-driven floors)"),
  p("Activates after SPX_OUTCOME_MIN_TRADES=8 closed plays AND SPX_OUTCOME_MIN_DAYS=14 of data in spx_play_outcomes. Cached 5 min."),
  table(
    ["Condition", "Env var", "Effect"],
    [
      ["Overall win rate < 45%", "SPX_ADAPTIVE_MIN_WIN_RATE=0.45", "+3 to full-entry and promote floors (global_min_score_boost). 58→61, promote 48→51"],
      ["Promote trails cold BUY by ≥15 pts (3+ each)", "SPX_PROMOTE_UNDERPERFORM_GAP=0.15", "+SPX_PROMOTE_SCORE_BOOST=5 on promote floor only (promote_min_score_boost)"],
      ["Promote gap ≥30 pts AND promote WR < 35%", "(2× gap)", "WATCH→ENTRY path blocked (promote_blocked); cold BUY still ok"],
      ["≥2 promote trades, 0% win rate", "—", "Promote floor +5 minimum"],
    ]
  ),
  p("effectiveFullMinScore = FULL_MIN + global boost. effectivePromoteMinScore = PROMOTE_MIN + global + promote boost. Starter (48) and watch band (38) are NOT raised by telemetry."),

  h2("BUY — opening a play"),
  bullet("Direction: long (CALL) or short (PUT)."),
  bullet("Entry = SPX print. Stop = GEX/LOD/HOD/VWAP. Target = opposite wall."),
  bullet("Polygon SPXW option ticket. Spread: 20% first 30m after 9:30, then 18%."),
  bullet("Persisted in spx_open_play. Logged to spx_play_outcomes."),

  h2("HOLD — managing open play"),
  bullet("HOLD while between stop and target."),
  bullet("MFE/MAE tracked every poll."),
  bullet("entry_score stored for dynamic thesis break."),

  h2("TRIM — partial profit"),
  bullet("MFE ≥ 12 pts (SPX_PLAY_TRIM_MFE_PTS)."),
  bullet("Progress ≥ 70% entry→target (SPX_PLAY_TRIM_PROGRESS_PCT=0.70)."),
  bullet("Trim not already done. Bank partial manually; engine marks trim_done."),

  h2("SELL — closing the play"),
  table(
    ["Exit", "Condition", "Path"],
    [
      ["STOP", "Price through stop", "Open play"],
      ["TARGET", "Price at target", "Open play"],
      ["THESIS", "Score drop ≥12 from entry OR ±40 floor (OR logic)", "Open play"],
      ["THETA", "3:50 PM ET force-flatten", "Open play only"],
      ["SESSION", "Desk closed", "Open play"],
    ]
  ),
  p("Thesis break OR: long exits at max(−40, entry−12); short at min(+40, entry+12). First hit wins."),
  p("On close: every exit sets last_sell_at. STOP sets last_stop_at. Loss exits set last_sell_was_loss. See Exit cooldowns section."),

  h2("Lotto engine — parallel pre-market track"),
  p(
    "Directional bias engine 7:00–10:30 AM ET. Synthesizes pre-market intel for one far-OTM ±25pt lotto. Default: No lottos today."
  ),
  mono(`PRE-MARKET (7:00–9:30 ET)
LOTTO_SCAN → LOTTO_WATCH
     │ 9:30 open
     ├─ LOTTO_BUY → LOTTO_HOLD → LOTTO_SELL
     └─ LOTTO_INVALID → reversal scan → No lottos today`),
  p("API: /api/market/lotto/today. Poll 60s pre-market, 10s 9:30–10:30. Max 2 picks/day (1 + reversal)."),

  h2("Lotto — data sources"),
  table(
    ["Signal", "Source", "Check"],
    [
      ["Overnight flow", "UW/Polygon", "Large SPX prints, skew"],
      ["Dark pool", "UW", "2× accumulation side"],
      ["News/catalyst", "Benzinga + static calendar", "CPI, FOMC, NFP; headline keyword fallback"],
      ["Gap", "SPY premarket / SPX RTH", "No ES futures — SPY todaysChangePerc before 9:30; SPX vs prior close after open"],
      ["VIX term", "UW", "Backwardation = vol expansion"],
      ["GEX", "Polygon SPXW", "Gamma walls before open"],
    ]
  ),

  h2("Lotto — catalyst tier (need ≥1)"),
  table(
    ["Catalyst", "Threshold"],
    [
      ["Macro event", "CPI, FOMC, PCE, NFP, jobs, GDP"],
      ["Flow skew", "> $5M one direction"],
      ["Gap", "> 0.4% from prior close"],
      ["Dark pool", "> 2× on one side"],
      ["VIX backwardation", "VIX9D > VIX"],
    ]
  ),

  h2("Lotto — direction confirmation (need ≥3)"),
  bullet("Overnight flow direction"),
  bullet("Gap direction"),
  bullet("Dark pool side"),
  bullet("Technical: VWAP, prior close, GEX wall"),
  p("≥1 catalyst AND ≥3 direction signals agree → LOTTO WATCH. Else: No lottos today."),

  h2("Lotto — open anchor & the 8-point rule"),
  p("Open anchor = first SPX print at or immediately after 9:30 AM ET cash open (~9:30:01 poll). Not prior close."),
  bullet("Confirm (pre-BUY): ≥8pt from open anchor in lotto direction → BUY LOTTO eligible"),
  bullet("INVALIDATED (pre-BUY): ≥8pt opposite from open anchor → do not enter; reversal scan"),
  bullet("LOTTO STOPPED (post-BUY): −8pt from entry price (fill), not open anchor → forced exit"),
  p("Same 8pt threshold, two anchors: open anchor gates entry; entry price gates the hold."),

  h2("Lotto — post-open entry & invalidation"),
  p("BUY LOTTO when all of:"),
  bullet("≥8pt move in lotto direction from open anchor"),
  bullet("First 5m candle in lotto direction"),
  bullet("0DTE flow aligned at open"),
  p("INVALIDATED (pre-BUY) when any of:"),
  bullet("≥8pt opposite from open anchor — thesis broken before fill"),
  bullet("5m candle hard against thesis"),
  bullet("Invalidation level breached"),
  p("On invalidation: one reversal scan (see below). Expires 10:30 AM if not triggered."),
  p("LOTTO WIN: +25pt from entry price. LOTTO STOPPED: −8pt from entry price (post-BUY only)."),

  h2("Lotto — reversal scan (one second chance)"),
  p(
    "Pre-BUY INVALIDATED (e.g. CALL watch, SPX drops 8+ pt from anchor) clears the dead watch and runs one reversal attempt (pick_count++; max SPX_PLAY_LOTTO_MAX_PICKS=2/day)."
  ),
  p(
    "Scoring: NOT a mechanical flip. Re-runs full evaluateLottoCatalysts() on live desk — same bar as first watch: ≥1 catalyst AND ≥3 direction signals (SPX_PLAY_LOTTO_MIN_DIRECTION_SIGNALS=3). Invalidation move alone is not enough; live tape must qualify (e.g. drop makes gap/flow vote PUT)."
  ),
  p(
    "Open anchor: original 9:30 print discarded. Reversal watch starts open_anchor_price=null; next poll locks anchor to current SPX (price at invalidation moment). ±8pt confirm/invalidation uses that fresh anchor. Logged is_reversal=true."
  ),
  p("No qualifying reversal → No lottos today."),

  h2("Lotto sizing & chain filter"),
  p("Lotto sizing: 25–50% of standard play size. These are thesis bets, not conviction plays."),
  p("Main plays: SPX_CHAIN_MAX_SPREAD_PCT=18 (20% open window). Lotto uses SPX_LOTTO_CHAIN_MAX_SPREAD_PCT=50 — far OTM $0.30–$0.50 strikes need wider tolerance."),
  p("Optional premium band: SPX_LOTTO_MIN_PREMIUM=0.20, SPX_LOTTO_MAX_PREMIUM=0.85. Lotto sizing: 25–50% of standard play size."),

  h2("Panel UI — main play block"),
  bullet("SCANNING headline — rotating desk copy or play-idea intel."),
  bullet("Confirmations — live 11-point checklist; persists via session cache."),
  bullet("⛔ blocks — hard gate failures (cooldown, grade, stale GEX, etc.)."),
  bullet("⚠ warnings — non-blocking: A+ buy-cooldown bypass, elevated VIX, adaptive boost."),
  bullet("Entry/stop/target + option ticket on BUY and HOLD."),

  h2("platform_meta key registry"),
  p("Shared KV store: key TEXT PK, value TEXT (JSON), updated_at. Namespaced keys in platform-meta-keys.ts:"),
  bullet("spx_lotto_record — live LottoRecord JSON (today)"),
  bullet("spx_watch_record — WATCH→ENTRY scratch"),
  bullet("spx_play_session_meta — last_sell_at, last_stop_at, last_sell_was_loss, last_direction, last_buy_at"),
  bullet("spx_claude_play_cache — Claude gate cache"),
  bullet("spx_signal_log_cursor — signal dedup"),
  bullet("uw_flow_cursor — flow ingest cursor"),
  p("Persistent lotto history: lotto_plays table. platform_meta = in-flight poll state only."),

  h2("Lotto panel UI"),
  mono(`LOTTO WATCH
CALL · Strike 5650 · ~$0.45
Target: +25 pts · Entry: SPX >5620
Catalyst: CPI today + gap +0.6%
Flow: $8.2M calls overnight
Status: Watching for open confirm`),
  p("Independent of main play action. Shown below SCANNING block."),

  h2("API endpoints"),
  table(
    ["Endpoint", "Poll", "Purpose"],
    [
      ["/api/market/spx/desk", "~10s", "Full desk"],
      ["/api/market/spx/pulse", "~2s", "Fast price/internals"],
      ["/api/market/spx/flow", "~4s", "UW flow/GEX"],
      ["/api/market/spx/play", "~3s", "Main play engine"],
      ["/api/market/lotto/today", "60s/10s", "Lotto engine"],
    ]
  ),

  h2("Database tables"),
  table(
    ["Table", "Purpose"],
    [
      ["spx_open_play", "Current open 0DTE (one at a time)"],
      ["spx_play_outcomes", "Main play telemetry"],
      ["lotto_plays", "Lotto history (separate)"],
      ["platform_meta", "Live lotto state"],
      ["spx_signal_log", "Signal audit trail"],
    ]
  ),

  h2("ECS tuning reference"),
  mono(`# Main play gates
SPX_PLAY_FULL_MIN_SCORE=58
SPX_PLAY_STARTER_MIN_SCORE=48
SPX_PLAY_WATCH_MIN_SCORE=38
SPX_PLAY_PROMOTE_MIN_SCORE=48
SPX_PLAY_MIN_GRADE=B
SPX_PLAY_WEIGHTED_CONFLICT_BLOCK_MIN=4
SPX_PLAY_MIN_CONFIRMATIONS=6
SPX_PLAY_MIN_AGREEING_FACTORS=4
SPX_PLAY_ONLY_FULL_ENTRY=false
SPX_PLAY_OPENING_RANGE_MINUTES=15
SPX_PLAY_COOLDOWN_AFTER_STOP_MIN=20
SPX_PLAY_BUY_COOLDOWN_SEC=600
SPX_PLAY_BUY_COOLDOWN_APLUS_BYPASS=1
SPX_PLAY_REENTRY_LOCK_SEC=1200

# Session cutoffs (independent)
SPX_PLAY_NO_ENTRY_ET_HOUR=15
SPX_PLAY_NO_ENTRY_ET_MIN=30
SPX_PLAY_FORCE_EXIT_ET_HOUR=15
SPX_PLAY_FORCE_EXIT_ET_MIN=50

# Open play management
SPX_PLAY_TRIM_MFE_PTS=12
SPX_PLAY_TRIM_PROGRESS_PCT=0.70
SPX_PLAY_THESIS_BREAK_SCORE=40
SPX_PLAY_THESIS_BREAK_DROP_PTS=12
SPX_PLAY_WATCH_MAX_AGE_MIN=30
SPX_PLAY_WATCH_EXTEND_AGE_MIN=45

# Option chain spread
SPX_CHAIN_MAX_SPREAD_PCT=18
SPX_CHAIN_MAX_SPREAD_PCT_OPEN=20
SPX_CHAIN_OPEN_SPREAD_MINUTES=30

# Lotto engine
SPX_PLAY_LOTTO_TARGET_PTS=25
SPX_PLAY_LOTTO_MAX_PICKS=2
SPX_PLAY_LOTTO_FLOW_MIN=5000000
SPX_PLAY_LOTTO_GAP_MIN_PCT=0.4
SPX_PLAY_LOTTO_CONFIRM_MOVE_PTS=8
SPX_PLAY_LOTTO_EXPIRE_ET_HOUR=10
SPX_PLAY_LOTTO_EXPIRE_ET_MIN=30
SPX_PLAY_LOTTO_MIN_DIRECTION_SIGNALS=3
SPX_LOTTO_CHAIN_MAX_SPREAD_PCT=50
SPX_LOTTO_MIN_PREMIUM=0.20
SPX_LOTTO_MAX_PREMIUM=0.85

# Adaptive telemetry (see Adaptive telemetry section)
SPX_OUTCOME_MIN_TRADES=8
SPX_OUTCOME_MIN_DAYS=14
SPX_ADAPTIVE_MIN_WIN_RATE=0.45
SPX_PROMOTE_UNDERPERFORM_GAP=0.15   # cold WR − promote WR; triggers +5 promote floor
SPX_PROMOTE_SCORE_BOOST=5           # points added to promote min when gap ≥ 0.15`),
  p("© Blackout Trading · https://blackouttrades.com"),
];

const doc = new Document({
  creator: "Blackout Trading",
  title: "SPX Sniper Play Engine Playbook",
  description: "Full reference for SPX Sniper main plays and lotto engine",
  sections: [{ children }],
});

fs.mkdirSync(outDir, { recursive: true });
const buffer = await Packer.toBuffer(doc);
fs.writeFileSync(outFile, buffer);
console.log(`Wrote ${outFile} (${buffer.length} bytes)`);

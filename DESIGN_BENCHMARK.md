# BlackOut — Institutional Design Benchmark

**North star:** Professional trading intelligence that a hedge fund desk would trust — not a Discord trading community skin.

## Benchmark bar (what “good” looks like)

| Reference | Steal this |
|-----------|------------|
| **Bloomberg Terminal** | Dense data hierarchy, monospace numbers, panel chrome that disappears behind the tape |
| **TradingView** | Clean price display, semantic color only on direction, no decorative glow on quotes |
| **thinkorswim / Webull Desktop** | Workspace panels with honest connection state, not fake “LIVE” everywhere |
| **Robinhood Legend** | Restrained dark UI, one accent per action, typography that reads at a glance |
| **Polygon.io** | API-grade freshness, timestamps beside every live figure |
| **Unusual Whales** | Flow tables first — brand is secondary to the data grid |
| **Stripe Dashboard** | Trust through spacing, borders, and copy — no cosplay |
| **Linear** | Sidebar + header rhythm, subtle motion, zero ornament |
| **Raycast** | Keyboard-native density, crisp labels, no uppercase shouting |

## Anti-patterns (Discord trading website)

Kill on sight:

- Military / tactical copy (“Clearance,” “Stand down,” “Live Fire,” “command center,” “war room”)
- Unicode diamonds (`◆`) as default decoration
- Scanlines, ghost watermark text (`FLOW`, `HEAT`), DNA helix, custom cursor
- `text-glow-*` on prices and titles
- Pulsing green dots that imply live when data is stale
- Anton all-caps on in-app tool chrome (reserve for marketing hero only)
- Emoji padlocks (`🔒`) in navigation
- “Arsenal,” “Recon,” “battle-ready,” “operator” voice

## In-app typography

| Surface | Font | Example |
|---------|------|---------|
| Marketing hero | Anton | Landing H1 only |
| Tool page title | Syne / Inter bold | `SPX Slayer`, `HELIX` |
| Panel title | Inter semibold 14–16px | `GEX ladder` |
| Data | JetBrains Mono tabular | prices, timestamps, flow rows |
| Kicker | Mono 10–11px, `text-secondary` | `Institutional flow` — no sigil by default |

## Data trust (non-negotiable)

Every live surface shows **value · direction · as-of · status** via `FreshnessChip`:

- `live` — feed confirmed within SLA
- `stale` — last tick older than threshold
- `cached` / `offline` — honest degradation
- Never badge “Live” from WebSocket `OPEN` alone

## Motion

- CSS: hover, skeleton, row flash on new tape print
- Framer: modals, drawers, nav sheet only
- No row stagger on flow tables; no hero parallax

## Review checklist (per screen)

1. Would this panel fit on a Bloomberg second monitor without embarrassment?
2. Is every green dot backed by a timestamp?
3. Can a PM understand the page in 5 seconds without reading cosplay copy?
4. Is decoration ≤ 10% of pixels?
5. Does empty/error state say what broke and the one next step?

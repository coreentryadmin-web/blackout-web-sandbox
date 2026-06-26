# Night Hawk — Numeric Grounding Enforcement

**Status:** shipped behind `NIGHTHAWK_GROUNDING_ENFORCE` (default ON). Branch `auto/nighthawk-grounding`.

## Why

The data-correctness audit found there was **no deterministic numeric grounding** between Claude's
free-text play JSON and the published edition:

- `mapClaudePlayToEdition` (`claude-edition.ts`) is a `String()` passthrough — whatever number Claude
  writes is what publishes.
- The only structural gates were a premium **cap** (`play-constraints.ts`) and a deliberately **soft**
  strike gate (`option-chain-prompt.ts` `evaluatePlayAgainstChain`) that only drops a play on a
  positive chain contradiction.
- `entryPremiumWithinCap(null) === true` — a **null premium passed** the cap.
- `dossier.price_target` is **hardcoded `null`** (`dossier.ts:332`), so any analyst price target in
  the prose is, by construction, **fabricated**.
- The "critic" (`play-critic.ts`) is itself an **LLM** — it cannot be the guarantee.

So a play could publish an off-chain strike, a fabricated flow $, a null-premium-as-PASS, an
off-S/R level, or a fabricated analyst price target.

## The principle

**Deterministic arithmetic grounding, NOT an LLM critic.** Every published number must trace to the
SAME chain + dossier data that was put in front of Claude. The grounding pass is a pure function
(`grounding.ts`) — no model, no new network calls.

## Where it runs (no new fan-out)

`generateEditionPlays` (`claude-edition.ts`) already prefetches the option chain via
`fetchEditionChains(...)` → `chainData: Record<ticker, { spot, rows }>` (ATM ±5%, front-two
expiries) and passes the SAME `chainData`/`chainTables` to Claude. The grounding pass
(`groundPlays(strikeOk, chainData, dossierMap)`) runs **after** the premium-cap + soft-strike
filters and **before** the top-5 slice, and only **reads** that already-fetched `chainData` plus the
in-memory dossiers. **No live UW/Polygon fan-out is added** — this respects the cache-reader rule.
Running before the top-5 slice means a dropped play lets a lower-ranked grounded play fill its slot.

## The six checks

| # | Check | Source of truth | Tolerance | Severity |
|---|-------|-----------------|-----------|----------|
| 1 | **Strike chain-confirmed** | `chainData.rows` OI for the parsed strike+side(+expiry) | OI ≥ `GROUNDING_MIN_OI` = **500** | **HARD (drop)** — only when the contract IS present in the ATM window but below the OI floor (positive contradiction). Absent contract = unverifiable, **not** dropped. |
| 2 | **Entry premium reconciles** | chain ask, or mid `(bid+ask)/2`, for the matched contract | within **±40%** (`PREMIUM_TOLERANCE_PCT`) | **HARD (drop)** — only for a **confirmed on-chain** contract. `null` premium on a confirmed contract is rejected (no null-as-PASS). |
| 3 | **Flow $ reconciliation** | `dossier.flows` Σ `total_premium\|premium` (same figure as `format.ts:327` "Flow today") | within **±35%** (`FLOW_TOLERANCE_PCT`) | **SOFT (flag)** |
| 4 | **Entry/target/stop levels trace to real structure** | `dossier.tech.support_levels` + `resistance_levels` + chain strikes | within **±2%** (`LEVEL_TOLERANCE_PCT`) | **SOFT (flag)** |
| 5 | **Kill fabricated analyst PT** | n/a — `dossier.price_target` is always `null` | any PT-like phrase | **SOFT (strip + flag)** — phrase is replaced with `[price target unavailable]` in `thesis`/`key_signal`/`target`. Prompt also forbids citing a PT. |
| 6 | **Prose-vs-structured divergence** | grounded structured fields (IV rank, parsed strike) | IV ±25%, strike must match a chain strike | **SOFT (flag)** |

### Key nuance — unverifiable ≠ contradicted

The prefetched chain only covers ATM ±5% on the front two expiries. A legitimately longer-dated
(swing/leap) or slightly-OTM contract Claude picks is simply **absent** from that window. Absence is
**not** a contradiction and must **not** drop the play — that was the `#77` over-filter that zeroed
whole editions (17 candidates → 0 plays). Only a **positive** contradiction (present but illiquid, or
present + premium way-off) is a HARD drop. This mirrors the existing soft strike gate's contract.

## Drop-vs-flag policy

- **HARD (DROP from edition):** off-chain/illiquid strike (check 1), null or out-of-tolerance premium
  on a confirmed contract (check 2). These are trade-critical fabrications — a user acting on them
  would trade a contract that doesn't exist or pay a fabricated price. **Conservative by design:** we
  only drop on a *positive contradiction*, never on unverifiability.
- **SOFT (KEEP the play, strip/flag the number, log it):** flow $ divergence (3), untraceable level
  (4), fabricated PT (5 — also stripped from prose), prose/structured divergence (6). The play is
  still tradeable; we strip the made-up number (PT) or flag it for a future renderer to prefer the
  structured grounded field.

### Graceful degradation

- A play that fails a HARD check is dropped; survivors are re-ranked 1..N (no rank gaps).
- If **all** plays are dropped, `generateEditionPlays` returns `plays: []` → the existing
  **recap-only fallback** in `edition-builder.ts` publishes a real recap edition (verified: the
  `!rawPlays.length` branch routes to `publishRecapOnlyEdition`; the funnel reason now names the
  grounding drop). The build **never** blanks the edition or hard-crashes.
- `groundPlays` wraps each play in try/catch — a grounding bug keeps the play untouched rather than
  dropping it or throwing.

## Observability

- **Funnel log** (`edition-builder.ts` `formatFunnelLine`) now ends with
  `… grounded=N, dropped_ungrounded=N, flagged=N, published=N` on **every** exit (success + all
  recap-only fallbacks).
- **Edition meta** carries `meta.grounding = { grounded, dropped_ungrounded, flagged, notes[] }`,
  where `notes` is one `DROP …` / `FLAG …` line per non-OK play with the specific number + reason.
- Per-play `console.warn` for each drop/flag.

## Rollback knob

`NIGHTHAWK_GROUNDING_ENFORCE` (default `"1"`). Set to `"0"` to run the checks **without** dropping —
output is unchanged but the summary still logs exactly what *would* have dropped. This is the
deploy-risk safety valve: the checks always run and log; the env var only gates whether HARD drops
take effect, so it doubles as a dry-run / instant rollback.

## Follow-ups (not done here)

- **Real analyst PT source.** `dossier.price_target` is hardcoded `null`. If a real PT feed is wired
  (e.g. UW `predictions` consensus already in the dossier, or a Polygon/Benzinga analyst endpoint),
  populate `dossier.price_target` and relax check 5 to *reconcile* a PT instead of stripping it. Until
  then, stripping is correct — any PT is fabricated.
- **Render structured over prose.** Check 6 currently *flags* prose/structured divergence; a future UI
  change could render the grounded structured field (strike, IV rank, flow) in the trade card and
  demote prose to context, making divergence cosmetic.

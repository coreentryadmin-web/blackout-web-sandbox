This is a synthesis task â€” I have all 12 subsystem findings and need to produce the report directly. No file access needed.

# SPX System â€” Deep Audit Report
## BlackOut SPX 0DTE Scalper â€” Comprehensive A-to-Z Technical Audit

---

## 1. System Architecture Overview

The BlackOut SPX 0DTE scalper is a single-process `asyncio` Discord alert engine built around `SpxScalperEngine` (`engine.py`), coordinating ~50 modules across data ingestion, signal scoring, trade lifecycle, options selection, alerting, and post-hoc analytics. The full pipeline runs as follows:

**Data in.** Two parallel price paths converge at `SessionState` (`session.py`):
- **WebSocket path** â€” `run_index_ws_loop()` (`polygon_stream.py`) subscribes to `AM.I:SPX,AM.I:VIX` on the Polygon/Massive indices feed. Each 1-minute AM bar flows `_bar_from_am()` â†’ `handle_bar()` â†’ `bar_in_scalper_session()` gate â†’ `SessionState.ingest_bar()` â†’ `BarStore.append()` (a `deque(maxlen=500)` of 1m `OhlcBar`) â†’ incremental HOD/LOD/VWAP/volume-profile update â†’ `EventDetector.evaluate()`.
- **Poll path** â€” `poll_loop()` fires every `SPX_SCALPER_POLL_SEC` calling `poll_once()`: fetches a Polygon index snapshot, reloads all session minute-bars via `_load_spx_session_bars()`, recomputes VWAP/structure desks, refreshes UW/GEX/flow context, ticks the trade lifecycle, and (only when WS is disabled) emits structure events. This is the fallback and the sole path when `SPX_SCALPER_WS_ENABLED=0`.

REST enrichment runs through `polygon_client.py`; an `http_retry` transport handles retries. `data_freshness.py` gates entries on the age of GEX, flow, internals, and bar data.

**Enrichment / desk analytics.** Each tick refreshes a fleet of immutable desk snapshots (frozen dataclasses): EMA stack (`ema_desk.py`), ATR/day-type (`atr_desk.py`), VWAP anchors with Ïƒ bands (`vwap_desk.py`, SPY-proxy via `vwap_proxy.py`), volume profile (`volume.py`/`vp_desk.py`/`volume_profile_desk.py`), dealer GEX (`gamma_desk.py`/`polygon_gex.py`/`dealer.py`), IV rank (`iv_desk.py`), VIX term structure (`vix_term.py`), NYSE breadth/internals (`breadth.py`/`internals_desk.py`), QQQ RS (`qqq_strength.py`), and sector rotation (`sectors.py`). Options flow comes from `flow_0dte.py`, `strike_flow.py`, and `dark_pool_desk.py`.

**Market structure.** `build_horizontal_levels()` (`levels.py`) assembles the flat level list each tick; `SrLevelTracker.evaluate()` (`sr_events.py`) emits 8 typed S/R `StructureEvent` kinds; `structure_phase.py` classifies a 4-state operational phase (impulse/chop/late/reversal); `ict.py` (FVGs + BSL/SSL sweeps), `wyckoff.py` (spring/upthrust/SOS/SOW), `opening_range_desk.py`, and `candles.py` add structural context; HTF levels come from `htf_levels.py`.

**Signal generation â†’ scoring.** `EventDetector.evaluate()` produces `(graded, watches, heads_ups)` tuples. Each event passes through `apply_confluence_to_event()` â†’ `score_event()` (`confluence.py`), a flat additive model starting at 50, clamped [0,100], ~30 sub-scorers stacking integer points, mapped to D/C/B/A/A+ grades. A `CONTEXT_SCORE_CAP=10` limits soft signals. Calibration (`score_calibration.py`) is read-only and does not feed back.

**Trade decision â†’ entry.** Graded events and synthetic desk candidates (`desk_entry.py`) converge on `classify_entry()` (`entry_routing.py`), gating through: grade floor â†’ `evaluate_entry_risk()` hard blocks (`entry_risk.py`) â†’ MTF hybrid confirmation (`alert_confirm.py`) â†’ score-band routing (full/starter/watch/suppress) â†’ `EntryGateTracker.allow_buy()` cooldown + chop guard (`entry_gate.py`, `chop_guard.py`) â†’ `evaluate_position_policy()` (`position_policy.py`). The options leg is built by `build_options_plan()` and `apply_uw_chain_strike()` (`options_plan.py`) with delta-band-by-grade strike selection and live NBBO from `uw_options.py`.

**Management â†’ exit.** Approved entries register with `TradeLifecycleTracker` (`trade_lifecycle.py`). `tick_async()` runs per-tick: excursion update, ADD-leg index stops, VIX spike exit, premium ladder (`premium_ladder.py`/`premium_range.py`), data-staleness gate, then `_tick_one_trade()` (theta time stop via `option_greeks.py`, confirmed stop, trim/target, checkpoints). Structure events on open trades drive two-strike exits via `on_structure_event()` and `trade_exit_rules.py`. EOD flatten via `flatten_all()`.

**Alerts.** All Discord output goes through `send_discord_alert()` (`discord_channel.py`), double-gated on RTH. Entry tickets use `format_compact_trade_embed()` (`compact_talon_embed.py`); structure/blocked/watch alerts use the three-section compact panel (`compact_alert.py`); lifecycle via `post_lifecycle_alert()`. Visibility is layered in `discord_visibility.py` (per-category flag + play-alerts-only master + RTH gate). Desk briefings (pre-market, hourly) are Claude-generated in `desk_briefings.py`.

**AI + analytics.** Interactive mentor (`ai_mentor.py`/`mentor_commands.py`), automated Claude briefs (`claude_brief.py`), live pulse dashboard (`chart_pulse.py`/`pulse_mentor.py`/`pulse_watch.py`). Post-hoc analytics: `journal.py` (Postgres `spx_scalper_events`), `eod_outcomes.py` (MFE/MAE replay), `calibration_report.py`, `review_15d.py`, `attribution.py`.

**Coordination.** A distributed leader lock (`SPX_LEADER_LOCK_ENABLED`) gates every meaningful action; `_leader_renew_loop()` refreshes it. All state mutations share `_session_tick_lock`. Session rolls via `_maybe_roll_session()`; GTH mode remaps session-date semantics.

---

## 2. Critical Bugs (must fix now)

The audit used a four-tier severity scale (critical/high/medium/low). **No findings were rated `critical`** by any of the 12 subsystems. The most severe tier in use is `high`. However, several `high` findings are functionally critical because they bypass safety rails or silently lose trades â€” these are flagged below and should be treated as fix-now priorities. Section 3 covers the complete `high` inventory; the following four are the ones that most resemble critical defects and warrant immediate attention:

1. **`entry_risk.py :: evaluate_entry_risk` â€” kill-switch master flag bypasses ALL hard blocks.** When `SPX_KILL_SWITCHES_ENABLED` is False, the function returns immediately with `hard_block=False` and `routing_score=base_score`, bypassing earnings, macro calendar, daily loss cap, option spread, and chop guard. A single misconfigured flag lets the system trade through CPI/FOMC, past max daily loss, and through extreme spreads. **Fix:** enforce daily loss cap and earnings block regardless of the flag; split into per-category flags so only noise-reduction rules are toggleable.

2. **`entry_routing.py :: classify_entry` â€” A+ conflict override skips risk evaluation.** When `conflicts_block_entry()` is True AND score â‰¥ `SPX_HIGH_SCORE_STARTER_MIN` AND `hybrid.ok` AND `conflicts == 2`, a 'starter' route is returned that bypasses `evaluate_entry_risk()` entirely â€” no daily-loss, earnings, macro, or chop check. **Fix:** call `evaluate_entry_risk()` and gate on `risk.hard_block` before returning the override route.

3. **`alerts.py :: post_structure_event` â€” silent RTH-gate drop also skips lifecycle registration.** If `send_discord_alert()` returns None (outside RTH) the lifecycle guard at lines 1062â€“1064 leaves `buy_discord_posted=False` while `post_entry_embed=True`, so `TradeLifecycleTracker.register()` is skipped â€” the trade is never tracked, never managed, never exited. **Fix:** decouple "did the embed post" from "should we register lifecycle"; register whenever `is_entry_attempt` is True and the trade is journal-confirmed.

4. **`desk_entry.py :: maybe_emit_desk_entry` â€” unreachable WATCH guard fires BUY tickets unconditionally.** The `if route.mode == 'watch' and decision.eligible` block sits inside the `elif route.mode in ('starter','full')` arm, so it is logically impossible; `post_structure_event()` then fires a BUY ticket even when the pretrade-watch decision was not eligible. **Fix:** restructure so the WATCH decision is checked before the BUY, or remove the dead inner block.

---

## 3. High-Priority Risks

Twenty-three findings rated `high`, grouped by theme.

### 3.1 Trade-logic safety & risk-rail bypass
- **`entry_risk.py :: evaluate_entry_risk`** â€” master kill-switch flag disables all hard blocks (see Â§2.1).
- **`entry_routing.py :: classify_entry`** â€” A+ conflict override skips `evaluate_entry_risk()` (see Â§2.2).
- **`trade_lifecycle.py :: tick_async`** â€” after an ADD-leg `LifecycleAlert` fires, `continue` skips the anchor's stale-data gate, VIX check, premium ladder, and `_tick_one_trade()`; on a fast sell-off the anchor can trade through its stop by a full tick. **Fix:** fall through to evaluate `confirmed_stop_hit()` for the anchor before `continue`.
- **`trade_lifecycle.py :: _tick_one_trade`** â€” `mfe_pts`/`mae_pts` updated twice per tick (once in `tick_async._update_excursion()`, again at lines 919â€“924), compounding excursion within a single tick and risking an early two-strike reset. **Fix:** remove the duplicate update.

### 3.2 Trade tracking / alert delivery integrity
- **`alerts.py :: post_structure_event`** â€” silent RTH drop skips lifecycle registration (see Â§2.3).
- **`alerts.py :: post_structure_event`** â€” double-gating on `discord_alerts_allowed_now()`: captured once at line 512 and re-checked inside `send_discord_alert()`; a session roll between the two silently drops the BUY with the function still returning True. **Fix:** single gate, propagate result to callers.
- **`desk_entry.py :: maybe_emit_desk_entry`** â€” unreachable WATCH guard fires unconditional BUY (see Â§2.4).

### 3.3 Signal scoring correctness
- **`confluence.py :: score_event`** â€” negative GEX awards a flat **+14** unconditionally (the single largest award in the scorer) on any non-LEVEL_KINDS event when `eff_gex < 0`, with no magnitude floor; a marginally-negative GEX gets the same +14 as extreme negative GEX, dominating marginal setups into A/A+. **Fix:** tier the award by GEX magnitude.
- **`confluence.py :: score_event`** â€” double-scoring of VIX change: `state.vix_change_pct` is scored inline (lines 940â€“946) AND `_score_vix_term()` (lines 948â€“953) scores `vix.spot_change_pct` again; the same move can swing up to 10 pts twice. **Fix:** gate the inline block on `state.vix_term` being unloaded, or consolidate into `_score_vix_term()`.
- **`thesis_break.py :: thesis_loss_threshold_pts`** â€” the `min(flat, stop_width*0.25)` formula floored at 1.0 pt makes tight-stop trades exit prematurely on normal whipsaw (3pt stop â†’ 0.75 â†’ floored 1.0pt). **Fix:** use a proportional formula or floor at `flat` for narrow stops.
- **`chop_guard.py :: _close_was_loss / record_close`** â€” a `target_hit` trade with `premium_pnl_pct=None` falls through to the `unrealized_pts` branch and can be miscounted as a whipsaw loss, triggering a false sit-out lockout on a winning session. **Fix:** return False immediately for `target_hit`/`target_runner` when premium pnl is unknown.

### 3.4 Market-structure / level integrity
- **`sr_events.py :: SrLevelTracker.evaluate`** â€” `broken_up`/`broken_down` flags are never cleared; stale `_LevelTrack` entries (keyed on label+price) accumulate as ghost entries and emit spurious RETEST-instead-of-TEST events. **Fix:** add TTL/session-reset eviction of tags absent from the current level list.
- **`sr_events.py :: SrLevelTracker.evaluate`** â€” `_EXCLUDED_LABELS` levels (PDH/PDL/PDC/VWAP/ORB/ONH/ONL/HOD/LOD/POC/VAL/VAH) are silently skipped; a renamed/alternate-path label causes double-pinging (SR tracker + structure ping system). **Fix:** assert/log when an excluded-substring label reaches `_watched_levels()`.
- **`sr_ping_dedup.py :: should_post_sr_ping`** â€” dedup state is a process-wide module-level `_recent` list; broken across multi-process shards, and stale across sessions if `reset_session()` is not called. **Fix:** move dedup into the `SrLevelTracker` instance or a shared cache (Redis) for multi-process.
- **`htf_levels.py :: compute_htf_ranges`** â€” "prior week"/"prior month" are rolling 5/21-session windows but surfaced as `PWH/PWL`/`PMH/PML`, which users read as calendar week/month. On Mondays/post-holiday the window spans two calendar weeks. **Fix:** rename to "5-day/21-day" or snap to true boundaries.

### 3.5 Indicator math correctness
- **`indicators.py :: atr`** â€” ATR uses a simple SMA of true ranges, not Wilder's RMA; over-reacts to spikes and mismatches TradingView, mispricing `stop_width_pts` and `expected_move_pts` in `atr_desk.py`. **Fix:** implement Wilder smoothing.
- **`breadth.py :: load_breadth_snapshot / _mcclellan_from_diffs`** â€” McClellan is computed on a 40-name large-cap sample, not full NYSE A/D; the 39-point warmup boundary is too tight for stable EMA19/EMA39. **Fix:** document as large-cap proxy, raise warmup to â‰¥60 bars, source real NYSE A/D.
- **`vwap_proxy.py :: load_spx_vwap_from_proxy`** â€” SPYâ†’SPX VWAP uses a single point-in-time price ratio applied to a time-weighted average, drifting several points on volatile days; also silently returns None when `method != 'volume'`. **Fix:** bar-by-bar ratio conversion; log the proxy fallback.

### 3.6 Options / chain data integrity
- **`uw_options.py :: _fetch_chain_snapshot`** â€” module-level `_CHAIN_CACHE` keyed on `(ticker, expiry)` is never invalidated on date rollover; a process running past midnight or a mid-session restart can serve a prior-expiry chain to a new 0DTE session. **Fix:** add a fetch-date field and invalidate on date change, or clear on session reset.
- **`uw_options.py :: _polygon_chain_to_uw_rows`** â€” greek-row dedup by strike is order-dependent (SPX vs SPXW); the SPXW preference (`_prefer_contract_row`) is not applied to the greek index, so a selected SPXW contract can carry an SPX-root delta. **Fix:** apply SPXW preference to the greek dedup pass.
- **`options_plan.py :: pick_primary_strike_from_chain`** â€” contracts with no greek row are rejected as `no_delta`; when spot is 0.0 at snapshot time synthetic BS delta is never generated, so the function returns None for all contracts and falls back to ATM/OTM, bypassing the delta band entirely. **Fix:** always propagate spot to the snapshot; WARN when >50% of contracts reject on `no_delta`.
- **`dark_pool_desk.py :: load_dark_pool_snapshot`** â€” "today" filter uses naive string containment (`today not in exec_at`); a different date format (epoch int fallback) silently passes or drops all rows. **Fix:** parse `exec_at` to a datetime and compare dates.

### 3.7 Data-feed reliability (WebSocket)
- **`polygon_stream.py :: run_index_ws_loop`** â€” no auth-success confirmation before processing bars; `auth_success` only prints while bar processing begins immediately, so a bad key can process wrong-session bars or silently emit nothing. **Fix:** await an auth event before subscribe, or gate on an `_authenticated` flag.
- **`polygon_stream.py :: run_index_ws_loop`** â€” **data loss on reconnect**: no historical back-fill after a WS drop; bars that closed during the outage never enter `bar_store`, creating silent OHLCV gaps that corrupt every downstream indicator. **Fix:** call `fetch_index_minute_bars()` for the gap window and merge before resuming.
- **`polygon_stream.py :: _bar_from_am`** â€” timestamp ambiguity: resolves `s` â†’ `e` â†’ `t`; when `s` is absent the bar is tagged with end-ms, causing off-by-one-bar alignment downstream. **Fix:** pin to `s` (bar-start) and validate.

### 3.8 AI / analytics measurement integrity
- **`ai_mentor.py :: _fetch_live_enrichment`** â€” a top-level except swallows all enrichment failures; if `polygon_client`/`unusual_whales` is unavailable the mentor silently loses all live context for research/explain/debate with no Discord notice. **Fix:** log per-task failures; surface a warning in the response.
- **`ai_mentor.py :: _call_mentor`** â€” `SPX_AI_MENTOR_TIMEOUT_SEC` may be shorter than enrichment + inference at peak; failure messages cannot distinguish timeout vs missing key vs model error. **Fix:** distinguish failure classes; fall back to plain-text desk snapshot on timeout.
- **`attribution.py :: build_attribution_from_rows / _options_result`** â€” options win/loss relies solely on `options_pnl_pct` sign; manually managed trades leave it null, silently understating options performance with no flag. **Fix:** warn when `total_options_scored < 20%` of index closes.
- **`eod_outcomes.py :: run_eod_outcomes`** â€” WATCH MFE/MAE start is `last_at` (last refresh) not first fire, flattering never-confirmed WATCHes by measuring from a closer price and skewing the 15-day review. **Fix:** use `created_at`/`first_fired_at`.
- **`eod_outcomes.py :: run_eod_outcomes`** â€” entry MFE start is `inserted_at` (DB insert), which lags the alert under load and understates MFE. **Fix:** use `outcome_json.opened_at`.

---

## 4. Medium / Low Issues

Consolidated by subsystem.

### Core Engine (`engine.py`, `session.py`, `events.py`, `bar_store.py`, `calendar_gate.py`, `time_rules.py`)
- **[M]** `poll_once` reloads ALL session bars every tick (`_load_spx_session_bars`, lines 1460â€“1464) â€” fully redundant when WS is active (~1,560 redundant full-bar fetches/day at 15s). Skip when `SPX_SCALPER_WS_ENABLED`.
- **[M]** `_refresh_uw_context()` runs many awaitable network calls *inside* `_session_tick_lock` (line 1471), blocking concurrent `handle_bar()` WS ingest for the full refresh. Refresh outside the lock, write back inside.
- **[M]** `_maybe_roll_session` â€” GTH session-date vs `_session_day` race can load stale prior-segment bars without a roll. Reconcile anchors in `bootstrap()`.
- **[M]** `bootstrap` prior_day fallback (lines 810â€“819) can assign today's partial daily bar as prior-day, overstating prior-day H/L all session.
- **[M]** `session.py :: update_snapshot` extends HOD/LOD from snapshot price even when `bar_count > 0`; out-of-sequence snapshot vs WS bar can corrupt range.
- **[M]** `session.py :: ingest_bar` â€” `ts=0` bars pass dedup and advance `bar_count` without updating `last_bar_ts`, breaking all future dedup. Guard `if ts==0 and bar_count>0: return False`.
- **[M]** `_refresh_market_tide` hardcodes 300.0s instead of a config knob.
- **[M]** `events.py :: evaluate` â€” `_pretrade_watch`/`_heads_up` lazily initialized; if `evaluate()` never runs before `reset_session()`, instance cooldown state is never reset. Initialize eagerly in `__init__`.
- **[M]** `bar_store.py :: resample` buckets by `(t // bucket_ms)*bucket_ms`; cross-session/segment bars at boundaries merge into one candle (GTH). Filter to `session_start_ms`.
- **[L]** `calendar_gate.py :: is_high_vol_day` â€” no built-in market-holiday awareness; relies entirely on `SPX_HIGH_VOL_DATES`. Warn on startup if empty while hard macro blocks enabled.
- **[L]** `engine.py :: run` finally block cancels tasks without awaiting; add `await asyncio.gather(*tasks, return_exceptions=True)`.
- **[L]** `time_rules.py :: evaluate_entry_time_gate` â€” duplicate after-2:30 check at line 182 is unreachable dead logic.

### Entry & Exit Logic
- **[M]** `entry_gate.py :: allow_buy` â€” directional re-entry lock (`_loss_until`) not overridable by grade; a genuine A+ reversal is blocked with no manual clear short of restart.
- **[M]** `trade_lifecycle.py :: on_structure_event` â€” no staleness check; a stale-price structure alert can force a SELL. Add `spx_bar_data_stale()` guard.
- **[M]** `trade_lifecycle.py :: flatten_all` â€” mutates `_open` mid-coroutine if called from another coroutine between `tick_async` awaits. Add an `asyncio.Lock`.
- **[M]** `position_policy.py :: evaluate_position_policy` â€” `watch_instead=True` is not enforced inside the policy; relies on caller honoring it. Return `allow_entry=False` for all block reasons.
- **[L]** `trade_lifecycle.py :: register` â€” ADD leg inherits a breakeven-adjusted anchor stop, risking inverted risk and a silent `ValueError` refusal. Use original anchor stop or recompute.
- **[L]** `aggressive_entry.py :: refresh_aggressive_mtf_state` â€” MTF timeout only checked in `tick_async`; if ticks stall the tighter stop is never applied.
- **[L]** `kill_switches.py :: evaluate_kill_switches` â€” `event=None` produces `bias=0` â†’ always `hard_block=True`, making the wrapper useless as a standalone check. Deprecate or require real event.

### Signal Scoring & Confluence
- **[M]** `confluence.py :: _score_obv` â€” OBV only scored for 3 bullish/3 bearish kinds; ignored for PDH_BREAK, GEX_KING_BREAK_UP, EMA/ICT events.
- **[M]** `divergence.py :: _signal_from_spread` â€” Â±0.12% threshold hardcoded, not VIX-adaptive.
- **[M]** `harmonics.py :: nearest_harmonic` â€” unconditional `patterns[-1]` fallback when price is outside all PRZ; future callers forgetting `at_prz` apply bias at wrong prices.
- **[M]** `trend_day.py :: classify_day_type` â€” near-passthrough of `chart.regime`; over-applies +6 trend bonus if regime is loose/stale.
- **[M]** `move_runway.py :: _pick_extended_level` â€” effective cap is `max_pts + 5` not `max_pts`; runner target silently exceeds config.
- **[M]** `score_calibration.py :: score_has_predictive_edge` â€” compares only 85+ vs 50â€“69 bands; never gates live scoring.
- **[L]** `chop_guard.py :: chop_structure_block_reason` â€” `_CHOP_FADE_KINDS` misses ICT sweeps, EMA crosses, RSI extremes.
- **[L]** `watch_invalidation.py :: event_invalidates_watch` â€” `SPX_TRADE_EXIT_MIN_MINUTES` guard ignores fast 0DTE reversals within the window.
- **[L]** `confluence.py :: _score_fib_levels` â€” 50% level awards +5 for both biases; `fib_session` + `fib_prior` can double-count up to +10.

### Market Structure Layer
- **[M]** `levels.py :: _dedupe_levels` â€” fixed 1.5pt separation with no priority; a low-significance level can displace PDH/VWAP. Add priority ranking.
- **[M]** `sr_events.py :: evaluate` â€” `broken_down` cleared on SUPPORT_FAIL but `broken_up` never cleared on resistance reclaim; asymmetric, level stuck in `broken_up`.
- **[M]** `ict.py :: detect_fvgs` â€” fill detection uses only `last_close` (not bar high/low); filled FVGs never pruned; O(N) rescan each tick.
- **[M]** `wyckoff.py :: analyze_wyckoff` â€” spring threshold `tol*0.3` (~0.5â€“0.7pt) too loose, fires on noise wicks; no volume confirmation.
- **[M]** `opening_range_desk.py :: build_opening_range_desk` â€” returns `loaded=True` premature OR before the window closes; no `is_complete` flag.
- **[M]** `candles.py :: detect_patterns` â€” hardcoded body/range ratios with no ATR normalization; doji and pin-bar conditions not mutually exclusive.
- **[L]** `structure_phase.py :: structure_phase` â€” second reversal branch fires when `val is None`, producing spurious reversal on partially-loaded VA. Guard on `val is not None`.
- **[L]** `sr_events.py :: evaluate` â€” `touch_count` can climb to misleading "Retest #7"; cap at ~4 and reset peaked/troughed flags per touch.

### Indicators & Desk Analytics
- **[M]** `ema_desk.py :: build_ema_desk` â€” desk reports `loaded=True` (needs only 50 bars) while EMA200(5m) silently absent (needs 1000 min). Add `ema200_loaded`.
- **[M]** `gamma_desk.py :: compute_gamma_flip_level` â€” linear interpolation over 25pt strike gaps yields false-precision flip; all-positive/all-negative GEX mislabeled "neutral".
- **[M]** `iv_desk.py :: load_vix_history_closes` â€” API limit `min(lookback+10,300)=262` < 252 trading days on holiday-heavy years; reversal of Polygon order risks inverting rising/falling trend.
- **[M]** `vix_term.py :: _term_structure` â€” two-point fallback contango threshold differs from three-point path; label flips based solely on whether a far symbol is configured.
- **[M]** `breadth.py :: load_breadth_snapshot` â€” A/D threshold Â±0.05% unnormalized; high-beta gaps (NVDA) dominate `ad_diff`; `tick_proxy` misleadingly named (not NYSE TICK).
- **[M]** `vp_desk.py :: detect_volume_nodes` â€” HVN uses AND of two conditions (`>=1.25Ã—mean` AND `>=hvn_ratioÃ—max`), often detecting zero HVNs. Use OR or add fallback.
- **[L]** `qqq_strength.py :: _signal_from_spread` â€” docstring promises `qqq_leading_up/_down` never emitted.
- **[L]** `vwap_desk.py :: compute_vwap_bands` â€” zero-sigma fallback yields ~1.5pt sigma â†’ 3pt 2Ïƒ band, triggering stretch confluences on trivial early-session moves.
- **[L]** `atr_desk.py :: build_atr_desk` â€” `bars_1m` fetched twice (lines 75â€“76 and after line 80); race risk. Fetch once and reuse.

### Options Flow & Derivatives
- **[M]** `dealer.py :: load_dealer_snapshot` â€” three sequential async calls with no per-call timeout/retry; no `fetched_at` staleness field.
- **[M]** `options_plan.py :: _chain_contract_passes` â€” synthesizes `bid = ask*0.92` when bid is None, faking ~8% spread and passing illiquid contracts. Treat missing bid as worst-case.
- **[M]** `option_greeks.py :: estimate_theta_per_hour` â€” heuristic extrinsic proxy not grounded in IV; over/under-warns. Use BS theta when IV available.
- **[M]** `strike_flow.py :: load_strike_flow` â€” sweep detection by substring match on `tags`/`alert_name`; also check `has_sweep` boolean.
- **[M]** `polygon_gex.py :: fetch_polygon_odte_rows` â€” weekend early-return with `spot=0.0` silently yields zero GEX everywhere. Use a sentinel/typed exception.
- **[L]** `uw_options.py :: fetch_live_bid_for_trade` â€” mutates `trade.option_symbol` in place as a side effect of a read-only fetch (line 987). Return the symbol instead.
- **[L]** `flow_0dte.py :: load_flow_0dte_snapshot` â€” bare `except Exception` returns empty snapshot, masking auth/rate-limit/JSON errors. Classify and log.
- **[L]** `options_plan.py :: build_options_plan` â€” playbook 40pt acceptance radius unscaled to SPX level; non-0DTE expiry label may not parse in `resolve_expiry_iso`.

### Data Feeds & API Layer
- **[M]** `polygon_stream.py :: run_index_ws_loop` â€” backoff resets to 5s after WS create (not after a healthy message); auth failure loops every 5s forever. Reset after `auth_success`.
- **[M]** `data_freshness.py :: gex_data_fresh` â€” `loaded==True` masks missing timestamp; session-start dealer object passes freshness at 15:59. Treat missing timestamp as stale.
- **[M]** `data_freshness.py :: spx_bar_data_stale` â€” default `SPX_BAR_STALE_MAX_SEC=0` disables bar-staleness protection silently. Set safe default 150 in config.
- **[M]** `polygon_client.py :: fetch_options_chain_snapshot` â€” pagination (up to 5 pages) has no inter-page sleep; eats rate budget. Add 0.1â€“0.2s and honor Retry-After.
- **[M]** `polygon_client.py :: _get` â€” new `aiohttp.ClientSession` per call; no pooling, ephemeral-port exhaustion risk. Reuse a module-level session.
- **[M]** `evening_plays_data.py :: fetch_all_dossiers` â€” up to 560 simultaneous inflight requests bounded only by semaphores; 1s sleep is inter-batch only.
- **[L]** `polygon_stream.py :: _parse_ws_message` â€” silent `[]` on `JSONDecodeError`; log a truncated warning.
- **[L]** `snapshot_store.py :: persist_session_summary` â€” `limit=500` makes `first_snap` the 501st-oldest when pulses exceed 500. Fetch first/last separately.
- **[L]** `evening_plays_data.py :: fetch_ticker_dark_pool / fetch_ticker_oi_change` â€” call private underscore UW client paths; fragile to library updates.
- **[L]** `polygon_client.py :: fetch_index_minute_bars` â€” `limit=5000` silently truncates multi-day backfill ranges; add pagination or enforce single-day contract.

### AI Mentor & Analytics
- **[M]** `calibration_report.py :: maybe_post_daily_calibration` â€” read-only; never calls `build_gate_recommendations()`. Wire it in or add a "no auto-tuning" disclaimer.
- **[M]** `pulse_mentor.py :: generate_pulse_mentor` â€” Claude called every pulse with the main-alert timeout; a slow API blocks the dashboard loop. Add `SPX_CHART_PULSE_AI_TIMEOUT_SEC` + `asyncio.wait_for`.
- **[M]** `claude_brief.py :: generate_trade_mgmt_guide` â€” hardcodes config at module-load via f-string; `trade.stop=0` produces "index stop still 0.00". Guard `stop>0`; read config in-function.
- **[M]** `review_15d.py :: maybe_post_15d_review` â€” `w15/w30/w60` aliasing breaks under custom `SPX_EOD_OUTCOMES_WINDOWS_MIN`; threshold pick can be wrong.
- **[M]** `attribution.py :: _index_result` â€” `premium_trail` (a profitable runner exit) mapped to INDEX_LOSS, deflating win-rate for trailing strategies. Give it its own category.
- **[L]** `claude_brief.py :: generate_daily_desk_recap_brief` â€” raw `json.dumps(context)[:14000]` truncation can cut JSON mid-structure. Pre-truncate lists.
- **[L]** `ai_mentor.py :: build_desk_snapshot` â€” open-trades `unrealized_note` is a static string; Claude gets no actual P&L for hold/trim advice.
- **[L]** `journal.py :: journal_event` â€” claude_brief patched after insert; a crash between leaves null brief, no retry/backfill.

---

## 5. Dead Code Inventory

**Core Engine**
- `events.py :: _vwap_label()` â€” all non-proxy branches return identical 'VWAP'; only the ETF-proxy branch is non-trivial.
- `events.py :: hydrate_from_journal_kinds()` â€” pass-only stub branches for `VIX_TERM_FLIP` (line 215) and `FLOW_BIAS_FLIP` (line 217).
- `time_rules.py` â€” unreachable duplicate after-2:30 check at line 182.
- `session_anchor.py` â€” entire file (`current_session_date`, `engine_tick_allowed`, `discord_post_allowed`) is unimported one-liner wrappers (SP-01 abstraction never wired in).
- `engine.py` â€” `_refresh_nope()`, `_refresh_net_prem_ticks()`, `_refresh_flow_per_strike()`, `_refresh_vol_regime()` write `state.nope/net_prem_ticks/flow_per_strike/vol_regime`, none of which are read by any decision logic (data-collection stubs).

**Entry & Exit**
- `desk_entry.py` lines 500â€“519 â€” unreachable inner WATCH block (see Â§2.4).
- `trade_lifecycle.py` lines 919â€“924 â€” duplicate mfe/mae update.
- `entry_labels.py` â€” `_LIFECYCLE_SELL_REASONS['warning']` mapping never used (warning alerts use `action='watch'`).
- `trade_lifecycle.py` â€” `is_probe` field/asserts dead when add-leg premium exits are disabled.

**Signal Scoring**
- `direction_ladder.py :: index_moved_for_ladder` â€” legacy, called nowhere in scope.
- `harmonics.py :: _match_abcd` â€” `bullish` parameter accepted but never used.
- `chop_guard.py` â€” `structure_phase` import + `phase.name=='chop'` branch possibly unreachable (depends on `structure_phase` output; needs verification).

**Market Structure**
- `sr_events.py` â€” `was_above_after_break`/`was_below_after_break` set but never read (vestigial back-test state).
- `structure_pings.py` â€” `GEX_KING_TEST` listed twice in `STRUCTURE_PING_KINDS` frozenset (lines 42, 49) â€” copy-paste drift.
- `sr_ping_context.py :: mechanical_watch_line()` â€” no visible callers.

**Indicators**
- `qqq_strength.py` â€” `qqq_leading_up`/`qqq_leading_down` documented but never produced.
- `vwap_desk.py :: load_vwap_anchor_bars` â€” underused; convenience path silently collapses all three anchors to session bars.
- `gamma_desk.py :: fetch_uw_odte_king_strike` + `king_divergence_pts` â€” informational only, consumed by no confluence/gate logic.

**Options Flow**
- `premium_range.py` regex fallbacks (`_LIVE_BID_ASK_RE`, `_NET_DEBIT_RE`, `_MID_RE`, `_EST_RANGE_RE`) â€” effectively dead now that Polygon NBBO always populates structured fields.
- `options_marks.py :: primary_buy_ask()` â€” one-line wrapper, dead abstraction.
- `option_greeks.py :: entry_greeks_from_trade()` â€” exported but its only caller path is gated off when `SPX_OPEN_TRADE_GREEKS_ENABLED` is False, with no logging.

**Data Feeds**
- `analysis_snapshot.py :: compact_snapshot_for_prompt()` â€” no callers in audited scope.
- `evening_plays_data.py :: fetch_market_etf_tide()` â€” defined but not called from any dossier path.

**AI / Analytics**
- `daily_desk_recap.py` â€” **source file missing from disk** (only `.pyc` bytecode); orchestration wiring unauditable.
- `weekly_review.py` â€” **source file missing from disk** (only `.pyc`); the consumer of `attribution.build_gate_recommendations()` is gone.
- `ai_mentor.py :: format_mentor_embed` lines 357â€“359 â€” `title = f'{title}'` no-op (intended to append the question, does nothing).

---

## 6. Missing Features / Gaps

**Risk & safety rails**
- No per-bar kill-switch re-evaluation for OPEN trades â€” earnings/macro/daily-loss are only checked at entry; a CPI print mid-trade triggers no protective action.
- No intraday circuit breaker that *flattens* open positions when running P&L hits `SPX_HARD_DAILY_MAX_LOSS_PTS` (it only blocks new entries).
- No mid-trade option-spread check â€” `SPX_HARD_MAX_OPTION_SPREAD` gates entry only; a liquidity-event spread blowout mid-trade triggers nothing.
- No enforced max loss-per-trade in points beyond plan-build time; nothing prevents adverse stop movement or a gap blowing past the stop.
- No built-in US market-holiday calendar (`calendar_gate.py` depends entirely on `SPX_HIGH_VOL_DATES`).

**Data integrity**
- No WS reconnect bar-gap detection / REST gap-fill (`polygon_stream.py`).
- No proactive bar-arrival watchdog (staleness only checked at entry time).
- No bar dedup between REST seed and first WS bar.
- No subscribe-acknowledgment / symbol-rejection handling on the WS feed.
- GTH segment-boundary bars not filtered in `bar_store.resample()`.

**Scoring / structure**
- No calibration feedback loop â€” `score_calibration.py`/`calibration_report.py`/`review_15d.py` are display-only; nothing auto-tunes `SPX_FULL_ENTRY_MIN_SCORE` etc.
- No global chop score cap that pre-emptively reduces scores in detected sideways conditions before any losses occur.
- No independent trend-day confirmation beyond `chart.regime`.
- No harmonic/FVG freshness or staleness decay.
- No VIX/ATR-adaptive divergence threshold.
- Move-runway runner targets have no options liquidity/OI check at the strike.
- No time-of-day tightening of the thesis-break threshold.

**ICT / market structure completeness**
- No order-block, breaker-block, inducement, or FVG mitigation/partial-fill tracking (`ict.py` only does FVGs + BSL/SSL sweeps).
- No calendar-boundary HTF levels (rolling sessions only).
- No intraday rolling volume-profile recalculation.
- No multi-timeframe candle pattern aggregation (2 bars, single TF only).
- No Wyckoff phase-sequence validation (stateless per call).
- Gamma walls and ORB midpoint not added to the SR level list â€” never generate S/R pings.

**Options / derivatives**
- No vega tracking, no IV skew/term-structure signal (IV used only as a filter ceiling + synthetic delta).
- No intraday GEX decay detection â€” king node can be stale by afternoon; no scheduled intraday GEX re-fetch.
- No automatic dark-pool-supports-this-strike cross-reference.
- No conservative worst-case net-debit estimate when a spread short leg has no bid.

**Alerts / AI**
- No Discord message editing (`message.edit()`) â€” a posted BUY ticket cannot be updated with fill price or stop changes.
- No multi-channel routing by grade/type (single flat channel + analysis channel).
- No application-level rate-limit backoff/queue around `channel.send()`.
- No bot reconnection handling in `discord_bot_registry.py` (stale client reference after reconnect).
- Heads-up (`heads_up.py`) has no visible send path â€” feature appears incomplete.
- No Claude brief for kill-switch blocks (unlike `clock_block_brief`).
- Pulse mentor receives no open-trades/scorecard/time-gate context â€” cannot comment on trade management.
- No EOD-outcomes scheduler wiring visible (lost with `weekly_review.py`/`daily_desk_recap.py` source files).
- Attribution buckets don't split aggressive vs confirmed entry style.

---

## 7. Architecture Strengths

- **Dual-path ingestion with duplicate suppression** â€” WS primary, poll fallback; `SPX_SCALPER_WS_ENABLED` gates event emission from the poll path to avoid double-firing. Robust to feed loss.
- **Distributed leader-lock pattern** â€” `SPX_LEADER_LOCK_ENABLED` gates every Discord post, scorecard action, and GEX event; `_leader_renew_loop()` keeps followers warm for fast promotion. Multi-instance safe for output.
- **Warmup flag in `EventDetector`** â€” accumulates all bootstrap/replay state transitions but returns empty lists until `finish_warmup()`, preventing re-firing of pre-restart events.
- **Immutable frozen-dataclass desk snapshots** â€” every desk output is frozen, preventing accidental mutation and enabling safe sharing across async tasks.
- **Probabilistic, no-hard-gate desk design** â€” indicators return `(int, str)` confluence adjustments rather than binary blocks; only deliberate safety rails (earnings, macro, daily loss, spread) are hard.
- **Interpretable scoring** â€” flat additive base-50 model with a `CONTEXT_SCORE_CAP=10` keeping structural + flow signals primary over soft context; easy to reason about and audit.
- **Setup-continuity / origin-gated watch promotion** â€” `SetupContinuityTracker` + `_NON_PROMOTE_ORIGINS` frozenset explicitly prevent capacity/add/second-line/ladder watches from auto-promoting into losing positions when a slot opens. A strong anti-compounding guard.
- **Two-strike structure exit with confirmation buffers** â€” structure breaks require two confirmed opposing events; stops require breach by `SPX_TRADE_STOP_CONFIRM_PTS` (not a wick touch); theta time-stop respects open time. Reduces premature exits.
- **Data-staleness gate that pauses rather than force-closes** â€” `tick_async` pauses stop/target evaluation on stale data instead of firing wrong stops on stale prices.
- **Resilient options NBBO** â€” Polygon-first / UW-fallback on the latency-critical alert path; synthetic Black-Scholes delta when Polygon omits greeks; SPXW-over-SPX preference; delta-band-by-grade strike selection; GEX king used as a natural spread short-leg ceiling.
- **VWAP SPY-proxy and tick-proxy volume** â€” graceful degradation when Postgres or SPX index volume is unavailable, labeled transparently in the `method` field.
- **Journal-first, brief-second pattern** â€” DB row written before the Claude brief so no events are lost if Claude times out; snapshots persist even outside RTH for clean post-trade review.
- **Two-model AI architecture** â€” cheaper/faster model for high-frequency pulse/alert briefs, more capable model for interactive mentor.
- **Pulse change-delta suppression** â€” fingerprint + delta avoid Discord spam while keeping the dashboard embed fresh.
- **Consistent Talon embed formatting** â€” shared `talon_format.py` utilities give a uniform visual language across alert types.

---

## 8. Recommended Action Plan

Ordered by risk-reduction-per-effort. Phase 1 items are fix-now safety/correctness defects; later phases are reliability hardening and feature build-out.

**Phase 1 â€” Close the safety-rail bypasses (do first, small diffs, high impact)**
1. `entry_risk.py :: evaluate_entry_risk` â€” always enforce daily-loss cap and earnings/macro blocks regardless of `SPX_KILL_SWITCHES_ENABLED`; split the flag per-category.
2. `entry_routing.py :: classify_entry` â€” call `evaluate_entry_risk()` and gate on `hard_block` before the A+ conflict-override starter route.
3. `alerts.py :: post_structure_event` â€” decouple lifecycle registration from Discord send success; register whenever the entry is journal-confirmed. Remove the redundant outer `discord_alerts_allowed_now()` capture and propagate the send result.
4. `desk_entry.py :: maybe_emit_desk_entry` â€” fix the unreachable WATCH guard so BUY tickets do not fire when the watch decision is ineligible.
5. `trade_lifecycle.py` â€” remove the duplicate `mfe/mae` update (919â€“924); fall through to evaluate the anchor's `confirmed_stop_hit()` before `continue` after an ADD-leg exit.

**Phase 2 â€” Data-feed integrity (corrupted bars corrupt everything downstream)**
6. `polygon_stream.py` â€” add REST gap-fill on WS reconnect (`fetch_index_minute_bars` for the gap window + merge); gate bar processing on a confirmed `_authenticated` flag; pin bar timestamp to `s`; reset backoff only after `auth_success`; log `JSONDecodeError`.
7. `session.py :: ingest_bar` â€” guard `ts==0` bars; add REST/WS bar dedup.
8. `data_freshness.py` â€” set `SPX_BAR_STALE_MAX_SEC` default to 150 in `config.py`; treat missing GEX timestamp as stale.
9. Add a proactive bar-arrival watchdog (alert if no bar in >60s during RTH).

**Phase 3 â€” Indicator & scoring correctness**
10. `indicators.py :: atr` â€” replace SMA-of-TR with Wilder's RMA (fixes stop_width/expected_move pricing).
11. `confluence.py` â€” tier the negative-GEX +14 award by magnitude; eliminate VIX double-scoring; fix fib 50% double-bias and session/prior double-count.
12. `thesis_break.py :: thesis_loss_threshold_pts` â€” make the threshold proportional so tight stops don't exit on noise.
13. `chop_guard.py :: _close_was_loss` â€” treat unknown premium outcome on `target_hit` as non-loss to prevent false lockouts.
14. `uw_options.py` / `options_plan.py` â€” invalidate `_CHAIN_CACHE` on date rollover; apply SPXW preference to greek dedup; always propagate spot so synthetic delta generates; treat missing bid as illiquid (not `ask*0.92`).

**Phase 4 â€” Open-trade protection (currently entry-only)**
15. Add per-bar re-evaluation of hard blocks on OPEN trades (earnings/macro/daily-loss).
16. Add an intraday circuit breaker that flattens open positions when running P&L hits the daily max-loss cap.
17. Add a mid-trade option-spread blowout check with alert/force-flatten.
18. Add `spx_bar_data_stale()` guard to `on_structure_event` and an `asyncio.Lock` around `_open` mutations in `flatten_all`.

**Phase 5 â€” Engine hot-path & API efficiency**
19. `engine.py :: poll_once` â€” skip the full bar reload when WS is active; refresh `_refresh_uw_context()` outside `_session_tick_lock`.
20. `polygon_client.py` â€” reuse a module-level `aiohttp.ClientSession`; add inter-page pagination sleep + Retry-After handling.
21. `sectors.py` / `dealer.py` â€” parallelize sequential per-ETF / per-snapshot calls with `asyncio.gather`; add per-call timeouts and `fetched_at` staleness.
22. Add intraday GEX re-fetch so the king node doesn't go stale by afternoon.

**Phase 6 â€” Market-structure / SR hygiene**
23. `sr_events.py` â€” TTL/session-reset eviction of stale `_LevelTrack` tags; mirror the support-reclaim reset on the resistance side; cap `touch_count`.
24. `sr_ping_dedup.py` â€” move dedup into the tracker instance (or shared cache for multi-process).
25. `levels.py :: _dedupe_levels` â€” add level priority ranking so PDH/VWAP survive dedup.
26. `htf_levels.py` â€” rename rolling-window levels to "5-day/21-day" or snap to true calendar boundaries.
27. Add gamma walls and ORB midpoint to the level list so they generate S/R pings; add `is_complete` to the opening-range desk.

**Phase 7 â€” Analytics measurement fixes & feedback loop**
28. `eod_outcomes.py` â€” measure WATCH MFE/MAE from first fire (`created_at`) and entry MFE from `opened_at`, not `last_at`/`inserted_at`.
29. `attribution.py` â€” separate `premium_trail` from stop-outs; warn when options-scored coverage is low.
30. Wire `build_gate_recommendations()` into the calibration report (or add an explicit no-auto-tuning disclaimer); decide whether to build the calibration feedback loop that adjusts entry thresholds.
31. Restore the missing `weekly_review.py` and `daily_desk_recap.py` source files from bytecode and document the EOD scheduler wiring.

**Phase 8 â€” Alert/AI robustness & feature build-out**
32. `desk_briefings.py` â€” implement the pre-market dedup using the already-computed `already_key`; persist `_last_premarket_brief_date` across restarts.
33. `discord_channel.py` / `discord_bot_registry.py` â€” add channel caching, an `on_disconnect`/`on_connect` hook to refresh the bot reference, and wrap all `post_lifecycle_alert` sends in try/except.
34. `pulse_mentor.py` / `ai_mentor.py` â€” add a dedicated pulse-AI timeout with `asyncio.wait_for`; log per-task enrichment failures and distinguish timeout vs auth failures; feed open-trade P&L into the mentor snapshot.
35. Add Discord message editing for BUY tickets (fill price / stop updates) and `discord_play_alerts_only()` guard to `discord_entry_blocked_notice_enabled`.

**Phase 9 â€” Dead-code cleanup (low risk, do opportunistically)**
36. Remove confirmed dead code: `time_rules.py` line 182, `events.py :: _vwap_label` redundant branches, `desk_entry.py` 500â€“519, `trade_lifecycle.py` 919â€“924, `structure_pings.py` duplicate `GEX_KING_TEST`, `ai_mentor.py` no-op title, `options_marks.py :: primary_buy_ask`, `harmonics.py` unused `bullish` param. Decide whether to wire in or delete the data-collection stubs (`_refresh_nope`/`_refresh_net_prem_ticks`/`_refresh_flow_per_strike`/`_refresh_vol_regime`) and the unwired `session_anchor.py`.

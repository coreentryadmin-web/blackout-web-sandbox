# api-integration-audit — 2026-06-26

**07:11–07:25 PDT** · 7-agent doc-grounded deep pass (Polygon · Massive WS · Unusual Whales · Anthropic
· Clerk · Whop · Infra). First run in the isolated cron clone — no prior `API_INTEGRATION_MAP.md`
existed here, so created it fresh. Each agent WebFetched official docs + grepped actual usage.

## ✅ Fixed → main (`49cb17d`) — tsc + build both green
1. **Infra (P1)** `db.ts`: `statement_timeout` + `query_timeout` on the live PG Pool
   (`PG_STATEMENT_TIMEOUT_MS`, default 30s). A blocked/slow query can no longer pin a pooled
   connection and exhaust `max:5`. Evidence: live pool had no runtime statement_timeout (only transient
   during migration lock-wait). [node-postgres pool docs]
2. **Infra (P2)** `make-redis.ts`: `reconnectOnError` READONLY guard — forces reconnect+resend on a
   READONLY error (managed-tier/replica-promotion failover). No-op on single-node Railway Redis. [ioredis]
3. **Polygon (P2)** `polygon.ts`: `fetchIndexRsi` wrapped in try/catch → returns null like every other
   indicator getter; it was the only one calling `polygonGet` directly (which throws on non-OK).
4. **Massive (P0-latent)** `ws/options-socket.ts`: `OPTIONS_WS_MAX_CONNS` default **10 → 1**. Massive's
   documented default entitlement is ONE WS connection per asset class; opening a 2nd `/options`
   connection boots the first → reconnect storm the instant held contracts exceed one shard. Overflow
   degrades to the REST snapshot fallback. Latent today (NW marks gated off + <1000 contracts), removed
   the footgun. [massive.com WS connection-limits KB]
5. **Anthropic (P2)** `providers/anthropic.ts`: strip `temperature` for Opus-4.7+/Fable models (they 400
   on sampling params) so an `ANTHROPIC_MODEL` override to an Opus/Fable model doesn't 400 every call.
   Added `modelRejectsSamplingParams()`; applied at both the non-streaming + streaming-loop call sites.
   [model-migration docs]
6. **Whop (P2)** `webhook/whop/route.ts`: handle `membership.cancel_at_period_end_changed` (real-time
   grace re-sync instead of waiting for the hourly reconcile) + assert `event.company_id ===
   WHOP_COMPANY_ID` (defense-in-depth, ack-drop 200 on a definite mismatch). Verified the SDK union:
   `company_id` is on every event, all 3 membership events share `data: Shared.Membership`.

## ⚠️ Flagged for human review (TaskList #1–#9)
P1: Clerk user.* webhook + orphan cleanup (#1) · Whop durable revocation store (#2) · Whop webhook
idempotency (#3) · Largo prompt-cache invalidation (#4) · UW option_trades/gex WS adoption (#6) · UW
single-source halt SPOF (#7) · verify REPLICA_COUNT + Polygon RPS cap env (#8).
P2: Anthropic Batches API for overnight gen (#5) · GEX shares_per_contract multiplier (#9).

## 🛡️ Verified strengths (no action — do-not-regress)
- UW: all 5 WS channel names correct (NO bare-channel bug — confirmed vs OpenAPI op IDs); dedup/sort +
  `alerted_at`/`event_at` truth-handling; 429 single-count accounting; socket stall watchdog.
- Whop: Standard-Webhooks HMAC signature verification correct; missing-secret → 503-retry (not ack-drop).
- Clerk: tier resolution fails CLOSED on outage (never over-grants); no NEXT_PUBLIC secret leakage.
- Infra: prior CRITICAL (pg Pool missing `'error'` handler → replica crash) is RESOLVED + present.
- Anthropic: model IDs all current; streaming, structured outputs, kill-switch, typed errors all correct.
- `@whop/sdk 0.0.40` is the LATEST version (brief's "outdated" premise was wrong).

## ⚠️ Process caveat
The `git add -A` for the fix commit swept in another concurrent cron job's uncommitted working-tree work
(the `data-integrity` feature: `data-integrity-checks.ts`, the cron route, `railway.data-integrity.toml`,
`admin-incidents.ts`, `cron-registry.ts`, railway-monitor logs). All build + tsc green together, so the
combined push is additive and deploys cleanly — but next runs should stage explicit paths in this shared
clone, not `-A`. Documented per the shared-clone concurrency hazard.

## Stale-doc cleanup queued (in Task #6)
`docs/audit/API-DOCS/websockets.md:128,131` + `docs/audit/11-UW-DEEP.md:118-119` falsely document
`gex`/`net_flow` UW channels + `gexStore`/`netFlowStore` as in-use — they were removed from code.

**Net:** 6 fixes → main (build-gated), 9 gaps flagged, full provider map written to
`docs/API_INTEGRATION_MAP.md`. No P0 regressions. Integration backlog: 9 open (was untracked).

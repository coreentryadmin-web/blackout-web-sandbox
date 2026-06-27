# Whop API Audit
Last updated: 2026-06-27

Whop is the entire payment + access layer — every premium user's tier is resolved
through it. Source of truth for this audit is the installed SDK, `@whop/sdk@0.0.40`
(generated from Whop's OpenAPI spec), cross-checked against the public docs
(docs.whop.com). The SDK type surface is more complete than the docs site, so it is
treated as authoritative for the available-endpoint / available-event lists.

## Summary
- **REST resource methods available (relevant subset): ~30 / using: 3**
  (`members.list`, `memberships.list`, `webhooks.unwrap`)
- **Webhook events available: 37 / handling: 7**
- **Business risk gaps: 3** (payment.failed unhandled, dunning/invoice lifecycle
  unhandled, access resolved by full enumeration instead of `users.checkAccess`)

Our handling of the events we *do* cover is strong: signature verification via
`webhooks.unwrap` (Standard Webhooks scheme), Redis idempotency, company-id
defense-in-depth, fail-closed-on-stale, refund/dispute revocation denylist, and an
hourly reconcile cron as a bidirectional safety net. The gaps below are about
*coverage breadth*, not correctness of what is implemented.

---

## REST Endpoints

Only three SDK calls are made in the entire codebase. All entitlement resolution is
built on enumerating `members.list` + `memberships.list` per email.

| Method | Status | File:Line | Notes |
|---|---|---|---|
| `members.list` | **USED** | [membership.ts:52](src/lib/membership.ts) | Resolve Whop user IDs for an email (`company_id` + `query`) |
| `memberships.list` | **USED** | [membership.ts:108](src/lib/membership.ts), [membership.ts:233](src/lib/membership.ts) | List active/grace memberships per email and the reconcile discovery sweep |
| `webhooks.unwrap` | **USED** | [webhook/whop/route.ts:110](src/app/api/webhook/whop/route.ts) | Verify + decode incoming webhook |
| `users.checkAccess` | **UNUSED-VALUABLE** | — | Purpose-built access validation (user × accessId → bool). We instead enumerate all memberships per email — heavier, and the source of the `member:email:read` fragility (see risk gap #3). |
| `memberships.retrieve` | **UNUSED-VALUABLE** | — | Direct membership lookup by id. Would let the refund/dispute handler confirm a membership's owner/status by id instead of trusting the payload shape. |
| `payments.list` / `payments.retrieve` / `payments.listFees` | **UNUSED-VALUABLE** | — | Revenue / MRR / fee reporting. Today we have no programmatic revenue surface; an admin MRR/churn panel could be built on these. |
| `payments.refund` / `payments.void` / `payments.retry` | **UNUSED-LOW-PRIORITY** | — | Write ops (issue refund, retry a failed charge). Better handled in the Whop dashboard for now. |
| `memberships.cancel` / `.pause` / `.resume` / `.uncancel` / `.addFreeDays` | **UNUSED-LOW-PRIORITY** | — | Membership write ops. Could power in-app cancel/pause, but not needed pre-launch. |
| `plans.list` / `products.list` | **UNUSED-LOW-PRIORITY** | — | We hard-code product/plan IDs via env (`WHOP_*_PRODUCT_IDS` / `WHOP_*_PLAN_IDS`). Listing could validate the env config at boot, but env-driven is fine. |
| `disputes.submitEvidence` / `.updateEvidence` | **UNUSED-LOW-PRIORITY** | — | Chargeback evidence — dashboard workflow. |
| `invoices.*`, `users.update`, `companies.*`, `promo-codes.*`, `reviews.*`, `conversions.*`, plus the marketplace/social/ledger/payout/ads resources | **UNUSED-LOW-PRIORITY** | — | Out of scope for a trading SaaS access layer. |

---

## Webhook Events

The SDK `WebhookEvent` union defines **37** event types. We register a handler
branch for **7** of them. Everything else falls through to an implicit 200-ACK (no
processing).

Handlers live in [webhook/whop/route.ts:161-229](src/app/api/webhook/whop/route.ts).

| Event | Status | File:Line | Business Impact |
|---|---|---|---|
| `membership.activated` | **HANDLED** | [route.ts:163](src/app/api/webhook/whop/route.ts) | Re-sync → grant premium |
| `membership.deactivated` | **HANDLED** | [route.ts:164](src/app/api/webhook/whop/route.ts) | Re-sync → revoke premium |
| `membership.cancel_at_period_end_changed` | **HANDLED** | [route.ts:167](src/app/api/webhook/whop/route.ts) | Re-sync grace/canceling status in real time |
| `refund.created` | **HANDLED** | [route.ts:198](src/app/api/webhook/whop/route.ts) | Revoke membership (denylist) + re-sync |
| `refund.updated` | **HANDLED** | [route.ts:199](src/app/api/webhook/whop/route.ts) | Same |
| `dispute.created` | **HANDLED** | [route.ts:200](src/app/api/webhook/whop/route.ts) | Revoke on chargeback + re-sync |
| `dispute.updated` | **HANDLED** | [route.ts:201](src/app/api/webhook/whop/route.ts) | Same |
| `payment.failed` | **MISSING-RISK** | — | A recurring charge declined. No early signal — user keeps premium through the entire dunning window until `membership.deactivated` eventually fires (can be days/weeks). See risk gap #1. |
| `invoice.past_due` | **MISSING-RISK** | — | Subscription entered dunning. Invisible to us; no proactive "update your card" nudge. |
| `invoice.marked_uncollectible` / `invoice.voided` | **UNUSED-VALUABLE** | — | Terminal dunning states — the moment access *should* end. Today we wait for `membership.deactivated` + the hourly reconcile. |
| `payment.succeeded` / `payment.created` / `invoice.paid` | **UNUSED-LOW-PRIORITY** | — | Reactivation is already covered by `membership.activated` and our `past_due`/`canceling` grace statuses, so a paid invoice rarely needs separate handling. Useful only if we add revenue analytics. |
| `payment.pending` | **UNUSED-LOW-PRIORITY** | — | Transient state. |
| `dispute_alert.created` | **UNUSED-VALUABLE** | — | Pre-dispute early-warning from the processor — a chance to pre-emptively refund and avoid a chargeback fee before `dispute.created`. |
| `membership trial-ending` (docs list "Trial ending soon"; **not present in the installed SDK v0.0.40 union**) | **UNUSED-VALUABLE / VERIFY** | — | We do support trials (`trialing` ∈ `PREMIUM_MEMBERSHIP_STATUSES`, [whop.ts:9](src/lib/whop.ts)). If trials are ever offered, a trial-ending webhook is the prime conversion-nudge moment. The event is in the docs but absent from our SDK type union — verify in the Whop dashboard and consider upgrading `@whop/sdk`. |
| `setup_intent.*`, `withdrawal.*`, `payout_method.created`, `payout_account.status_updated`, `verification.succeeded`, `identity_profile.*`, `entry.*`, `resolution_center_case.*`, `course_lesson_interaction.completed` | **UNUSED-LOW-PRIORITY** | — | Marketplace / payout / KYC / community-content events irrelevant to our access layer. |

---

## Business Risk Gaps

### 1. `payment.failed` is not handled — access persists through dunning *(highest impact)*
When a renewing subscription's card is declined, Whop emits `payment.failed` and
moves the subscription into dunning, but the membership does **not** flip to
`deactivated` until the retry schedule is exhausted (days to weeks). During that
window the user keeps full premium. We have no handler and no early signal.

- **Mitigation today:** `membership.deactivated` + the hourly reconcile cron *do*
  eventually revoke, and `past_due` is a deliberate grace status (ops policy), so
  this is a *bounded* leak, not an indefinite one. But the grace is currently
  unbounded-until-deactivation and silent.
- **Why it matters:** revenue leak (premium served on a failed charge) + no
  opportunity to nudge the customer to fix their card before they churn.

### 2. Invoice/dunning lifecycle (`invoice.past_due`, `invoice.marked_uncollectible`, `invoice.voided`) unhandled
We treat `past_due` as premium-grace by status, but we never observe the dunning
*transitions*. We can't tell a healthy subscriber from one three failed-charges deep,
and we have no hook to send a "payment problem" email or to tighten the grace at the
`marked_uncollectible` terminal state.

### 3. Access resolved by full membership enumeration instead of `users.checkAccess`
Every tier resolution enumerates `members.list` + `memberships.list` per email and
reads `user.email` off each row. This is the root of the `member:email:read`
fragility that the code already defends against in three places ([membership.ts:118](src/lib/membership.ts),
[webhook/whop/route.ts:169-196](src/app/api/webhook/whop/route.ts)): if the Whop app
lacks `member:email:read`, `user.email` is null and sync silently breaks. The
purpose-built `users.checkAccess` (user × access target → boolean) sidesteps email
entirely and is cheaper. Not a live outage, but an architectural fragility worth
retiring.

---

## Implementation Recommendations
Ranked by business impact.

1. **Handle `payment.failed`** — add a branch that, on a failed renewal, records the
   dunning state and fires an ops/user alert (and optionally starts a *bounded* grace
   timer rather than waiting indefinitely for `membership.deactivated`). Lowest-effort,
   highest-leverage gap. Reuse the existing email-keyed `syncWhopMembershipForEmail`
   path + `notifyOpsDiscord` pattern already in the handler.

2. **Handle the invoice dunning lifecycle** (`invoice.past_due`,
   `invoice.marked_uncollectible`, `invoice.voided`) — gives a real "payment problem"
   signal and a deterministic point to end grace, instead of inferring everything from
   membership status.

3. **Add `dispute_alert.created`** — pre-dispute early warning; lets ops pre-emptively
   refund before eating a chargeback fee. Cheap to add alongside the existing
   refund/dispute branch.

4. **Migrate access validation to `users.checkAccess`** — removes the
   `member:email:read` single-point-of-fragility that three code paths currently work
   around. Architectural, not urgent.

5. **Confirm trial-ending support** — verify whether Whop emits a trial-ending webhook
   for this company and whether the installed `@whop/sdk@0.0.40` is current; if trials
   are offered, wire a conversion nudge. (Event is in the docs, absent from our SDK
   union — likely an SDK-version gap.)

6. **(Optional) Revenue surface from `payments.list`** — an admin MRR/churn panel.
   Nice-to-have, not a risk.

### Note on the safety net
The hourly `membership-reconcile` cron ([cron/membership-reconcile/route.ts](src/app/api/cron/membership-reconcile/route.ts))
self-heals both directions and is a genuinely strong backstop — but it keys on email
(same `member:email:read` dependency as #3) and runs hourly, so it does **not**
substitute for real-time `payment.failed` / dunning handling. Webhooks should remain
the primary signal; the cron is the net.

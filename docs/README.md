# BLACKOUT — Documentation (single source of truth)

**This `docs/` folder is the ONLY place BLACKOUT documentation lives.** Anything worth writing down
goes here — not scattered `.md` files at the repo root, not a second `audits/` pile, not inside a
`/docs/*` app route. If a doc isn't in here, it isn't canonical.

> **Policy going forward:** one folder, one source of truth. Don't create audit/plan/notes `.md`
> files elsewhere in the repo. Update the relevant file in here instead. Generated/data files that
> back app routes (e.g. `src/lib/api-provider-catalog.ts`) are **code**, not docs — they should be
> regenerated from `BLACKOUT_API_REFERENCE.md`, not hand-edited.

History: consolidated 2026-06-24. Older scattered audit piles were removed or moved to
[`archive/2026-06/`](archive/2026-06/) (recoverable from git history if ever needed).

---

## Index

### Start here
| File | What it is |
|---|---|
| [`ONBOARDING.md`](ONBOARDING.md) | **Engineering map** — product, code geography, data pipeline, APIs, crons, where to look. |
| [`NORTH_STAR.md`](NORTH_STAR.md) | Product goals and priority order (Truth > Reliability > Security > …). |
| [`audit/FINDINGS.md`](audit/FINDINGS.md) | Living issue log — severity, root cause, fix status. |
| [`api-audit/OPEN-ISSUES.md`](api-audit/OPEN-ISSUES.md) | Current known open bugs from autonomous audits. |

### API (canonical, docs-grounded)
| File | What it is |
|---|---|
| [`BLACKOUT_API_REFERENCE.md`](BLACKOUT_API_REFERENCE.md) | **Canonical API reference + rate-limit master plan.** |
| [`audit/API-DOCS/`](audit/API-DOCS/) | Per-surface doc-grounded detail: Massive + UW REST/WS. |

### Features & systems
| File | What it is |
|---|---|
| [`HEATMAP_DATA_CONTRACT.md`](HEATMAP_DATA_CONTRACT.md) | Canonical GEX/VEX dealer-positioning data contract. |
| [`NIGHTHAWK_GROUNDING.md`](NIGHTHAWK_GROUNDING.md) | Night Hawk edition grounding rules. |
| [`NIGHTS_WATCH.md`](NIGHTS_WATCH.md) | Night's Watch position manager. |

### Infrastructure & ops
| File | What it is |
|---|---|
| [`PGBOUNCER-SETUP.md`](PGBOUNCER-SETUP.md) | Postgres connection-pooling (PgBouncer) setup. |
| [`ops/`](ops/) | Runbooks — RTH open, deploy validation, ops auto-fix, [AWS migration](ops/AWS-MIGRATION-PLAN.md). |

### Archive (historical only)
| File | What it is |
|---|---|
| [`archive/2026-06/`](archive/2026-06/) | Pre-launch master audits, CEO/CTO reports, June deep-dives — **not maintained**. |

---

## Known follow-up (not yet done)
The internal **`/docs/*` app routes** (`cursor-api-analysis`, `claude-api-analysis`, `system-analysis`,
`spx-sniper/*-analysis`, `api-probe`, `polygon/*`, `unusual-whales/*`) and their backing data
(`cursor-api-analysis-data.ts`, `docs-probe-report.json`, `scripts/uw-docs-index.md`) are **stale
"analysis" pages** the audit flagged (IP-leak risk + ~7,500 LOC; `08-SECURITY.md`, priority R-24).
They are **code**, intertwined with the admin dashboard (`admin-endpoint-registry.ts` imports
`docs-probe-report.json`), so removing them is a careful refactor: decouple admin first, then delete
the routes/data. Tracked here so it isn't forgotten.

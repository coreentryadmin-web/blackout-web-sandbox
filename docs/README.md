# BLACKOUT — Documentation (single source of truth)

**This `docs/` folder is the ONLY place BLACKOUT documentation lives.** Anything worth writing down
goes here — not scattered `.md` files at the repo root, not a second `audits/` pile, not inside a
`/docs/*` app route. If a doc isn't in here, it isn't canonical.

> **Policy going forward:** one folder, one source of truth. Don't create audit/plan/notes `.md`
> files elsewhere in the repo. Update the relevant file in here instead. Generated/data files that
> back app routes (e.g. `src/lib/api-provider-catalog.ts`) are **code**, not docs — they should be
> regenerated from `BLACKOUT_API_REFERENCE.md`, not hand-edited.

History: consolidated 2026-06-24. The earlier scattered audit piles (`AUDIT.md`, `audits/`,
`complete-repo-bugs/`, `CURSOR_IMPL.md`) were stale/superseded by the audit below and were removed
(recoverable from git history if ever needed).

---

## Index

### Audit (pre-launch, ~500→5,000 users)
| File | What it is |
|---|---|
| [`BLACKOUT_FULL_AUDIT.md`](BLACKOUT_FULL_AUDIT.md) | **Master audit** (A–T): exec summary, architecture, inventories, consolidated security/scalability/bugs/UX, 50-item priority list, launch-readiness scorecard (68/100, GO-WITH-FIXES), 30/60/90 roadmap. |
| [`BLACKOUT_AUDIT_EXTENSION.md`](BLACKOUT_AUDIT_EXTENSION.md) | Extension: UW/Polygon/Claude deep-dives, cost model @500/1k/5k, Railway/infra, feature→data-source matrix, Technology Utilization Score, multi-tier scalability, full named scorecard (overall 67/100, D+). |
| [`audit/`](audit/) | **Full per-issue detail** per area (file path · code ref · why · severity · impact · fix · example): `00-RUNTIME-FINDINGS` (live-log evidence) + `01`–`17` (API, Frontend, Backend, DB/Redis, Cron, Auth, Tools, Security, Scalability, Product, UW, Polygon, Claude/cost, Infra, Features, Cost, Scale-tiers). |

### API (canonical, docs-grounded)
| File | What it is |
|---|---|
| [`BLACKOUT_API_REFERENCE.md`](BLACKOUT_API_REFERENCE.md) | **Canonical API reference + rate-limit master plan.** Massive (Stocks/Options/Indices Advanced) + Unusual Whales, read line-by-line from the official docs: used/unused tables, utilization %, top missed-data opportunities, and the 8-rule rate-limit plan mapped to incidents RT-1/2/5. Supersedes `api-provider-catalog.ts` + the `/docs/*` pages (regenerate those from here). |
| [`audit/API-DOCS/`](audit/API-DOCS/) | Per-surface doc-grounded detail: `massive-stocks`, `massive-options`, `massive-indices`, `uw-rest`, `websockets`. |

### Features & systems
| File | What it is |
|---|---|
| [`HEATMAP_DATA_CONTRACT.md`](HEATMAP_DATA_CONTRACT.md) | Canonical GEX/VEX dealer-positioning data contract — the one source every tool reads dealer positioning from. |

### Infrastructure
| File | What it is |
|---|---|
| [`PGBOUNCER-SETUP.md`](PGBOUNCER-SETUP.md) | Postgres connection-pooling (PgBouncer) setup — referenced by the audit's #1 scalability blocker. |

---

## Known follow-up (not yet done)
The internal **`/docs/*` app routes** (`cursor-api-analysis`, `claude-api-analysis`, `system-analysis`,
`spx-sniper/*-analysis`, `api-probe`, `polygon/*`, `unusual-whales/*`) and their backing data
(`cursor-api-analysis-data.ts`, `docs-probe-report.json`, `scripts/uw-docs-index.md`) are **stale
"analysis" pages** the audit flagged (IP-leak risk + ~7,500 LOC; `08-SECURITY.md`, priority R-24).
They are **code**, intertwined with the admin dashboard (`admin-endpoint-registry.ts` imports
`docs-probe-report.json`), so removing them is a careful refactor: decouple admin first, then delete
the routes/data. Tracked here so it isn't forgotten.

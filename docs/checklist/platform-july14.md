# Platform (Helix/Heatmap/NightHawk/Account/Infra) — checklist 2026-07-14
- [ ] Helix: live rows during RTH, valid timestamps, columns full width
- [ ] Heatmap: presets render + switch; SPX≈10×SPY cross-check
- [ ] Night Hawk: valid dates (held in #3/#4), plays render
- [ ] P0 personal-alerts 502: still failing? → escalate to Railway origin/connection-pool investigation (suspect PG connections)
- [ ] Hydration #418 on /dashboard: still firing? blank-desk manifestation?
- [ ] Redis/PG capacity: check Railway dashboard (Redis mem %, PG connections) after cap-100 first full day; PG retention job (prune >60d) — small task, not built
- [ ] CF chunk-race after deploys (#49/#51): no deploys during RTH; if any, purge + verify
- [ ] Member-QA sweep #5 mid-session; diff vs findings4

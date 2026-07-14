# Platform (Helix/Heatmap/NightHawk/Account/Infra) — checklist 2026-07-14
- [ ] Helix: live rows during RTH, valid timestamps, columns full width
- [ ] Heatmap: presets render + switch; SPX≈10×SPY cross-check
- [ ] Night Hawk: valid dates (held in #3/#4), plays render
- [ ] P0 personal-alerts 502: still failing? NOT connection exhaustion (staging RDS ~22 conns, CloudWatch 07-13) → pull the app service logs on AWS for the route's origin error
- [ ] Hydration #418 on /dashboard: still firing? blank-desk manifestation?
- [ ] Capacity via CloudWatch after cap-100 first full day (baselines 07-13: staging Redis t4g.micro mem 10%/CPU 5%/conns ~300; staging RDS t4g.micro CPU 11%/conns 22/free 17.6GB BUT freeable mem only ~100MB — upsize to t4g.small if <50MB; prod Redis 12% mem, prod RDS 28 conns) ; PG retention job (prune >60d) — small task, not built
- [ ] Purge stale Railway references from CLAUDE.md/AGENTS.md (infra is AWS: RDS + ElastiCache + Cognito; Railway era is over) — docs PR
- [ ] CF chunk-race after deploys (#49/#51): no deploys during RTH; if any, purge + verify
- [ ] Member-QA sweep #5 mid-session; diff vs findings4

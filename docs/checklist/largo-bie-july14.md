# Largo/BIE — validation checklist 2026-07-14
- [ ] 6-question battery during RTH: concept (charm), live read (SPX flip — must match Vector post-N4-1), per-ticker walls (TSLA), expected move, compound question, ops/self-diagnosis
- [ ] Answers grounded multi-part, no {{}}, no fabricated numbers, "unavailable" honesty on missing data
- [ ] N4-3 latency: flip question answers ≤15s (was >15s in #4) — if slow again, profile the read path
- [ ] Numeric accuracy vs Polygon/UW ground truth (data-validator.mjs run during RTH)

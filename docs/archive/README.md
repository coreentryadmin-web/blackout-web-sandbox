# Archive

Historical pre-AWS / pre-launch audit reports were removed from the tree in July 2026 to reduce
repo noise. Recover them from git history if needed:

```bash
git log --oneline -- docs/archive/2026-06/
git show <commit>:docs/archive/2026-06/README.md
```

Active documentation lives in the parent [`docs/`](../README.md) index — especially
[`audit/FINDINGS.md`](../audit/FINDINGS.md), [`api-audit/OPEN-ISSUES.md`](../api-audit/OPEN-ISSUES.md),
and [`ops/`](../ops/).

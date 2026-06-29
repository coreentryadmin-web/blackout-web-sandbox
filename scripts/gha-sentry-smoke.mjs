#!/usr/bin/env node
/** Optional Sentry dashboard smoke for GitHub Actions (token-only, no ORG env required). */
const token = process.env.SENTRY_AUTH_TOKEN?.trim() ?? "";
if (!token) {
  console.log("  ⚠ SENTRY_AUTH_TOKEN not set — skipping Sentry check");
  process.exit(0);
}

async function main() {
  const orgRes = await fetch("https://sentry.io/api/0/organizations/", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!orgRes.ok) {
    console.error(`  ✗ Sentry org API → HTTP ${orgRes.status}`);
    process.exit(1);
  }
  const orgs = await orgRes.json();
  if (!Array.isArray(orgs) || orgs.length === 0) {
    console.error("  ✗ Sentry token returned 0 organizations");
    process.exit(1);
  }
  const org = orgs[0];
  const issuesRes = await fetch(
    `https://sentry.io/api/0/organizations/${org.slug}/issues/?query=is:unresolved&limit=10&statsPeriod=24h`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!issuesRes.ok) {
    console.error(`  ✗ Sentry issues API → HTTP ${issuesRes.status}`);
    process.exit(1);
  }
  const issues = await issuesRes.json();
  console.log(`  ✓ Sentry token valid — org ${org.slug}, ${issues.length} unresolved in 24h sample`);
  if (issues.length > 0) {
    for (const i of issues.slice(0, 3)) {
      console.log(`      · ${(i.title ?? i.culprit ?? "issue").slice(0, 80)}`);
    }
  }
}

main().catch((e) => {
  console.error(`  ✗ Sentry check failed: ${e.message}`);
  process.exit(1);
});

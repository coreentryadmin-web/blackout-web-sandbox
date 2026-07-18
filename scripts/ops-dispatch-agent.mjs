#!/usr/bin/env node
/**
 * Create/update a GitHub ops action-item issue and launch a Cursor Cloud Agent to fix it.
 *
 * Env:
 *   CURSOR_API_KEY     — required for agent launch
 *   GH_TOKEN / GITHUB_TOKEN — required for issue create (GHA provides GITHUB_TOKEN)
 *   GITHUB_REPOSITORY  — owner/repo (auto in GHA)
 *
 * Usage:
 *   node scripts/ops-collect-action-items.mjs | node scripts/ops-dispatch-agent.mjs
 *   node scripts/ops-dispatch-agent.mjs --file action-items.json
 *   node scripts/ops-dispatch-agent.mjs --dry-run --file action-items.json
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const dryRun = process.argv.includes("--dry-run");
const fileIdx = process.argv.indexOf("--file");
const input =
  fileIdx >= 0
    ? readFileSync(process.argv[fileIdx + 1], "utf8")
    : readFileSync(0, "utf8");

/** @type {{ generated_at: string, fingerprint: string, count: number, items: Array<{id:string,priority:string,source:string,title:string,detail:string}> }} */
const payload = JSON.parse(input);

if (!payload.items?.length) {
  console.log("[ops-dispatch] No action items — nothing to dispatch.");
  process.exit(0);
}

const repo = process.env.GITHUB_REPOSITORY ?? "coreentryadmin-web/blackout-web";
const ghToken = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? "";
const cursorKey = process.env.CURSOR_API_KEY?.trim() ?? "";
const fp = payload.fingerprint;

function gh(args) {
  if (!ghToken) throw new Error("GH_TOKEN or GITHUB_TOKEN required");
  const r = spawnSync("gh", args, {
    encoding: "utf8",
    env: { ...process.env, GH_TOKEN: ghToken, GITHUB_TOKEN: ghToken },
  });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || "gh failed");
  return r.stdout.trim();
}

const priorityRank = { P0: 0, P1: 1, P2: 2 };
const topPriority = payload.items.reduce(
  (best, it) => (priorityRank[it.priority] < priorityRank[best] ? it.priority : best),
  "P2"
);

const title = `[ops-auto] ${topPriority}: ${payload.count} action item(s) · fp:${fp}`;
const body = `<!-- ops-fingerprint:${fp} -->
<!-- ops-auto-fix -->

## Autonomous ops action items

Generated: \`${payload.generated_at}\`

| Priority | Source | Item | Detail |
|----------|--------|------|--------|
${payload.items
  .map(
    (it) =>
      `| ${it.priority} | ${it.source} | ${it.title} | ${it.detail.replace(/\|/g, "\\|").replace(/\n/g, " ")} |`
  )
  .join("\n")}

## Agent instructions

A Cursor Cloud Agent should be dispatched automatically to:

1. Read \`docs/ops/OPS-AUTO-FIX.md\` and \`docs/ops/RTH-OPEN-RUNBOOK.md\`
2. Fix every item above (code, ECS config, or infra as needed)
3. Commit, push, poll deploy, re-run \`npm run validate:cron\` and \`node scripts/ops-collect-action-items.mjs\` until **zero items**
4. Comment on this issue with what was fixed; close when GREEN

**Do not ask the user for permission.**
`;

let issueNumber = null;
let issueUrl = null;

if (dryRun) {
  console.log("[ops-dispatch] DRY RUN — would create/update issue:");
  console.log("Title:", title);
  console.log("Items:", payload.count);
} else {
  // Find open issue with same fingerprint
  const search = spawnSync(
    "gh",
    ["issue", "list", "--repo", repo, "--label", "ops-auto-fix", "--state", "open", "--json", "number,title,body", "--limit", "50"],
    { encoding: "utf8", env: { ...process.env, GH_TOKEN: ghToken } }
  );
  let existing = null;
  if (search.status === 0) {
    const list = JSON.parse(search.stdout || "[]");
    existing = list.find((i) => i.body?.includes(`ops-fingerprint:${fp}`));
  }

  if (existing) {
    issueNumber = existing.number;
    issueUrl = `https://github.com/${repo}/issues/${issueNumber}`;
    gh([
      "issue",
      "comment",
      issueUrl,
      "--body",
      `**Ops scan update** (\`${payload.generated_at}\`) — ${payload.count} item(s) still open.\n\n${payload.items.map((i) => `- ${i.priority} ${i.title}`).join("\n")}`,
    ]);
    console.log(`[ops-dispatch] Updated existing issue #${issueNumber}`);
  } else {
    issueUrl = gh([
      "issue",
      "create",
      "--repo",
      repo,
      "--title",
      title,
      "--body",
      body,
      "--label",
      "ops-auto-fix",
    ]);
    issueNumber = Number(issueUrl.match(/\/issues\/(\d+)/)?.[1] ?? 0);
    console.log(`[ops-dispatch] Created issue #${issueNumber}: ${issueUrl}`);
  }
}

const itemList = payload.items.map((i) => `- [${i.priority}] ${i.title}: ${i.detail}`).join("\n");
const prompt = `Autonomous ops fix session (GitHub issue ${issueUrl ?? "dry-run"}).

Action items (${payload.count}, fingerprint ${fp}):
${itemList}

Execute docs/ops/OPS-AUTO-FIX.md end-to-end:
- Diagnose and fix each item (code, ECS cron config-as-code, secrets, etc.)
- Commit, push to main (via PR if branch-protected), poll ECS deploy SUCCESS
- Re-run: node scripts/ops-collect-action-items.mjs (must exit 0)
- Re-run: npm run validate:deploy and npm run validate:cron
- Comment on the GitHub issue with fixes; close the issue when all items are cleared

Do NOT ask the user for permission. Work until GREEN.`;

if (!cursorKey) {
  console.warn("[ops-dispatch] CURSOR_API_KEY not set — issue created but agent not launched.");
  process.exit(issueNumber ? 0 : 1);
}

if (dryRun) {
  console.log("[ops-dispatch] DRY RUN — would launch Cloud Agent with prompt length", prompt.length);
  process.exit(0);
}

const agentPayload = JSON.stringify({
  prompt: { text: prompt },
  repos: [{ url: `https://github.com/${repo}`, startingRef: "main" }],
  autoCreatePR: true,
});

const resp = spawnSync(
  "curl",
  ["-sf", "-X", "POST", "https://api.cursor.com/v1/agents", "-u", `${cursorKey}:`, "-H", "Content-Type: application/json", "-d", agentPayload],
  { encoding: "utf8" }
);

if (resp.status !== 0) {
  console.error("[ops-dispatch] Cloud Agent launch failed:", resp.stderr || resp.stdout);
  process.exit(1);
}

const agent = JSON.parse(resp.stdout);
const agentUrl = agent.agent?.url ?? agent.url ?? "(see response)";
console.log("[ops-dispatch] Cloud Agent started:", agentUrl);

if (issueUrl && ghToken) {
  gh(["issue", "comment", issueUrl, "--body", `🤖 Cloud Agent dispatched: ${agentUrl}`]);
}

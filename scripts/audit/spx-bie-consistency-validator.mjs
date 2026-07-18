#!/usr/bin/env node
/*
 * SPX Slayer <-> BIE/Largo correctness validator (task #124, docs/audit/FINDINGS.md).
 *
 * The user's standing instruction: "SPX slayer should be always sharing its
 * entire data, values, entire numericals to both BIE and largo and there
 * should be a validation also to check if all the data is 100% correct."
 * PR #471 wired EcosystemContext.spx_full_state and Largo's get_spx_play tool
 * to the SAME function (getSpxPlayState(), src/lib/platform/spx-service.ts) —
 * "one derivation, not two." This script is the validation half of that
 * instruction: it mechanically re-proves the wiring claim on every run
 * (Layer A, free/instant, no network) AND, where network access to a real
 * deployment + database is available, cross-checks the member dashboard's own
 * HTTP endpoint against a live call of the exact function BIE/Largo call
 * (Layer B), rather than trusting the source-reading once and never again.
 *
 * WHAT IT DOES
 *   Layer A — STATIC SOURCE-INVARIANT CHECKS (always run, zero network, zero cost):
 *     Reads the actual repo source and regex-asserts the call chain PR #471's
 *     own module doc claims is still true:
 *       ecosystem-context.ts::fetchSpxFullState() -> getSpxPlayState()
 *       run-tool.ts::"get_spx_play" -> marketPlatform.spx.getSpxPlayState()
 *       platform/index.ts: marketPlatform.spx IS spx-service.ts (same module)
 *       spx-evaluator.ts::readSpxPlaySnapshot() always uses {mutate:false} —
 *         no caller (member route, BIE, Largo) can ever flip this to a write.
 *     Also flags (WARN, not FAIL — see "KNOWN, DOCUMENTED TOLERANCE" below)
 *     two structural observations found while tracing this chain for task #124:
 *       (1) the member route (src/app/api/market/spx/play/route.ts) does NOT
 *           call getSpxPlayState() — it re-implements the same 3-call chain
 *           (loadMergedSpxDesk -> buildPlayTechnicals -> readSpxPlaySnapshot)
 *           inline instead of delegating to it. Harmless today (same pure
 *           chain, same shared desk cache lane -> same inputs -> same output),
 *           but nothing GUARANTEES the two copies stay in lockstep if either
 *           is edited alone in the future. Layer B's live diff is the
 *           regression net for this until/unless route.ts is refactored to
 *           call getSpxPlayState() directly (see FINDINGS.md for the fix
 *           recommendation — deliberately NOT applied by this validator PR,
 *           which is read-only/additive per its charter).
 *       (2) route.ts rounds its response with roundFloats() before replying;
 *           getSpxPlayState() (BIE's spx_full_state, Largo's get_spx_play)
 *           does not. So a member and BIE/Largo can see e.g. 7499.36 vs
 *           7499.360000000001 for the same underlying number — see the
 *           ROUND_TOLERANCE section below.
 *
 *   Layer B — LIVE CROSS-CONSISTENCY CHECK (needs a real deployment + DB/Redis/
 *   Polygon/UW network reachability — NOT available in this sandbox, see
 *   "SANDBOX LIMITATIONS"):
 *     1. Fetches the member-facing endpoint the SPX Slayer dashboard itself
 *        polls: GET /api/market/spx/play (cron-or-premium-tier gated).
 *     2. In the SAME process, imports src/lib/platform/spx-service.ts directly
 *        (via tsx, same "server-only" stub trick the test suite uses — see
 *        the KNOWN GOTCHA note below) and calls the REAL getSpxPlayState() —
 *        the literal function BIE's spx_full_state and Largo's get_spx_play
 *        tool call. This is a stronger ground truth than hitting an HTTP
 *        endpoint for the BIE/Largo side would be, because NO such endpoint
 *        exists (see SANDBOX LIMITATIONS) — this calls the exact same
 *        function object those two consumers call, not a re-implementation.
 *     3. Diffs every leaf field between the two payloads: non-numeric leaves
 *        (grade, direction, phase, action, gates.passed, gates.blocks, ...)
 *        must match EXACTLY; numeric leaves are compared within
 *        ROUND_TOLERANCE (see below) to account for the KNOWN roundFloats
 *        asymmetry, never silently widened beyond that. `as_of` is excluded
 *        from the generic diff and checked separately (the two calls run at
 *        different wall-clock instants by design).
 *
 *   Layer C — OPTIONAL Largo liveness smoke check (OFF by default — spends
 *   real Anthropic $ and is best-effort/non-deterministic; see
 *   AUDIT_INCLUDE_LARGO_LIVE_CHECK below and "SANDBOX LIMITATIONS").
 *
 * KNOWN, DOCUMENTED TOLERANCE (flagged explicitly per task #124's own
 * instructions — never hidden):
 *   src/lib/round-floats.ts's roundFloats(value, dp=2) rounds to 2 decimal
 *   places. route.ts applies it; getSpxPlayState() does not (see Layer A #2
 *   above). The maximum legitimate divergence this can introduce on any single
 *   numeric field is half a rounding step: 0.5 * 10^-2 = 0.005. ROUND_TOLERANCE
 *   below is exactly that value, applied uniformly to every numeric leaf in
 *   Layer B's diff — not a looser "close enough" fudge factor. Any numeric
 *   divergence LARGER than this is a real FAIL, not rounding noise.
 *
 * KNOWN GOTCHA (see src/lib/bie/ecosystem-context.test.ts and
 * src/lib/providers/spx-signal-log-shadow.test.ts): spx-service.ts's import
 * chain reaches spx-evaluator.ts, which does `import "server-only"` — a
 * marker package that THROWS unconditionally outside a Next.js server bundle.
 * node:test's experimental module-mocking (`node --experimental-test-module-
 * mocks`) stubs it out before the dynamic import, exactly like the test suite
 * already does. This works in a plain script too (verified empirically for
 * this task), not just under `node --test`.
 *
 * SANDBOX LIMITATIONS (this cloud sandbox specifically — see CLAUDE.md):
 *   - Layer B's in-process getSpxPlayState() call needs live Postgres/Redis/
 *     Polygon/UW network access. Direct Postgres (raw TCP) is blocked here
 *     (confirmed elsewhere in this audit — no SYN-ACK to the DB host), so
 *     Layer B SKIPs (not FAILs) with an explicit reason in this environment.
 *     It is written to run for real in a CI/ops context with normal network
 *     egress and the same env vars the ECS deployment itself uses
 *     (DATABASE_URL, REDIS_URL, POLYGON_API_KEY, POLYGON_API_BASE, UW_API_KEY).
 *   - There is NO existing HTTP endpoint that returns BIE's raw
 *     fetchEcosystemContext()/spx_full_state or Largo's raw get_spx_play tool
 *     result — both are internal server functions, reachable over HTTP only
 *     by (a) Largo's full AI conversation loop (/api/market/largo/query),
 *     which costs real Anthropic spend, is non-deterministic about whether/
 *     how it surfaces exact numbers, and does NOT return the raw tool-call
 *     JSON in its response body (confirmed by reading runLargoQuery's return
 *     type in src/lib/largo-terminal.ts — only {answer, tools_used,
 *     verification, ...}, never the captured tool results), or (b) adding a
 *     new debug/admin endpoint, which is out of scope for a read-only/
 *     additive validator task. Layer B works around this by calling
 *     getSpxPlayState() directly in-process instead (see above) — the
 *     strongest live proof achievable without adding new production surface
 *     area. Layer C (optional) exercises the real AI path for a liveness/
 *     wiring smoke check only, NOT a byte-for-byte diff.
 *
 * SECRETS — read from env ONLY (never hardcode / commit):
 *   CRON_SECRET   bearer token accepted by authorizeCronOrTierApi's cron branch
 *                 (src/lib/market-api-auth.ts) — simplest way to reach
 *                 /api/market/spx/play without minting a temp Clerk user.
 *                 If unset, Layer B's member-endpoint fetch SKIPs (not FAILs)
 *                 with instructions rather than failing silently.
 *   (Layer C only, opt-in) CLERK_SECRET_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY —
 *                 same temp-user flow as scripts/audit/data-validator.mjs,
 *                 factored into scripts/audit/lib/prod-clerk-session.mjs so
 *                 both scripts can share it without data-validator.mjs itself
 *                 being touched by this (additive-only) change.
 *
 * ENV (optional):
 *   AUDIT_APP_URL                     app base (default https://blackouttrades.com)
 *   AUDIT_OUT                         output dir for reports (default <cwd>/audit-output)
 *   AUDIT_DIRECT_CALL_TIMEOUT_MS      Layer B in-process call timeout (default 15000)
 *   AUDIT_INCLUDE_LARGO_LIVE_CHECK=1  opt-in Layer C (spends Anthropic $)
 *
 * Exits non-zero on any FAIL (SKIP/WARN/INFO never affect the exit code —
 * same contract as scripts/audit/data-validator.mjs).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mock } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");

const APP = process.env.AUDIT_APP_URL || "https://blackouttrades.com";
const OUT = process.env.AUDIT_OUT || join(process.cwd(), "audit-output");
const CRON_SECRET = process.env.CRON_SECRET || "";
const REDIS_URL = process.env.REDIS_URL || "";
const DATABASE_URL = process.env.DATABASE_URL || "";
const DIRECT_CALL_TIMEOUT_MS = Number(process.env.AUDIT_DIRECT_CALL_TIMEOUT_MS ?? 15000) || 15000;
const INCLUDE_LARGO_LIVE_CHECK = process.env.AUDIT_INCLUDE_LARGO_LIVE_CHECK === "1";

/** In-process getSpxPlayState() must share the prod `spx-play-read:*` Redis lane
 *  with the member HTTP route — otherwise a fresh local eval diverges from prod. */
function canShareProdPlayCacheLane() {
  return Boolean(REDIS_URL && DATABASE_URL);
}

// Must match src/lib/round-floats.ts's default `dp` argument exactly — this
// is NOT an arbitrary fudge factor, it's half of one rounding step at that
// precision, i.e. the largest divergence roundFloats(dp=2) can legitimately
// introduce on any single number. See the module doc's "KNOWN, DOCUMENTED
// TOLERANCE" section above.
const ROUND_DP = 2;
const ROUND_TOLERANCE = 0.5 * 10 ** -ROUND_DP;

mkdirSync(OUT, { recursive: true });

const checks = [];
const rec = (name, status, detail, extra = {}) => {
  checks.push({ name, status, detail, ...extra });
  console.log(`  [${status}] ${name}${detail ? " — " + detail : ""}`);
};

function readSrc(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), "utf8");
}

/** Depth-counts braces starting at `openBraceIndex` (which must point at a
 *  literal `{`) and returns the full balanced `{...}` block. A naive
 *  `[^}]*` regex breaks the instant a block contains ANY nested `{...}`
 *  (e.g. an inline options object like `{ mutate: false }` or
 *  `buildPlayTechnicals(price, { vwap, pdh, ... })`) — it silently stops at
 *  the first, wrong, closing brace, truncating the captured body and making
 *  every subsequent substring check fail (or worse, pass) for the wrong
 *  reason. This is deliberately a plain depth counter, not a real parser —
 *  good enough for the specific, simple functions this validator inspects
 *  (none of which contain string/template literals with unbalanced braces),
 *  not a general-purpose TS brace matcher. */
function extractBalancedBlock(src, openBraceIndex) {
  let depth = 0;
  for (let i = openBraceIndex; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(openBraceIndex, i + 1);
    }
  }
  return null;
}

/** Finds `headerRegex` — which must match up to AND INCLUDE the block's
 *  opening `{` — and returns the brace-balanced block it opens. */
function findBalancedBlock(src, headerRegex) {
  const m = src.match(headerRegex);
  if (!m) return null;
  const openBraceIndex = m.index + m[0].length - 1;
  if (src[openBraceIndex] !== "{") return null;
  return extractBalancedBlock(src, openBraceIndex);
}

async function fetchWithTimeout(url, opts, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Layer A — static source-invariant checks. Pure text inspection: no import,
// no network, no DB. Deliberately regex/substring based (not a TS parse) —
// simple enough to audit by eye, and a false negative here (pattern not
// found) is reported as its own FAIL rather than silently skipped, so a
// future refactor that changes these files' shape is forced to update this
// validator alongside the code, not silently go unchecked.
// ---------------------------------------------------------------------------
function staticInvariantChecks() {
  let ecosystemSrc, runToolSrc, platformIndexSrc, evaluatorSrc, routeSrc, spxServiceSrc;
  try {
    ecosystemSrc = readSrc("src/lib/bie/ecosystem-context.ts");
    runToolSrc = readSrc("src/lib/largo/run-tool.ts");
    platformIndexSrc = readSrc("src/lib/platform/index.ts");
    evaluatorSrc = readSrc("src/features/spx/lib/spx-evaluator.ts");
    routeSrc = readSrc("src/app/api/market/spx/play/route.ts");
    spxServiceSrc = readSrc("src/lib/platform/spx-service.ts");
  } catch (e) {
    rec("static: read source files", "FAIL", `could not read one of the traced files: ${e.message}`);
    return;
  }

  // 1. ecosystem-context.ts imports getSpxPlayState from platform/spx-service,
  //    and fetchSpxFullState() returns it verbatim (no field reconstruction).
  const importsGetSpxPlayState = /import\s*\{\s*getSpxPlayState\s*\}\s*from\s*["']@\/lib\/platform\/spx-service["']/.test(ecosystemSrc);
  const fetchSpxFullStateBlock = findBalancedBlock(ecosystemSrc, /async function fetchSpxFullState\(\)[^{]*\{/);
  const isVerbatimPassthrough = !!fetchSpxFullStateBlock && /return\s+getSpxPlayState\(\)\s*;/.test(fetchSpxFullStateBlock);
  rec(
    "static: ecosystem-context.ts imports getSpxPlayState from platform/spx-service",
    importsGetSpxPlayState ? "PASS" : "FAIL",
    importsGetSpxPlayState ? undefined : "import line not found — spx_full_state may no longer be sourced from spx-service.ts"
  );
  rec(
    "static: fetchSpxFullState() is a verbatim `return getSpxPlayState();` (no reconstruction)",
    isVerbatimPassthrough ? "PASS" : "FAIL",
    isVerbatimPassthrough ? undefined : "fetchSpxFullState()'s body no longer looks like a pure passthrough — re-verify spx_full_state can't silently drop/rebuild fields"
  );

  // 2. run-tool.ts's get_spx_play case calls marketPlatform.spx.getSpxPlayState().
  const getSpxPlayCaseBlock = findBalancedBlock(runToolSrc, /case\s*"get_spx_play":\s*\{/);
  const callsMarketPlatformSpx = !!getSpxPlayCaseBlock && /marketPlatform\.spx\.getSpxPlayState\(\)/.test(getSpxPlayCaseBlock);
  rec(
    "static: run-tool.ts's get_spx_play tool calls marketPlatform.spx.getSpxPlayState()",
    callsMarketPlatformSpx ? "PASS" : "FAIL",
    callsMarketPlatformSpx ? undefined : "get_spx_play case not found or no longer calls marketPlatform.spx.getSpxPlayState() — Largo's tool may have a second derivation"
  );

  // 3. marketPlatform.spx literally IS spx-service.ts (same module, not a
  //    re-export or wrapper) — otherwise check #2 would prove nothing.
  const spxIsSpxService = /import\s*\*\s*as\s*spx\s*from\s*["']\.\/spx-service["']/.test(platformIndexSrc) && /^\s*spx,/m.test(platformIndexSrc);
  rec(
    "static: marketPlatform.spx resolves to platform/spx-service.ts (same module ecosystem-context.ts imports)",
    spxIsSpxService ? "PASS" : "FAIL",
    spxIsSpxService ? undefined : "platform/index.ts no longer wires marketPlatform.spx directly to spx-service.ts — the 'one derivation, not two' claim may no longer hold"
  );

  // 4. readSpxPlaySnapshot() always evaluates read-only — no caller (member
  //    route, BIE, Largo) can flip this to a live write/Discord side effect.
  //    Checked two ways: the call site is a hardcoded `{ mutate: false }`
  //    literal, AND the function's own signature takes no options a caller
  //    could use to override it.
  const snapshotParams = evaluatorSrc.match(/export async function readSpxPlaySnapshot\(([^)]*)\)/);
  const hasNoMutateParam = !!snapshotParams && !/mutate/.test(snapshotParams[1]);
  const snapshotBlock = findBalancedBlock(evaluatorSrc, /export async function readSpxPlaySnapshot\([^)]*\)[^{]*\{/);
  const hardcodesMutateFalse = !!snapshotBlock && /evaluateSpxPlay\(\s*desk\s*,\s*technicals\s*,\s*\{\s*mutate:\s*false\s*\}\s*\)/.test(snapshotBlock);
  rec(
    "static: readSpxPlaySnapshot() hardcodes {mutate:false} with no caller-overridable option",
    hasNoMutateParam && hardcodesMutateFalse ? "PASS" : "FAIL",
    hasNoMutateParam && hardcodesMutateFalse
      ? undefined
      : "readSpxPlaySnapshot() either gained a mutate-like parameter or no longer hardcodes mutate:false — BIE/Largo/member reads could risk a live write"
  );

  // 5. (WARN, not FAIL) The member route re-implements getSpxPlayState()'s
  //    3-call chain inline instead of calling it. See module doc above.
  const routeCallsChain =
    /loadMergedSpxDesk\(\)/.test(routeSrc) && /buildPlayTechnicals\(/.test(routeSrc) && /readSpxPlaySnapshot\(/.test(routeSrc);
  const routeCallsGetSpxPlayState = /getSpxPlayState\(\)/.test(routeSrc);
  if (routeCallsChain && !routeCallsGetSpxPlayState) {
    rec(
      "static: member route.ts duplicates getSpxPlayState()'s chain instead of calling it",
      "WARN",
      "src/app/api/market/spx/play/route.ts re-implements loadMergedSpxDesk->buildPlayTechnicals->readSpxPlaySnapshot inline rather than calling getSpxPlayState() — harmless today (same pure chain, same shared desk cache lane) but not structurally guaranteed to stay in sync; see docs/audit/FINDINGS.md for the recommended (not-yet-applied) consolidation"
    );
  } else if (routeCallsGetSpxPlayState) {
    rec("static: member route.ts calls getSpxPlayState() directly", "PASS", "consolidation already applied — member, BIE, and Largo now share one call site, not a duplicated chain");
  } else {
    rec("static: member route.ts's derivation chain", "FAIL", "route.ts's play-state derivation no longer matches the expected loadMergedSpxDesk->buildPlayTechnicals->readSpxPlaySnapshot chain at all — re-trace this endpoint");
  }

  // 6. (WARN, not FAIL) roundFloats asymmetry — route.ts rounds, getSpxPlayState() doesn't.
  const routeRounds = /roundFloats\(\s*play\s*\)/.test(routeSrc);
  const getSpxPlayStateBlock = findBalancedBlock(spxServiceSrc, /export async function getSpxPlayState\(\)\s*\{/);
  const serviceRounds = !!getSpxPlayStateBlock && /roundFloats/.test(getSpxPlayStateBlock);
  if (routeRounds && !serviceRounds) {
    rec(
      "static: roundFloats asymmetry between member route and getSpxPlayState()",
      "WARN",
      `member route.ts applies roundFloats(play) before responding; getSpxPlayState() (BIE's spx_full_state, Largo's get_spx_play) does not — numeric fields can differ by up to ${ROUND_TOLERANCE} (half a ${ROUND_DP}dp rounding step). Documented, tolerated in Layer B's diff below — never silently hidden. See docs/audit/FINDINGS.md.`
    );
  } else if (routeRounds && serviceRounds) {
    rec("static: roundFloats asymmetry between member route and getSpxPlayState()", "PASS", "both sides now round — asymmetry resolved, ROUND_TOLERANCE is no longer expected to be exercised");
  } else {
    rec("static: roundFloats presence check", "WARN", `unexpected roundFloats wiring (route=${routeRounds}, service=${serviceRounds}) — re-verify by hand`);
  }
}

// ---------------------------------------------------------------------------
// Layer B — live cross-consistency check.
// ---------------------------------------------------------------------------

async function fetchMemberSpxPlay() {
  if (!CRON_SECRET) {
    return {
      skip: true,
      reason:
        "CRON_SECRET not set. /api/market/spx/play accepts either a cron bearer token (authorizeCronOrTierApi's cron branch, src/lib/market-api-auth.ts) or a signed-in premium user session. This validator only implements the cron path (no Clerk temp-user churn needed for a single GET) — set CRON_SECRET to exercise this check live, or extend this script with data-validator.mjs's Clerk sign-in flow if cron auth is unavailable in your environment.",
    };
  }
  try {
    const res = await fetchWithTimeout(
      `${APP}/api/market/spx/play`,
      { headers: { Authorization: `Bearer ${CRON_SECRET}`, Accept: "application/json" } },
      20000
    );
    if (!res.ok) return { skip: true, reason: `HTTP ${res.status} from ${APP}/api/market/spx/play` };
    const json = await res.json();
    if (json?.degraded) {
      return { skip: true, reason: "member endpoint returned its degraded fallback ({available:false, action:SCANNING, degraded:true}) — no live snapshot to diff this cycle, try again" };
    }
    return { skip: false, json };
  } catch (e) {
    return { skip: true, reason: `fetch failed: ${e.message}` };
  }
}

/** Calls the REAL getSpxPlayState() in-process — the literal function
 *  BIE's spx_full_state and Largo's get_spx_play tool call (see Layer A #2/#3
 *  above). Needs live DB/Redis/Polygon/UW network reachability; races a hard
 *  timeout so an unreachable DB (e.g. this sandbox — see SANDBOX LIMITATIONS)
 *  reports a clean SKIP instead of hanging the whole script. */
async function callGetSpxPlayStateDirect() {
  if (!canShareProdPlayCacheLane()) {
    return {
      skip: true,
      reason:
        "REDIS_URL and DATABASE_URL must both be set for in-process getSpxPlayState() to share the prod spx-play-read cache lane with /api/market/spx/play — without them, a fresh local eval will diverge from the deployed member route (grade/score/gates) even when the route correctly calls getSpxPlayState(). Cloud Agent sandboxes: rely on the prod double-fetch check below instead.",
    };
  }
  // Must run before the dynamic import below — see the module doc's "KNOWN
  // GOTCHA" section. mock.module() works outside `node --test` too (verified
  // for this task) as long as --experimental-test-module-mocks is passed.
  mock.module("server-only", { namedExports: {} });
  try {
    const mod = await import(join(REPO_ROOT, "src/lib/platform/spx-service.ts"));
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${DIRECT_CALL_TIMEOUT_MS}ms (likely no DB/Redis/Polygon/UW network egress in this environment)`)), DIRECT_CALL_TIMEOUT_MS)
    );
    const play = await Promise.race([mod.getSpxPlayState(), timeout]);
    // Round-trip through JSON so `undefined` optional fields (e.g.
    // open_play.option_label) drop out exactly like they do when the member
    // endpoint's own JSON.stringify serializes its response — an apples-to-
    // apples shape before Layer B's generic diff walks both objects.
    return { skip: false, json: JSON.parse(JSON.stringify(play)) };
  } catch (e) {
    return {
      skip: true,
      reason: `${e.message} — this call needs the same DATABASE_URL/REDIS_URL/POLYGON_API_KEY/POLYGON_API_BASE/UW_API_KEY network access the live ECS deployment has; see SANDBOX LIMITATIONS in this script's module doc.`,
    };
  }
}

/** Generic recursive diff: numeric leaves compared within `tolerance`,
 *  everything else (string/boolean/null/array-length/object-keys) compared
 *  exactly. Walks the UNION of keys at every object level so a field present
 *  on only one side is reported, not silently ignored. `as_of` is skipped —
 *  the two calls run at different wall-clock instants by design; checked
 *  separately by the caller. */
function diffTree(a, b, path, tolerance, out) {
  if (path === "as_of") return;
  if (typeof a === "number" && typeof b === "number") {
    const d = Math.abs(a - b);
    if (d > tolerance) out.push({ path, a, b, delta: d });
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      out.push({ path: `${path}.length`, a: a.length, b: b.length });
      return;
    }
    a.forEach((v, i) => diffTree(v, b[i], `${path}[${i}]`, tolerance, out));
    return;
  }
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      diffTree(a[k], b[k], path ? `${path}.${k}` : k, tolerance, out);
    }
    return;
  }
  // Treat null/undefined as equivalent (JSON round-trip already drops
  // `undefined`, but the member HTTP response was never anything but JSON).
  const aNil = a === null || a === undefined;
  const bNil = b === null || b === undefined;
  if (aNil && bNil) return;
  if (a !== b) out.push({ path, a, b });
}

/** When the sandbox cannot share prod Redis, prove member-route self-consistency
 *  by fetching the deployed endpoint twice in parallel (same cache window). */
async function prodMemberPlayDoubleFetchCheck() {
  if (!CRON_SECRET) {
    rec("live: prod member play double-fetch consistency", "SKIP", "CRON_SECRET not set");
    return;
  }
  const [a, b] = await Promise.all([fetchMemberSpxPlay(), fetchMemberSpxPlay()]);
  if (a.skip || b.skip) {
    rec("live: prod member play double-fetch consistency", "SKIP", a.reason || b.reason);
    return;
  }
  const diffs = [];
  diffTree(a.json, b.json, "", ROUND_TOLERANCE, diffs);
  if (diffs.length === 0) {
    rec(
      "live: prod member play double-fetch consistency",
      "PASS",
      `parallel fetches matched — grade=${a.json.grade} score=${a.json.score} action=${a.json.action}`
    );
    return;
  }
  for (const d of diffs.slice(0, 10)) {
    rec(`live: prod double-fetch FIELD MISMATCH ${d.path}`, "FAIL", JSON.stringify(d).slice(0, 200));
  }
  rec("live: prod member play double-fetch consistency", "FAIL", `${diffs.length} field(s) diverged between parallel prod fetches`);
}

async function liveCrossConsistencyCheck() {
  const [member, direct] = await Promise.all([fetchMemberSpxPlay(), callGetSpxPlayStateDirect()]);

  if (member.skip) {
    rec("live: fetch member /api/market/spx/play", "SKIP", member.reason);
  } else {
    rec("live: fetch member /api/market/spx/play", "PASS", `phase=${member.json.phase} action=${member.json.action} grade=${member.json.grade}`);
  }
  if (direct.skip) {
    rec("live: call getSpxPlayState() directly (BIE/Largo's exact function)", "SKIP", direct.reason);
  } else {
    rec("live: call getSpxPlayState() directly (BIE/Largo's exact function)", "PASS", `phase=${direct.json.phase} action=${direct.json.action} grade=${direct.json.grade}`);
  }

  if (member.skip || direct.skip) {
    rec(
      "live: member vs BIE/Largo cross-consistency diff",
      "SKIP",
      member.skip && direct.skip
        ? "both sides must be live to diff — see the two SKIPs above"
        : direct.skip
          ? `${direct.reason} — using prod double-fetch fallback`
          : member.reason || "member fetch unavailable"
    );
    if (!member.skip && direct.skip) {
      await prodMemberPlayDoubleFetchCheck();
    }
    return;
  }

  // as_of sanity: the two calls run moments apart, not simultaneously —
  // flag only if the gap is implausibly large (defaulted here to 5 minutes,
  // well beyond any desk-cache TTL, which would suggest the two reads landed
  // in genuinely different market snapshots rather than just clock skew).
  const memberAt = Date.parse(member.json.as_of ?? "");
  const directAt = Date.parse(direct.json.as_of ?? "");
  if (Number.isFinite(memberAt) && Number.isFinite(directAt)) {
    const deltaMs = Math.abs(memberAt - directAt);
    rec(
      "live: as_of timestamps within a plausible window of each other",
      deltaMs <= 5 * 60_000 ? "PASS" : "WARN",
      `member=${member.json.as_of} direct=${direct.json.as_of} Δ=${deltaMs}ms`
    );
  }

  const diffs = [];
  diffTree(direct.json, member.json, "", ROUND_TOLERANCE, diffs);

  if (diffs.length === 0) {
    rec(
      "live: member vs BIE/Largo cross-consistency diff",
      "PASS",
      `every field matched exactly or within the documented ${ROUND_TOLERANCE} rounding tolerance — BIE/Largo see the same play state a member does`
    );
    return;
  }

  // Split by whether the divergence is explainable by the KNOWN roundFloats
  // asymmetry (both numeric AND within tolerance is already filtered out by
  // diffTree, so anything reaching here on a numeric field is a REAL FAIL,
  // not rounding noise — the tolerance was already applied above).
  for (const d of diffs.slice(0, 40)) {
    rec(
      `live: FIELD MISMATCH ${d.path}`,
      "FAIL",
      d.delta !== undefined ? `direct(BIE/Largo)=${d.a} member=${d.b} Δ=${d.delta} (exceeds documented tolerance ${ROUND_TOLERANCE})` : `direct(BIE/Largo)=${JSON.stringify(d.a)} member=${JSON.stringify(d.b)}`
    );
  }
  rec("live: member vs BIE/Largo cross-consistency diff", "FAIL", `${diffs.length} field(s) diverged beyond the documented rounding tolerance — see FIELD MISMATCH entries above`);
}

// ---------------------------------------------------------------------------
// Layer C (optional, OFF by default) — Largo liveness smoke check. Confirms
// the tool actually fires end-to-end for a targeted question; does NOT diff
// numbers (the public API never returns Largo's raw tool-call JSON — see
// SANDBOX LIMITATIONS above). Spends real Anthropic $ and can legitimately
// choose not to quote a figure at all, so this is reported as INFO/WARN, not
// a hard FAIL basis, except when the tool never fires at all.
// ---------------------------------------------------------------------------
async function largoLivenessSmokeCheck() {
  if (!INCLUDE_LARGO_LIVE_CHECK) {
    rec("live (opt-in): Largo get_spx_play tool invocation", "SKIP", "AUDIT_INCLUDE_LARGO_LIVE_CHECK not set to '1' — this check spends real Anthropic $ per run and is off by default");
    return;
  }
  const { mintClerkPremiumSession } = await import("./lib/prod-clerk-session.mjs");
  const session = await mintClerkPremiumSession({ appUrl: APP });
  if (session.skip) {
    rec("live (opt-in): Largo get_spx_play tool invocation", "SKIP", session.reason);
    return;
  }
  try {
    const res = await fetchWithTimeout(
      `${APP}/api/market/largo/query`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session.cookieHeader, Accept: "application/json" },
        body: JSON.stringify({ question: "What is SPX Slayer's current play state right now — phase, grade, and score?" }),
      },
      60000
    );
    const json = await res.json().catch(() => null);
    const toolsUsed = Array.isArray(json?.tools_used) ? json.tools_used : [];
    const fired = toolsUsed.includes("get_spx_play") || toolsUsed.includes("get_ecosystem_context") || toolsUsed.includes("blackout_intelligence");
    rec(
      "live (opt-in): Largo get_spx_play tool invocation",
      fired ? "PASS" : "WARN",
      `tools_used=${JSON.stringify(toolsUsed)} verification_coverage=${json?.verification?.coverage ?? "n/a"} — liveness/wiring signal only, NOT a byte-for-byte numeric diff (see SANDBOX LIMITATIONS)`
    );
  } catch (e) {
    rec("live (opt-in): Largo get_spx_play tool invocation", "SKIP", `request failed: ${e.message}`);
  } finally {
    await session.cleanup();
  }
}

// ---------------------------------------------------------------------------

async function main() {
  console.log("Layer A — static source-invariant checks");
  staticInvariantChecks();
  console.log("\nLayer B — live cross-consistency check");
  await liveCrossConsistencyCheck();
  console.log("\nLayer C — optional Largo liveness smoke check");
  await largoLivenessSmokeCheck();
}

let exitCode = 0;
main()
  .catch((e) => rec("script error", "FAIL", String(e.stack || e.message || e)))
  .finally(() => {
    const totals = checks.reduce((m, c) => ((m[c.status] = (m[c.status] || 0) + 1), m), {});
    const stamp = new Date().toISOString();
    const summary = { generated_at: stamp, app: APP, round_tolerance: ROUND_TOLERANCE, totals, checks };
    const base = join(OUT, `spx-bie-consistency-${stamp.replace(/[:.]/g, "-")}`);
    writeFileSync(`${base}.json`, JSON.stringify(summary, null, 2));
    writeFileSync(
      `${base}.md`,
      [
        `# SPX Slayer <-> BIE/Largo Consistency Validation — ${stamp}`,
        `App: ${APP} | totals: ${JSON.stringify(totals)}`,
        "",
        "| status | check | detail |",
        "|---|---|---|",
        ...checks.map((c) => `| ${c.status} | ${c.name} | ${(c.detail || "").slice(0, 220).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")} |`),
      ].join("\n")
    );
    console.log("\nTOTALS", JSON.stringify(totals), "\nreport:", `${base}.md`);
    exitCode = (totals.FAIL || 0) > 0 ? 1 : 0;
    process.exit(exitCode);
  });

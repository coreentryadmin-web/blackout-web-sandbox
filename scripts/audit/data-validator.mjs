#!/usr/bin/env node
/*
 * Cross-provider data-correctness validator for blackouttrades.com.
 *
 * WHAT IT DOES
 *   1. Authenticates to production as a temporary admin/premium Clerk user
 *      (mint sign_in_token -> FAPI ticket exchange -> session cookie). ONE temp
 *      user per run, ALWAYS deleted in a finally block.
 *   2. Fetches the numbers members see (app REST endpoints).
 *   3. Fetches ground truth from Polygon + Unusual Whales (REST).
 *   4. Cross-validates prices/indices, GEX/greeks consistency, 0DTE Command board
 *      setups/ledger (entry_premium/underlying_price/top_strike vs fresh Polygon
 *      quotes + minute bars — task #148), track-record arithmetic, and scans every
 *      payload for malformed numbers (NaN/Infinity/unrounded float noise like
 *      7499.360000000001).
 *   5. Writes a JSON + Markdown report and exits non-zero if any check FAILs.
 *
 * SECRETS — read from env ONLY (never hardcode / commit):
 *   CLERK_SECRET_KEY                    (production Clerk backend key)
 *   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY   (used to derive the Frontend API host)
 *   POLYGON_API_KEY                     (literal value; the ${{shared.*}} ref does NOT resolve)
 *   UW_API_KEY                          (literal UUID token; the ${{shared.*}} ref does NOT resolve)
 *
 * ENV (optional):
 *   AUDIT_OUT   output dir for reports (default: <cwd>/audit-output, gitignored)
 *   AUDIT_APP_URL   app base (default https://blackouttrades.com)
 *   AUDIT_EMAIL     temp user email (default claude-audit-temp@blackouttrades.com)
 *   AUDIT_PHONE     temp user phone (default: freshly generated each run — fixed fake
 *                   415-555 prefix + a random 4-digit suffix, see lib/audit-phone.mjs;
 *                   instance requires a phone). A hardcoded default here previously
 *                   collided with an already-registered Clerk user and broke every
 *                   subsequent unattended run — see docs/audit/FINDINGS.md (task #175).
 *
 * NOTE: WebSocket feeds are NOT validated here (agent/proxy environments block WS
 * upgrades). Members see WS data via these REST endpoints, which ARE validated.
 * Authenticate ONCE per run — rapid Clerk sign-in cycles get FAPI-rate-limited.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isTradingDayEt, todayEtYmd } from '../gha-et-window.mjs';
import { isAuthFailureStatus } from './lib/auth-status.mjs';
import { generateDefaultAuditPhone } from './lib/audit-phone.mjs';

const SECRET = req('CLERK_SECRET_KEY');
const PUB = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || '';
const UWK = req('UW_API_KEY');
const POLY = req('POLYGON_API_KEY');
const APP = process.env.AUDIT_APP_URL || 'https://blackouttrades.com';
const EMAIL = process.env.AUDIT_EMAIL || 'claude-audit-temp@blackouttrades.com';
// See lib/audit-phone.mjs for why the default is generated per-run instead of a fixed
// constant (task #175: a hardcoded default eventually collided with an existing Clerk
// user and broke every subsequent unattended run). AUDIT_PHONE, when set, is still used
// verbatim — this fallback only fires when the operator hasn't overridden it.
const PHONE = process.env.AUDIT_PHONE || generateDefaultAuditPhone();
const OUT = process.env.AUDIT_OUT || join(process.cwd(), 'audit-output');
const API = 'https://api.clerk.com/v1';
const PB = 'https://api.polygon.io';
const UB = 'https://api.unusualwhales.com';
const CJS = '5.57.0';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

function req(name) {
  const v = process.env[name];
  if (!v || v.includes('${{')) { console.error(`FATAL: env ${name} is missing or an unresolved \${{...}} placeholder. Set it to a literal value.`); process.exit(3); }
  return v;
}
// Frontend API host from publishable key (pk_live_<base64("host$")>)
function fapiHost() {
  try { const d = Buffer.from(PUB.replace(/^pk_(live|test)_/, ''), 'base64').toString('utf8').replace(/\$$/, ''); if (d.includes('.')) return `https://${d}`; } catch {}
  return 'https://clerk.blackouttrades.com';
}
const FAPI = fapiHost();

const TMP = join(tmpdir(), `bo-validate-${process.pid}`);
mkdirSync(TMP, { recursive: true });
mkdirSync(OUT, { recursive: true });
const JAR = join(TMP, 'cookies.txt');
let seq = 0;
function curl({ method = 'GET', url, headers = {}, form, urlencodeForm, json, jar = false, saveJar = false }) {
  const bf = join(TMP, `b${++seq}`);
  const args = ['-sS', '--max-time', '45', '-o', bf, '-w', '%{http_code}', '-A', UA];
  if (method !== 'GET') args.push('-X', method);
  for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
  if (json) args.push('-H', 'Content-Type: application/json', '--data', JSON.stringify(json));
  if (form) for (const [k, v] of Object.entries(form)) args.push('--data', `${k}=${v}`);
  if (urlencodeForm) for (const [k, v] of Object.entries(urlencodeForm)) args.push('--data-urlencode', `${k}=${v}`);
  if (jar) args.push('-b', JAR);
  if (saveJar) args.push('-c', JAR);
  args.push(url);
  try { const s = Number(execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 80 * 1024 * 1024 }).trim()); return { s, b: existsSync(bf) ? readFileSync(bf, 'utf8') : '' }; }
  catch (e) { return { s: 0, b: '', err: String(e.message || e).split('\n')[0] }; }
}
const J = (r) => { try { return JSON.parse(r.b); } catch { return null; } };
const backend = (m, p, j) => curl({ method: m, url: `${API}${p}`, headers: { Authorization: `Bearer ${SECRET}` }, json: j });
const poly = (p) => J(curl({ url: `${PB}${p}${p.includes('?') ? '&' : '?'}apiKey=${POLY}` }));
const uw = (p) => J(curl({ url: `${UB}${p}`, headers: { Authorization: `Bearer ${UWK}`, Accept: 'application/json' } }));
const num = (x) => (typeof x === 'string' ? Number(x) : x);

const checks = [];
const rec = (name, status, detail, extra = {}) => { checks.push({ name, status, detail, ...extra }); console.log(`  [${status}] ${name}${detail ? ' — ' + detail : ''}`); };
function scan(obj, path, out) {
  if (obj == null) return;
  if (typeof obj === 'number') { if (!Number.isFinite(obj)) out.push(`${path}=${obj}(non-finite)`); else if (!Number.isInteger(obj) && Math.abs(obj) >= 1000 && (String(obj).split('.')[1] || '').length >= 6) out.push(`${path}=${obj}(${(String(obj).split('.')[1] || '').length}dp)`); return; }
  if (typeof obj === 'string') { if (['NaN', 'Infinity', 'undefined'].includes(obj)) out.push(`${path}="${obj}"`); return; }
  if (Array.isArray(obj)) { obj.slice(0, 80).forEach((v, i) => scan(v, `${path}[${i}]`, out)); return; }
  if (typeof obj === 'object') for (const [k, v] of Object.entries(obj)) scan(v, path ? `${path}.${k}` : k, out);
}

// --- 0DTE Command board helpers (task #148) -------------------------------
// The board (src/app/api/market/zerodte/board/route.ts) returns two arrays with
// checkable numbers:
//   `setups` — the LIVE/ephemeral scan (scanZeroDteBoard(), src/lib/zerodte/board.ts +
//              scan.ts), recomputed on every poll (5s server-cache TTL). Carries
//              underlying_price/top_strike/direction/expiry for candidates that may or
//              may not be persisted yet.
//   `ledger` — COMMITTED/persisted setups (zerodte_setup_log, via persistZeroDteScan()),
//              one row per ticker actually flagged today. Carries entry_premium/
//              underlying_at_flag/top_strike/direction/first_flagged_at — but NOT expiry
//              (route.ts's ledger mapping, lines ~109-132, omits it — see FINDINGS.md).
// Bounded to a handful of rows per array per run (mirrors the app's own
// ENRICH_TOP_N=5 dossier-enrichment cap in scan.ts) — this is a manual/cron-run audit
// script, not a hot path, but there is no reason to hammer Polygon for a 30-row ledger.
const ZERODTE_LIVE_CHECK_CAP = 5;
const ZERODTE_LEDGER_CHECK_CAP = 5;
// Historical cross-checks (entry_premium / underlying_at_flag) compare the logged number
// against Polygon's own minute bars in a window centered on first_flagged_at — wide enough
// to absorb a few seconds of clock skew between "the scan flagged it" and "the aggregate
// bar closed", narrow enough that a real divergence still fails.
const ZERODTE_HIST_WINDOW_MS = 3 * 60 * 1000;
// Options routinely trade with wide bid/ask spreads at low liquidity — the app's OWN
// buildContractPlan() (src/lib/zerodte/plan.ts) treats spread_pct > 15 as "illiquid", i.e.
// it already treats UP TO 15% as a normal/liquid market. Reusing that exact threshold as
// this check's tolerance (instead of inventing a number) means entry_premium only fails
// when it diverges from the contract's own traded range by more than the app's own
// definition of "abnormal" for an option's price.
const ZERODTE_OPTION_PREM_TOL_PCT = 15;

/** NYSE-next-trading-day, reimplemented locally (mirrors src/lib/nighthawk/session.ts's
 *  nextTradingDayEt byte-for-byte) so this script stays self-contained (it already imports
 *  isTradingDayEt/todayEtYmd from the sibling gha-et-window.mjs, never a src/lib/*.ts module). */
function nextTradingDayEtYmd(fromYmd) {
  let cursor = Date.parse(`${fromYmd}T12:00:00Z`) + 86_400_000;
  for (let i = 0; i < 12; i++) {
    const ymd = new Date(cursor).toISOString().slice(0, 10);
    if (isTradingDayEt(ymd)) return ymd;
    cursor += 86_400_000;
  }
  return new Date(cursor).toISOString().slice(0, 10);
}

/** Fresh Polygon spot for an arbitrary ticker, mirroring the SPY/SPX live-vs-prev-close
 *  logic already established above (rth ? live snapshot : prior close) — SPX is the one
 *  index root the 0DTE scanner can surface (scan.ts's STATIC_EXCLUDES only blocks
 *  VIX/leveraged ETPs, not SPX/SPY/QQQ/NDX) and needs the indices endpoint, not the stock
 *  snapshot endpoint; other pure-index roots are not special-cased (none observed on this
 *  board in practice — extend here if one ever is). */
function polygonSpotNow(ticker, isRth) {
  if (ticker === 'SPX') {
    const snap = isRth ? poly('/v3/snapshot/indices?ticker.any_of=I:SPX')?.results?.[0] : null;
    if (isRth) return num(snap?.value) ?? null;
    return num(poly('/v2/aggs/ticker/I:SPX/prev')?.results?.[0]?.c) ?? null;
  }
  if (isRth) {
    const snap = poly(`/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(ticker)}`)?.ticker;
    return num(snap?.lastTrade?.p ?? snap?.day?.c) ?? null;
  }
  return num(poly(`/v2/aggs/ticker/${encodeURIComponent(ticker)}/prev`)?.results?.[0]?.c) ?? null;
}

/** Does a real, listed 0-1DTE contract exist for ticker/direction/strike? Polygon's
 *  reference-contracts endpoint (already used in src/lib/providers/polygon-options-gex.ts
 *  for OI-by-expiry) both proves existence AND returns the resolved OCC ticker + real
 *  expiration_date in one call — cheaper and more authoritative than hand-building an OCC
 *  symbol (src/lib/ws/options-socket.ts:buildOcc) and guessing whether it resolves.
 *  Cached per (ticker, direction, strike) since the same setup can appear in both `setups`
 *  and `ledger` in one run. Returns null when no matching contract exists (a real bug) OR
 *  when the inputs are unusable (never conflated with a substantive FAIL by the caller).
 *
 *  IMPORTANT: unlike buildOcc's SPX->SPXW swap (which builds an OCC *ticker symbol*, where
 *  Polygon/Massive really do list SPX index options under an "O:SPXW..." prefix), this
 *  endpoint's `underlying_ticker` *filter parameter* only recognizes the underlying's plain
 *  ticker "SPX" — passing "SPXW" here returns zero results even for real, live contracts
 *  (confirmed directly against Polygon: `underlying_ticker=SPX&strike_price=7505` resolves
 *  `O:SPXW260706C07505000`; `underlying_ticker=SPXW` with identical other params returns
 *  `results: []`, whether the caller passed "SPXW" as a literal or via buildOcc's swap).
 *  The 0DTE board's own `ticker` field for this instrument is "SPXW" (matching how UW/the
 *  flow feed label the weekly, per src/lib/ws/options-socket.ts), so BOTH "SPX" and "SPXW"
 *  inputs must normalize to "SPX" for this query — this was a false-positive FAIL bug in
 *  this validator, not a real 0DTE Command data issue. Do not reintroduce a swap TO "SPXW"
 *  here. */
const zerodteContractCache = new Map();
function resolveZeroDteContract(ticker, direction, strike, todayYmd, nextDayYmd) {
  const key = `${ticker}|${direction}|${strike}`;
  if (zerodteContractCache.has(key)) return zerodteContractCache.get(key);
  const underlyingTicker = ticker === 'SPX' || ticker === 'SPXW' ? 'SPX' : ticker;
  const contractType = direction === 'long' ? 'call' : direction === 'short' ? 'put' : null;
  let resolved = null;
  if (contractType && Number.isFinite(strike) && strike > 0) {
    const qs = new URLSearchParams({
      underlying_ticker: underlyingTicker, contract_type: contractType, strike_price: String(strike),
      expired: 'false', 'expiration_date.gte': todayYmd, 'expiration_date.lte': nextDayYmd,
      sort: 'expiration_date', order: 'asc', limit: '5',
    });
    const c = poly(`/v3/reference/options/contracts?${qs}`)?.results?.[0];
    if (c?.ticker) resolved = { occ: c.ticker, expiry: String(c.expiration_date || '').slice(0, 10) };
  }
  zerodteContractCache.set(key, resolved);
  return resolved;
}

/** Polygon 1-minute bar range for `symbol` (stock ticker or OCC option ticker) across a
 *  window centered on `centerMs`. Returns {lo, hi} spanning every bar's low/high in the
 *  window, or null when Polygon returns zero bars (a real, common state for a thin
 *  single-name 0DTE option in a specific 6-minute window — handled as an explicit "skipped"
 *  INFO by the caller, never fabricated into a PASS or FAIL). */
function polygonHistRange(symbol, centerMs, windowMs) {
  if (!Number.isFinite(centerMs)) return null;
  const from = Math.round(centerMs - windowMs);
  const to = Math.round(centerMs + windowMs);
  const rows = poly(`/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/1/minute/${from}/${to}?adjusted=true&sort=asc&limit=50`)?.results;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return { lo: Math.min(...rows.map((b) => b.l)), hi: Math.max(...rows.map((b) => b.h)) };
}

/** `value` inside [range.lo, range.hi] with a `tolPct`% cushion on both sides — the same
 *  "was this number achievable at that moment" test gradePlanFromBars (src/lib/zerodte/
 *  plan.ts) applies when grading a play's own outcome, just read as a boolean here. */
function withinHistRange(value, range, tolPct) {
  if (value == null || !Number.isFinite(value) || !range) return null;
  const cushion = tolPct / 100;
  return value >= range.lo * (1 - cushion) && value <= range.hi * (1 + cushion);
}

let userId = null;
async function main() {
  // --- auth (once) ---
  const create = backend('POST', '/users', { email_address: [EMAIL], phone_number: [PHONE], public_metadata: { role: 'admin', tier: 'premium' }, skip_password_requirement: true, skip_legal_checks: true });
  let cj = J(create);
  if (cj?.id) userId = cj.id;
  else if (/form_identifier_exists/.test(JSON.stringify(cj?.errors || ''))) {
    const u = (J(curl({ url: `${API}/users?email_address=${encodeURIComponent(EMAIL)}`, headers: { Authorization: `Bearer ${SECRET}` } })) || [])[0];
    if (u?.id) { userId = u.id; backend('PATCH', `/users/${userId}`, { public_metadata: { role: 'admin', tier: 'premium' } }); }
  }
  if (!userId) { rec('auth: create/adopt temp user', 'FAIL', create.b.slice(0, 160)); return; }
  const ticket = J(backend('POST', '/sign_in_tokens', { user_id: userId }))?.token;
  const si = curl({ method: 'POST', url: `${FAPI}/v1/client/sign_ins?_clerk_js_version=${CJS}`, headers: { Origin: APP, Referer: `${APP}/`, 'Content-Type': 'application/x-www-form-urlencoded' }, form: { strategy: 'ticket' }, urlencodeForm: { ticket }, saveJar: true, jar: true });
  const sid = J(si)?.response?.created_session_id;
  if (!sid) { rec('auth: FAPI ticket exchange', 'FAIL', si.b.slice(0, 160)); return; }
  let tok = null;
  // Clerk's middleware signs a request out if the session token's `iat` predates
  // the `__client_uat` cookie ("session-token-iat-before-client-uat"). Pinning
  // this to a moment BEFORE the first mint (rather than recomputing Date.now()
  // on every request) guarantees it never overtakes any token minted afterward
  // — recomputing per-request made every app() call after the first one in a
  // run silently receive a 401 body once a wall-clock second ticked over.
  const clientUat = Math.floor(Date.now() / 1000);
  const mint = () => { tok = J(curl({ method: 'POST', url: `${FAPI}/v1/client/sessions/${sid}/tokens?_clerk_js_version=${CJS}`, headers: { Origin: APP, Referer: `${APP}/`, 'Content-Type': 'application/x-www-form-urlencoded' }, jar: true, saveJar: true }))?.jwt; return tok; };
  mint();
  const app = (path) => {
    for (let i = 0; i < 2; i++) {
      if (!tok) mint();
      const r = curl({ url: `${APP}${path}`, headers: { Cookie: `__session=${tok}; __client_uat=${clientUat}`, Accept: 'application/json' } });
      if (isAuthFailureStatus(r.s)) { tok = null; continue; }
      const j = J(r);
      if (j) return j;
      tok = null;
    }
    return null;
  };
  rec('auth: admin session established', 'PASS', `session ${sid}`);

  // --- app payloads ---
  const P = {
    quote: app('/api/market/quote?ticker=SPY'), indices: app('/api/market/indices'),
    gex: app('/api/market/gex-positioning'), heatmap: app('/api/market/gex-heatmap'),
    track: app('/api/public/track-record'), flow: app('/api/market/flow-brief'),
    spx_desk: app('/api/market/spx/desk'), spx_merged: app('/api/market/spx/merged'),
    spx_signals: app('/api/market/spx/signals'), platform: app('/api/market/platform/snapshot'),
    // task #148: 0DTE Command board (src/app/api/market/zerodte/board/route.ts). Adding it
    // here also gets it covered for free by the generic malformed-number scan at the bottom
    // of this file — no separate wiring needed for that part.
    zerodte_board: app('/api/market/zerodte/board'),
  };
  // --- ground truth: LIVE snapshot during RTH, prior-close off-hours ---
  // (Intraday, the numbers members see must match the LIVE feed, not yesterday's close;
  //  comparing live-vs-prev-close would false-fail every RTH run.)
  const pStatus = poly('/v1/marketstatus/now');
  const rth = pStatus?.market === 'open';
  const pSPYprev = poly('/v2/aggs/ticker/SPY/prev')?.results?.[0];
  const pSPXprev = poly('/v2/aggs/ticker/I:SPX/prev')?.results?.[0];
  const pVIXprev = poly('/v2/aggs/ticker/I:VIX/prev')?.results?.[0];
  const idxSnap = rth ? poly('/v3/snapshot/indices?ticker.any_of=I:SPX,I:VIX') : null;
  const gSPX = (idxSnap?.results || []).find((r) => r.ticker === 'I:SPX');
  const gVIX = (idxSnap?.results || []).find((r) => r.ticker === 'I:VIX');
  const spySnap = rth ? poly('/v2/snapshot/locale/us/markets/stocks/tickers/SPY')?.ticker : null;
  const gtLabel = rth ? 'live' : 'prev-close';
  const gtSPY = rth ? num(spySnap?.lastTrade?.p ?? spySnap?.day?.c) : num(pSPYprev?.c);
  const gtSPX = rth ? num(gSPX?.value) : num(pSPXprev?.c);
  const gtVIX = rth ? num(gVIX?.value) : num(pVIXprev?.c);
  const gtVIXchg = rth ? num(gVIX?.session?.change_percent) : null;
  const gtSPXchg = rth ? num(gSPX?.session?.change_percent) : null;
  const uTide = uw('/api/market/market-tide'); const uTideRow = Array.isArray(uTide?.data) ? uTide.data.at(-1) : null;
  const uGreekRow = (() => { const g = uw('/api/stock/SPY/greek-exposure'); return Array.isArray(g?.data) ? g.data.at(-1) : null; })();
  rec('market status', 'INFO', `Polygon market=${pStatus?.market} (RTH=${rth}); ground truth=${gtLabel}`);

  // --- price / index cross-validation (live-vs-live during RTH) ---
  const aSPY = num(P.quote?.price ?? P.quote?.spot), aGexSpot = num(P.gex?.spot);
  const priceTol = rth ? 0.3 : 1.5;
  if (aSPY != null && gtSPY != null) { const d = Math.abs(aSPY - gtSPY) / gtSPY * 100; rec('SPY: app quote vs Polygon', d <= priceTol ? 'PASS' : 'FAIL', `app=${aSPY} polygon(${gtLabel})=${gtSPY} Δ=${d.toFixed(3)}%`); }
  if (aGexSpot != null && gtSPY != null) { const d = Math.abs(aGexSpot - gtSPY) / gtSPY * 100; rec('SPY: app gex.spot vs Polygon', d <= priceTol ? 'PASS' : 'FAIL', `app=${aGexSpot} polygon(${gtLabel})=${gtSPY} Δ=${d.toFixed(3)}%`); }
  if (aSPY != null && aGexSpot != null) rec('cross-endpoint: quote vs gex spot', Math.abs(aSPY - aGexSpot) <= Math.max(0.5, aSPY * 0.005) ? 'PASS' : 'WARN', `quote=${aSPY} gex=${aGexSpot}`);
  const aSPX = num(P.indices?.spx?.price);
  if (aSPX != null && gtSPX != null) { const d = Math.abs(aSPX - gtSPX) / gtSPX * 100; rec('SPX: app indices vs Polygon', d <= priceTol ? 'PASS' : 'FAIL', `app=${aSPX} polygon(${gtLabel})=${gtSPX} Δ=${d.toFixed(3)}%`); }
  const aVIX = num(P.indices?.vix?.price);
  if (aVIX != null && gtVIX != null) { const d = Math.abs(aVIX - gtVIX) / gtVIX * 100; rec('VIX: app indices vs Polygon', d <= (rth ? 1.5 : 5) ? 'PASS' : 'WARN', `app=${aVIX} polygon(${gtLabel})=${gtVIX} Δ=${d.toFixed(3)}%`); }
  // change-sign checks (RTH only — off-hours the app's change base desyncs, a known bug)
  const aVIXchg = num(P.indices?.vix?.change_pct), aSPXchg = num(P.indices?.spx?.change_pct);
  if (rth && aVIXchg != null && gtVIXchg != null) rec('VIX change_pct sign matches Polygon', (aVIXchg >= 0) === (gtVIXchg >= 0) ? 'PASS' : 'FAIL', `app=${aVIXchg}% polygon=${gtVIXchg.toFixed(3)}%`);
  if (rth && aSPXchg != null && gtSPXchg != null) rec('SPX change_pct sign matches Polygon', (aSPXchg >= 0) === (gtSPXchg >= 0) ? 'PASS' : 'FAIL', `app=${aSPXchg}% polygon=${gtSPXchg.toFixed(3)}%`);
  if (aSPX != null && aSPY != null) { const r = aSPX / aSPY; rec('SPX/SPY ratio ~10', r > 9.5 && r < 10.5 ? 'PASS' : 'WARN', `ratio=${r.toFixed(3)}`); }

  // --- GEX / greeks consistency ---
  const tradingDay = isTradingDayEt(todayEtYmd());
  if (P.gex) {
    const pw = num(P.gex.put_wall), cw = num(P.gex.call_wall), g = num(P.gex.net_gex), dx = num(P.gex.net_dex), vx = num(P.gex.net_vex);
    if (!tradingDay && pw == null && cw == null) {
      rec('wall ordering put_wall < call_wall', 'INFO', `skipped — market holiday; gex walls unavailable (spot=${aGexSpot})`);
    } else {
      rec('wall ordering put_wall < call_wall', (pw != null && cw != null && pw < cw) ? 'PASS' : 'FAIL', `put_wall=${pw} flip=${P.gex.flip} max_pain=${P.gex.max_pain} call_wall=${cw} spot=${aGexSpot}`);
    }
    // gamma_posture is documented as spot-vs-flip ('long' at/above flip, 'short' below —
    // gex-positioning.ts:55), NOT sign(net_gex). The two are related but distinct measures
    // and legitimately diverge near the flip (spot barely above flip while the summed book
    // is net-negative — observed live 2026-07-02: spot 744.12, flip 742.5, net_gex -3.03B).
    // Assert posture against its own definition; surface a posture/net_gex sign divergence
    // as INFO (interesting market state, not a data bug).
    const flipN = num(P.gex.flip);
    if (flipN != null && aGexSpot != null && P.gex.gamma_posture) {
      const expected = aGexSpot >= flipN ? 'long' : 'short';
      rec('gamma posture matches spot-vs-flip', new RegExp(expected, 'i').test(P.gex.gamma_posture) ? 'PASS' : 'FAIL', `spot=${aGexSpot} flip=${flipN} posture=${P.gex.gamma_posture} (expected ${expected})`);
    }
    if (g != null && P.gex.gamma_posture) {
      const signAgrees = (g >= 0 && /long/i.test(P.gex.gamma_posture)) || (g < 0 && /short/i.test(P.gex.gamma_posture));
      if (!signAgrees) rec('posture/net_gex sign divergence (near-flip state)', 'INFO', `net_gex=${g} posture=${P.gex.gamma_posture} — legitimate when spot straddles the flip`);
    }
    if (dx != null) rec('dex posture matches net_dex sign', ((dx >= 0 && /long|pos/i.test(P.gex.dex_posture)) || (dx < 0 && /short|neg/i.test(P.gex.dex_posture))) ? 'PASS' : 'WARN', `net_dex=${dx} posture=${P.gex.dex_posture}`);
    if (vx != null) rec('vanna posture matches net_vex sign', ((vx >= 0 && /pos/i.test(P.gex.vanna_posture)) || (vx < 0 && /neg/i.test(P.gex.vanna_posture))) ? 'PASS' : 'WARN', `net_vex=${vx} posture=${P.gex.vanna_posture}`);
    if (P.gex.gex_cross_validation) rec('app self-reported gex_cross_validation', 'INFO', JSON.stringify(P.gex.gex_cross_validation).slice(0, 160));
    if (uGreekRow && g != null) { const uwNet = num(uGreekRow.call_gamma) + num(uGreekRow.put_gamma); rec('net_gex SIGN app vs UW greek-exposure', (g >= 0) === (uwNet >= 0) ? 'PASS' : 'WARN', `app=${g} uw_call+put_gamma=${uwNet.toFixed(0)} (units differ; sign only)`); }
  }

  // --- 0DTE Command board cross-validation (task #148) ---
  // Ground-truths entry_premium/underlying_price(_at_flag)/top_strike — the numbers this
  // board shows members that were NEVER cross-checked against Polygon/UW before this task
  // (confirmed pre-fix: zero "zerodte"/"grid"/board-route references anywhere in this file).
  {
    const zb = P.zerodte_board;
    if (!zb || zb.available !== true) {
      // Matches this file's existing tone for a gated/unavailable payload (see the
      // 'track: admin-gated API' INFO above) rather than failing the whole run over a
      // transient/degraded response — route.ts's own catch branch returns exactly
      // {available:false, degraded:true} on an unexpected error, which is itself already
      // the route's explicit "something broke" signal, hence WARN (not a silent no-op,
      // but not a hard FAIL either — this section alone shouldn't red the whole run).
      rec('0DTE board: payload available', zb ? 'WARN' : 'INFO', zb ? `available=${zb.available} — degraded fallback from route.ts's catch branch` : 'no response from /api/market/zerodte/board (fetch/auth failure — see auth checks above)');
    } else {
      const liveSetups = Array.isArray(zb.setups) ? zb.setups : [];
      const ledgerRows = Array.isArray(zb.ledger) ? zb.ledger : [];
      if (liveSetups.length === 0 && ledgerRows.length === 0) {
        // Empty board is a common, legitimate state (pre-market, dead tape, every
        // candidate failed a gate) — never a FAIL, same "if applicable" discipline as the
        // market-holiday skip on the wall-ordering check above.
        rec('0DTE board: setups/ledger to cross-check', 'INFO', 'board empty right now (0 live setups, 0 ledger rows) — legitimate, common state depending on market conditions; nothing to cross-check this run');
      } else {
        rec('0DTE board: setups/ledger fetched', 'INFO', `${liveSetups.length} live setup(s), ${ledgerRows.length} ledger row(s) this run — checking up to ${ZERODTE_LIVE_CHECK_CAP} live + ${ZERODTE_LEDGER_CHECK_CAP} ledger`);
        const zdToday = todayEtYmd();
        const zdNextDay = nextTradingDayEtYmd(zdToday);

        // --- live setups: underlying_price (fresh "now" quote) + top_strike (chain existence) ---
        for (const s of liveSetups.slice(0, ZERODTE_LIVE_CHECK_CAP)) {
          const ticker = String(s?.ticker || '').toUpperCase();
          if (!ticker) continue;
          const appPrice = num(s.underlying_price);
          const spot = polygonSpotNow(ticker, rth);
          if (appPrice != null && spot != null && spot > 0) {
            const d = Math.abs(appPrice - spot) / spot * 100;
            // Reuses priceTol verbatim (the SPY/SPX/GEX-spot convention above) rather than
            // inventing a single-name tolerance — flagged in FINDINGS.md as an assumption
            // worth revisiting if live single-name volatility around alert time false-fails
            // this in practice.
            rec(`0DTE live ${ticker}: underlying_price vs Polygon`, d <= priceTol ? 'PASS' : 'FAIL', `app=${appPrice} polygon(${rth ? 'live' : 'prev-close'})=${spot} Δ=${d.toFixed(3)}%`);
          } else {
            rec(`0DTE live ${ticker}: underlying_price vs Polygon`, 'INFO', `skipped — app=${appPrice} polygon=${spot} (missing one side)`);
          }
          // top_strike is a required field on a live setup (ZeroDteSetup.top_strike:
          // number, board.ts) — unlike the ledger's persisted column (see below), there is
          // no legitimate null case here, so a resolve failure is a real FAIL.
          const strike = num(s.top_strike);
          const resolved = resolveZeroDteContract(ticker, s.direction, strike, zdToday, zdNextDay);
          const label = `${strike}${s.direction === 'long' ? 'c' : s.direction === 'short' ? 'p' : '?'}`;
          rec(`0DTE live ${ticker}: top_strike ${label} exists in Polygon's real chain`, resolved ? 'PASS' : 'FAIL', resolved ? `resolved ${resolved.occ} (expiry ${resolved.expiry})` : `no matching 0-1DTE contract in Polygon's reference chain for ${ticker} ${s.direction} ${strike} between ${zdToday} and ${zdNextDay}`);
        }

        // --- ledger rows: top_strike (existence) + entry_premium/underlying_at_flag (historical) ---
        for (const r0 of ledgerRows.slice(0, ZERODTE_LEDGER_CHECK_CAP)) {
          const ticker = String(r0?.ticker || '').toUpperCase();
          if (!ticker) continue;
          // Unlike the live setup above, the ledger's top_strike column is NULLABLE
          // (zerodte_setup_log.top_strike NUMERIC, no NOT NULL — ZeroDteSetupLogRow.
          // top_strike: number | null, src/lib/db.ts) — a genuinely null value here is a
          // real, if rare, DB state, not a data-integrity bug, so it's skipped (INFO), not
          // failed. resolved stays null either way, which the entry_premium check below
          // already treats as "no OCC to fetch option bars for".
          const strike = num(r0.top_strike);
          let resolved = null;
          if (strike == null) {
            rec(`0DTE ledger ${ticker}: top_strike exists in Polygon's real chain`, 'INFO', 'skipped — top_strike is null on this ledger row');
          } else {
            resolved = resolveZeroDteContract(ticker, r0.direction, strike, zdToday, zdNextDay);
            const label = `${strike}${r0.direction === 'long' ? 'c' : r0.direction === 'short' ? 'p' : '?'}`;
            rec(`0DTE ledger ${ticker}: top_strike ${label} exists in Polygon's real chain`, resolved ? 'PASS' : 'FAIL', resolved ? `resolved ${resolved.occ} (expiry ${resolved.expiry})` : `no matching 0-1DTE contract in Polygon's reference chain for ${ticker} ${r0.direction} ${strike} between ${zdToday} and ${zdNextDay}`);
          }

          const flagMs = Date.parse(r0.first_flagged_at || '');
          if (!Number.isFinite(flagMs)) {
            rec(`0DTE ledger ${ticker}: historical cross-check window`, 'INFO', `skipped — first_flagged_at missing/unparseable ("${r0.first_flagged_at}") — cannot anchor a historical Polygon window`);
            continue;
          }

          // underlying_at_flag vs Polygon's own stock minute bars around the flag instant.
          const uaf = num(r0.underlying_at_flag);
          if (uaf != null) {
            const range = polygonHistRange(ticker === 'SPX' ? 'I:SPX' : ticker, flagMs, ZERODTE_HIST_WINDOW_MS);
            if (!range) {
              rec(`0DTE ledger ${ticker}: underlying_at_flag vs Polygon minute bars`, 'INFO', `skipped — no Polygon minute bars for ${ticker} in the ±${ZERODTE_HIST_WINDOW_MS / 60000}m window around ${r0.first_flagged_at}`);
            } else {
              const ok = withinHistRange(uaf, range, priceTol);
              rec(`0DTE ledger ${ticker}: underlying_at_flag vs Polygon minute bars`, ok ? 'PASS' : 'FAIL', `logged=${uaf} polygon_range=[${range.lo.toFixed(4)}, ${range.hi.toFixed(4)}] (±${priceTol}% cushion) at ${r0.first_flagged_at}`);
            }
          }

          // entry_premium vs the OPTION contract's own minute bars around the same instant
          // — needs the resolved OCC from the top_strike existence check above.
          const ep = num(r0.entry_premium);
          if (ep != null) {
            if (!resolved?.occ) {
              rec(`0DTE ledger ${ticker}: entry_premium vs Polygon option minute bars`, 'INFO', 'skipped — no resolved OCC contract (top_strike existence check above did not resolve one)');
            } else {
              const range = polygonHistRange(resolved.occ, flagMs, ZERODTE_HIST_WINDOW_MS);
              if (!range) {
                rec(`0DTE ledger ${ticker}: entry_premium vs Polygon option minute bars`, 'INFO', `skipped — no Polygon minute bars for ${resolved.occ} in the ±${ZERODTE_HIST_WINDOW_MS / 60000}m window around ${r0.first_flagged_at} (thin/illiquid single-name 0DTE contracts often have zero trades in a given minute)`);
              } else {
                const ok = withinHistRange(ep, range, ZERODTE_OPTION_PREM_TOL_PCT);
                rec(`0DTE ledger ${ticker}: entry_premium vs Polygon option minute bars`, ok ? 'PASS' : 'FAIL', `logged=${ep} polygon_range=[${range.lo.toFixed(4)}, ${range.hi.toFixed(4)}] (±${ZERODTE_OPTION_PREM_TOL_PCT}% cushion, ${resolved.occ}) at ${r0.first_flagged_at}`);
              }
            }
          }
        }
      }
    }
  }

  // --- flow (UW market-tide ground truth) ---
  if (uTideRow) rec('flow: UW market-tide latest (ground truth)', 'INFO', `date=${uTideRow.date} netCallPrem=${uTideRow.net_call_premium} netPutPrem=${uTideRow.net_put_premium} netVol=${uTideRow.net_volume}`);

  // --- track record arithmetic ---
  if (P.track?.error) {
    rec('track: admin-gated API', 'INFO', `skipped — ${P.track.error} (requireAdminApi; verify via data-correctness cron)`);
  } else if (P.track) {
    const tc = num(P.track.total_closed), w = num(P.track.wins), l = num(P.track.losses), be = num(P.track.breakeven), wr = num(P.track.win_rate_pct);
    rec('track: wins+losses+breakeven == total_closed', (w + l + be === tc) ? 'PASS' : 'FAIL', `${w}+${l}+${be}=${w + l + be} vs ${tc}`);
    const exp = tc > 0 ? Math.round(w / tc * 100) : 0; rec('track: win_rate_pct correct', Math.abs(wr - exp) <= 1 ? 'PASS' : 'FAIL', `reported=${wr} computed≈${exp}`);
    if (w === 0 && tc > 0) rec('track: 0 wins across all closed trades', 'WARN', `wins=0 losses=${l}/${tc} — verify settlement vs genuine losing streak`);
  }
  let flagged = 0;
  for (const [name, p] of Object.entries(P)) { if (!p) continue; const out = []; scan(p, '', out); if (out.length) { flagged++; rec(`malformed: ${name}`, 'WARN', out.slice(0, 3).join(' | '), { suspects: out.slice(0, 20) }); } }
  rec('malformed scan complete', flagged ? 'WARN' : 'PASS', `${Object.values(P).filter(Boolean).length} payloads, ${flagged} with suspect numeric formatting (unrounded floats)`);
}

let exitCode = 0;
main().catch((e) => { rec('script error', 'FAIL', String(e.message || e)); }).finally(() => {
  if (userId) { const d = backend('DELETE', `/users/${userId}`); const v = backend('GET', `/users/${userId}`); rec('cleanup: temp user deleted', v.s === 404 ? 'PASS' : 'WARN', `DELETE ${d.s}, verify ${v.s} (404=gone)`); }
  try { rmSync(TMP, { recursive: true, force: true }); } catch {}
  const totals = checks.reduce((m, c) => ((m[c.status] = (m[c.status] || 0) + 1), m), {});
  const stamp = new Date().toISOString();
  const summary = { generated_at: stamp, app: APP, totals, checks };
  const base = join(OUT, `validation-${stamp.replace(/[:.]/g, '-')}`);
  writeFileSync(`${base}.json`, JSON.stringify(summary, null, 2));
  writeFileSync(`${base}.md`, [`# Data Validation — ${stamp}`, `App: ${APP} | totals: ${JSON.stringify(totals)}`, '', '| status | check | detail |', '|---|---|---|', ...checks.map((c) => `| ${c.status} | ${c.name} | ${(c.detail || '').slice(0, 180).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')} |`)].join('\n'));
  console.log('\nTOTALS', JSON.stringify(totals), '\nreport:', `${base}.md`);
  exitCode = (totals.FAIL || 0) > 0 ? 1 : 0;
  process.exit(exitCode);
});

/**
 * Shared Clerk admin session for Vector RTH / E2E audits (mint + delete after).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isAuthFailureStatus } from "./auth-status.mjs";

const CJS = "5.57.0";
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

function fapiHost(publishableKey) {
  try {
    const d = Buffer.from(publishableKey.replace(/^pk_(live|test)_/, ""), "base64")
      .toString("utf8")
      .replace(/\$$/, "");
    if (d.includes(".")) return `https://${d}`;
  } catch {}
  return "https://clerk.blackouttrades.com";
}

export async function mintVectorAuditSession({
  base,
  emailPrefix = "vector-audit",
  email = process.env.AUDIT_EMAIL,
  phone = process.env.AUDIT_PHONE,
} = {}) {
  const BASE = (base || "https://blackouttrades.com").replace(/\/$/, "");
  const SECRET = process.env.CLERK_SECRET_KEY;
  const PUB = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
  if (!SECRET || !PUB) throw new Error("CLERK_SECRET_KEY + NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY required");

  const FAPI = fapiHost(PUB);
  const API = "https://api.clerk.com/v1";
  const EMAIL = email || `${emailPrefix}-${Date.now()}@blackouttrades.com`;
  const PHONE = phone || "+1415555" + String(Math.floor(Math.random() * 9000) + 1000);
  const TMP = join(tmpdir(), `vector-auth-${process.pid}`);
  mkdirSync(TMP, { recursive: true });
  const JAR = join(TMP, "cookies.txt");
  let seq = 0;

  const curl = ({ method = "GET", url, headers = {}, form, urlencodeForm, json, jar = false, saveJar = false }) => {
    const bf = join(TMP, `b${++seq}`);
    const args = ["-sS", "--max-time", "90", "-o", bf, "-w", "%{http_code}", "-A", UA];
    if (method !== "GET") args.push("-X", method);
    for (const [k, v] of Object.entries(headers)) args.push("-H", `${k}: ${v}`);
    if (json) args.push("-H", "Content-Type: application/json", "--data", JSON.stringify(json));
    if (form) for (const [k, v] of Object.entries(form)) args.push("--data", `${k}=${v}`);
    if (urlencodeForm) for (const [k, v] of Object.entries(urlencodeForm)) args.push("--data-urlencode", `${k}=${v}`);
    if (jar) args.push("-b", JAR);
    if (saveJar) args.push("-c", JAR);
    args.push(url);
    try {
      const s = Number(execFileSync("curl", args, { encoding: "utf8", maxBuffer: 80 * 1024 * 1024 }).trim());
      return { s, b: existsSync(bf) ? readFileSync(bf, "utf8") : "" };
    } catch (e) {
      return { s: 0, b: "", err: String(e.message || e).split("\n")[0] };
    }
  };
  const J = (r) => {
    try {
      return JSON.parse(r.b);
    } catch {
      return null;
    }
  };
  const backend = (m, p, j) =>
    curl({ method: m, url: `${API}${p}`, headers: { Authorization: `Bearer ${SECRET}` }, json: j });

  const create = backend("POST", "/users", {
    email_address: [EMAIL],
    phone_number: [PHONE],
    public_metadata: { role: "admin", tier: "premium" },
    skip_password_requirement: true,
    skip_legal_checks: true,
  });
  const cj = J(create);
  let userId = cj?.id;
  if (!userId && /form_identifier_exists/.test(JSON.stringify(cj?.errors || ""))) {
    const lookup = curl({
      method: "GET",
      url: `${API}/users?email_address=${encodeURIComponent(EMAIL)}`,
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    userId = J(lookup)?.[0]?.id;
    if (userId) {
      backend("PATCH", `/users/${userId}`, { public_metadata: { role: "admin", tier: "premium" } });
    }
  }
  if (!userId) throw new Error(`Clerk user create failed: ${create.b.slice(0, 200)}`);

  const ticket = J(backend("POST", "/sign_in_tokens", { user_id: userId }))?.token;
  if (!ticket) throw new Error("sign_in_token failed");

  const si = curl({
    method: "POST",
    url: `${FAPI}/v1/client/sign_ins?_clerk_js_version=${CJS}`,
    headers: { Origin: BASE, Referer: `${BASE}/`, "Content-Type": "application/x-www-form-urlencoded" },
    form: { strategy: "ticket" },
    urlencodeForm: { ticket },
    saveJar: true,
    jar: true,
  });
  const sid = J(si)?.response?.created_session_id;
  if (!sid) throw new Error(`FAPI ticket exchange failed: ${si.b.slice(0, 200)}`);

  const clientUat = Math.floor(Date.now() / 1000);
  let tok = J(
    curl({
      method: "POST",
      url: `${FAPI}/v1/client/sessions/${sid}/tokens?_clerk_js_version=${CJS}`,
      headers: { Origin: BASE, Referer: `${BASE}/`, "Content-Type": "application/x-www-form-urlencoded" },
      jar: true,
      saveJar: true,
    })
  )?.jwt;

  const app = (path, opts = {}) => {
    for (let i = 0; i < 2; i++) {
      if (!tok) {
        tok = J(
          curl({
            method: "POST",
            url: `${FAPI}/v1/client/sessions/${sid}/tokens?_clerk_js_version=${CJS}`,
            headers: {
              Origin: BASE,
              Referer: `${BASE}/`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            jar: true,
            saveJar: true,
          })
        )?.jwt;
      }
      const r = curl({
        method: opts.method || "GET",
        url: `${BASE}${path}`,
        headers: {
          Cookie: `__session=${tok}; __client_uat=${clientUat}`,
          Accept: opts.accept || "application/json",
          ...(opts.headers || {}),
        },
        json: opts.json,
      });
      if (isAuthFailureStatus(r.s)) {
        tok = null;
        continue;
      }
      return { status: r.s, json: J(r), raw: r.b };
    }
    return { status: 401, json: null, raw: "" };
  };

  return {
    userId,
    email: EMAIL,
    clientUat,
    sessionToken: () => tok,
    app,
    cleanup: () => {
      backend("DELETE", `/users/${userId}`);
      try {
        rmSync(TMP, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

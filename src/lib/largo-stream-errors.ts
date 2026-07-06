import { isIosAppShell } from "@/lib/ios-app-shell";

/** Map Largo SSE / fetch failures to honest, actionable user copy. */
export function largoStreamErrorMessage(
  raw: string,
  opts?: { ios?: boolean }
): string {
  const lower = raw.toLowerCase();
  const ios = opts?.ios ?? (typeof window !== "undefined" && isIosAppShell());

  if (raw.includes("401")) return "Sign in with Premium to reach Largo.";
  if (raw.includes("403")) {
    return ios
      ? "Largo is a Premium instrument. Membership is managed on the web."
      : "Largo is a Premium instrument. Unlock Premium to deploy it.";
  }
  if (raw.includes("429")) {
    if (lower.includes("daily") || lower.includes("limit reached")) {
      return "Daily Largo query limit reached. Try again after midnight ET.";
    }
    return "Too many active Largo sessions. Wait for your previous query to finish, then retry.";
  }
  if (lower.includes("daily largo query limit") || lower.includes("query limit reached")) {
    return "Daily Largo query limit reached. Try again after midnight ET.";
  }
  if (raw.includes("502") || lower.includes("largo query failed")) {
    return "Largo couldn't complete that query. Try again in a moment.";
  }
  if (raw.includes("503") || lower.includes("temporarily unavailable")) {
    return "Largo offline — the desk will reconnect shortly.";
  }
  if (lower.includes("timeout") || lower.includes("aborted")) {
    return "Largo is still working on a long pull — the connection timed out. Send your question again.";
  }
  if (lower.includes("stream ended without result") || lower.includes("stream unavailable")) {
    return "Connection dropped before Largo finished. Ask again — live data pulls can take up to a minute.";
  }
  return "Connection interrupted — couldn't reach live data. Send your question again.";
}

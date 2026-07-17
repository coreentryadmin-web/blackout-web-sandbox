/**
 * Institutional tone for Largo/BIE member-facing markdown — no emoji, no casual hedging
 * that implies fabricated data. Applied on deterministic compose paths only.
 */

const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu;

const CASUAL_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bgonna\b/gi, "going to"],
  [/\bgonna rip or dip\b/gi, "rally or sell off"],
  [/\brip or dip\b/gi, "rally or sell off"],
  [/\blotta\b/gi, "a lot of"],
  [/\byeah\b/gi, "yes"],
  [/\bnope\b/gi, "no"],
];

/** Strip emoji and casual phrasing from a composed answer string. */
export function toProfessionalMarkdown(text: string): string {
  let out = text.replace(EMOJI_RE, "").replace(/\s{2,}/g, " ");
  for (const [re, rep] of CASUAL_REPLACEMENTS) {
    out = out.replace(re, rep);
  }
  return out
    .split("\n")
    .map((l) => l.replace(/\s{2,}/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Scoring heuristics for stress harnesses — flags unprofessional or speculative copy. */
export function toneIssues(answer: string): string[] {
  const issues: string[] = [];
  if (EMOJI_RE.test(answer)) issues.push("emoji");
  if (/\b(i think|i believe|probably|maybe|might be|could be around|approximately)\b/i.test(answer)) {
    issues.push("speculative");
  }
  if (/\b(guarantee|sure thing|can't lose|free money|100% win)\b/i.test(answer)) {
    issues.push("overconfident");
  }
  if (/\?\?\?|\!\!\!/.test(answer)) issues.push("casual-punctuation");
  return issues;
}

/** Flags answers that look like invented platform dumps vs live reads. */
export function honestyIssues(answer: string, intent?: string | null): string[] {
  const issues: string[] = [];
  if (/Zero Claude cost/i.test(answer) && intent !== "platform_read" && intent !== "market_context") {
    issues.push("marketing-tag");
  }
  if (/\b(unavailable|no data|not available|couldn't compose|rephrase)\b/i.test(answer)) {
    return issues;
  }
  if (answer.length > 80 && !/\d/.test(answer) && !/\b(none|flat|inactive|scanning)\b/i.test(answer)) {
    issues.push("no-grounded-numbers");
  }
  return issues;
}

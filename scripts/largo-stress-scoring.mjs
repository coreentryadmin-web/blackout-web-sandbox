/**
 * Shared scoring for Largo stress harnesses — intent, dump avoidance, tone, honesty.
 */
import { toneIssues, honestyIssues } from "../src/lib/bie/professional-tone.ts";

export function intentMatches(actual, hint) {
  if (hint == null) return actual == null;
  if (typeof hint === "string") return actual === hint;
  return hint.test(actual ?? "");
}

export function scoreAnswer(entry, route, answer, status) {
  const issues = [];
  if (status !== 200) issues.push(`http-${status}`);
  if (!answer || answer.length < 15) issues.push("too-short");
  if (entry.avoidDump && entry.avoidDump.test(answer)) issues.push("platform-dump");
  if (answer && answer.length > 3500 && !/compound_lookup|platform_read|spx_desk_read/.test(String(route?.intent))) {
    issues.push("bloated");
  }
  if (entry.intent && route && !entry.intentOptional && !intentMatches(route.intent, entry.intent)) {
    issues.push(`intent-want-${entry.intent}-got-${route.intent}`);
  }
  if (entry.requireTopic && !entry.requireTopic.test(answer)) issues.push("missed-topic");
  for (const t of toneIssues(answer ?? "")) issues.push(`tone-${t}`);
  for (const h of honestyIssues(answer ?? "", route?.intent)) issues.push(`honesty-${h}`);
  const verdict =
    issues.length === 0
      ? "OK"
      : issues.some(
            (i) =>
              i.startsWith("intent") ||
              i === "platform-dump" ||
              i === "missed-topic" ||
              i.startsWith("honesty-no-grounded")
          )
        ? "BAD"
        : "WARN";
  return { verdict, issues };
}

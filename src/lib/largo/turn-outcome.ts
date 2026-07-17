import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";
import { isRichBieEnvelope } from "@/lib/bie/envelope-richness";
import { bieFollowups, bieIntentBucket } from "@/lib/bie/router";
import { collectContextNumbers, verifyClaims, type ClaimVerification } from "@/lib/bie/verifier";
import { dbConfigured, insertBieInteraction } from "@/lib/db";
import { appendLargoMessage } from "@/lib/largo/largo-store";
import type { BieRoutedAnswer } from "@/lib/largo/bie-route";

const BIE_TOOL = "blackout_intelligence";

export function applyVerificationCaveat(text: string, verification: ClaimVerification): string {
  if (verification.total >= 4 && verification.coverage < 0.5) {
    return (
      text +
      `\n\n_BIE verification: ${verification.total - verification.verified} of ${verification.total} figures in this answer could not be traced to data pulled this turn — treat those specific numbers with caution._`
    );
  }
  return text;
}

function logBieInteraction(row: {
  user_id: string | null;
  question: string;
  intent: string | null;
  answer_source: string;
  claims_total: number | null;
  claims_verified: number | null;
  latency_ms: number | null;
  tools_used: string[];
  intent_bucket: string;
}): void {
  if (!dbConfigured()) return;
  void insertBieInteraction(row).catch(() => {});
}

export type BieTurnResult = {
  session_id: string;
  answer: string;
  source: "blackout-intelligence";
  tools_used: string[];
  followups: string[];
  verification: ClaimVerification;
  envelope?: BieAnswerEnvelope;
};

export async function finalizeBieRoutedTurn(params: {
  sessionId: string;
  userId: string;
  question: string;
  routed: BieRoutedAnswer;
  startedAt: number;
}): Promise<BieTurnResult> {
  const sid = params.sessionId.trim() || `web-${params.userId}-${Date.now()}`;
  const verification = verifyClaims(params.routed.answer, collectContextNumbers(params.routed.context));

  await appendLargoMessage(sid, params.userId, "user", params.question);
  await appendLargoMessage(sid, params.userId, "assistant", params.routed.answer, [BIE_TOOL], [
    params.routed.context,
  ]);

  logBieInteraction({
    user_id: params.userId,
    question: params.question,
    intent: params.routed.route.intent,
    answer_source: "bie-router",
    claims_total: verification.total,
    claims_verified: verification.verified,
    latency_ms: Date.now() - params.startedAt,
    tools_used: [BIE_TOOL],
    intent_bucket: bieIntentBucket(params.routed.route.intent),
  });

  return {
    session_id: sid,
    answer: params.routed.answer,
    source: "blackout-intelligence",
    tools_used: [BIE_TOOL],
    followups: bieFollowups(params.routed.route.intent),
    verification,
    envelope: isRichBieEnvelope(params.routed.envelope) ? params.routed.envelope ?? undefined : undefined,
  };
}

export function logClaudeTurn(params: {
  userId: string;
  question: string;
  toolsUsed: string[];
  verification: ClaimVerification;
  startedAt: number;
  answerSource?: "claude" | "error";
}): void {
  logBieInteraction({
    user_id: params.userId,
    question: params.question,
    intent: null,
    answer_source: params.answerSource ?? "claude",
    claims_total: params.answerSource === "error" ? null : params.verification.total,
    claims_verified: params.answerSource === "error" ? null : params.verification.verified,
    latency_ms: Date.now() - params.startedAt,
    tools_used: Array.from(new Set(params.toolsUsed)),
    intent_bucket: bieIntentBucket(null),
  });
}

export async function persistClaudeTurn(params: {
  sessionId: string;
  userId: string;
  question: string;
  answer: string;
  toolsUsed: string[];
  capturedResults: unknown[];
}): Promise<void> {
  const sid = params.sessionId.trim() || `web-${params.userId}-${Date.now()}`;
  const tools = Array.from(new Set(params.toolsUsed));
  await appendLargoMessage(sid, params.userId, "user", params.question);
  await appendLargoMessage(sid, params.userId, "assistant", params.answer, tools, params.capturedResults);
}

import { largoBieOnly } from "@/lib/ai-env";
import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";
import { composeBieAnswer, composeCompound } from "@/lib/bie/composers";
import { isCompoundQuestion } from "@/lib/bie/decompose";
import { largoRouteStatus } from "@/lib/bie/largo-status";
import {
  classifyBieIntent,
  classifyBieStagingFallback,
  isSpxDeskFallbackQuestion,
  type BieRoute,
} from "@/lib/bie/router";
import { readZeroDteLedger } from "@/lib/zerodte/scan";

export type BieRoutedAnswer = {
  route: BieRoute;
  answer: string;
  context: unknown;
  envelope: BieAnswerEnvelope | null;
};

function composerFailedMessage(route: BieRoute): string {
  const t = route.ticker?.toUpperCase() || "that ticker";
  const intent = route.intent.replace(/_/g, " ");
  return (
    `I matched your question to a **${intent}** read` +
    (route.ticker ? ` for **${t}**` : "") +
    `, but I couldn't compose the answer right now — the data may be temporarily unavailable. ` +
    `Try again in a moment, or rephrase your question.`
  );
}

/**
 * Deterministic BIE router for Largo — returns null when no match (Claude fallback).
 * Staging BIE-only mode uses classifyBieStagingFallback so null is rare there.
 */
export async function tryBieRoute(
  question: string,
  opts?: { onStatus?: (message: string) => void; userId?: string }
): Promise<BieRoutedAnswer | null> {
  try {
    const ledger = await readZeroDteLedger().catch(() => []);
    const ledgerTickers = new Set(ledger.map((r) => r.ticker));

    if (isCompoundQuestion(question)) {
      opts?.onStatus?.("Decomposing compound question — parallel fan-out…");
      const composed = await composeCompound(question, ledgerTickers);
      if (composed) {
        return {
          route: { intent: "compound_lookup", ticker: null },
          answer: composed.answer,
          context: composed.context,
          envelope: composed.envelope ?? null,
        };
      }
    }

    const route = classifyBieIntent(question, ledgerTickers);
    if (route) {
      opts?.onStatus?.(largoRouteStatus(route));
      const composed = await composeBieAnswer(route, {
        question,
        onStatus: opts?.onStatus,
        userId: opts?.userId,
      });
      if (composed) {
        return { route, answer: composed.answer, context: composed.context, envelope: composed.envelope ?? null };
      }
      return {
        route,
        answer: composerFailedMessage(route),
        context: { reason: "composer_returned_null", route },
        envelope: null,
      };
    }

    if (isSpxDeskFallbackQuestion(question)) {
      opts?.onStatus?.("Broad SPX ask — routing to Live Desk brief…");
      const composed = await composeBieAnswer({ intent: "spx_desk_read", ticker: "SPX" }, {
        question,
        onStatus: opts?.onStatus,
        userId: opts?.userId,
      });
      if (composed) {
        return {
          route: { intent: "spx_desk_read", ticker: "SPX" },
          answer: composed.answer,
          context: composed.context,
          envelope: composed.envelope ?? null,
        };
      }
    }

    if (largoBieOnly()) {
      const fallback = classifyBieStagingFallback(question);
      opts?.onStatus?.(largoRouteStatus(fallback));
      const composed = await composeBieAnswer(fallback, {
        question,
        onStatus: opts?.onStatus,
        userId: opts?.userId,
      });
      if (composed) {
        return { route: fallback, answer: composed.answer, context: composed.context, envelope: composed.envelope ?? null };
      }
      const clarify = await composeBieAnswer({ intent: "clarify_read", ticker: null }, {
        question,
        onStatus: opts?.onStatus,
        userId: opts?.userId,
      });
      if (clarify) {
        return {
          route: { intent: "clarify_read", ticker: null },
          answer: clarify.answer,
          context: clarify.context,
          envelope: clarify.envelope ?? null,
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}

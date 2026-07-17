/** Parse member question shape — narrow composers vs full desk dumps. */

import { lookupGlossary } from "./glossary";

export function wantsBrevity(question: string): boolean {
  return /\b(one sentence|in one line|briefly|tldr|short answer|just tell me)\b/i.test(question);
}

export function wantsPutWallOnly(question: string): boolean {
  return /\bput wall\b/i.test(question) && !/\b(call wall|full|setup|read)\b/i.test(question);
}

export function wantsCallWallOnly(question: string): boolean {
  return /\bcall wall\b/i.test(question) && !/\b(put wall|full|setup|read)\b/i.test(question);
}

export function wantsKingNodeOnly(question: string): boolean {
  return /\bking node\b/i.test(question) && !/\b(full|setup|read|everything)\b/i.test(question);
}

export function wantsGammaFlipOnly(question: string): boolean {
  return /\bgamma flip\b/i.test(question) && !/\b(call wall|put wall|setup|read)\b/i.test(question);
}

export function wantsCharmLens(question: string): boolean {
  return /\bcharm\b/i.test(question) && !/\b(what is|define|explain)\b/i.test(question);
}

export function wantsHelixPrintList(question: string): boolean {
  return (
    /\b(top \d+|list only|prints? by premium|biggest prints?|largest prints?)\b/i.test(question) &&
    /\b(helix|flow|tape|print)/i.test(question)
  );
}

export function wantsEngineState(question: string): boolean {
  return /\b(play engine|slayer engine|engine state|engine long|engine short|long or short)\b/i.test(question);
}

export function wantsLottoState(question: string): boolean {
  return /\blotto\b/i.test(question) && /\b(engine|state|phase)\b/i.test(question);
}

export function wantsVixOnly(question: string): boolean {
  return /\bvix\b/i.test(question) && !/\b(full|platform|everything|market doing)\b/i.test(question);
}

export function wantsMatrixDelta(question: string): boolean {
  return (
    (/\bmatrix\b/i.test(question) && /\b(changed|change|shift|last \d+ min|delta since)\b/i.test(question)) ||
    (/\b(changed|change|shift)\b/i.test(question) && /\bmatrix\b/i.test(question))
  );
}

export function wantsGexVexCompare(question: string): boolean {
  return /\b(gex|gamma)\b/i.test(question) && /\b(vex|vanna)\b/i.test(question);
}

export function wantsThermalDeskCompare(question: string): boolean {
  return /\bthermal\b/i.test(question) && /\b(agree|align|match|vs|versus)\b/i.test(question) && /\bdesk\b/i.test(question);
}

export function wantsContradictionExplain(question: string): boolean {
  return /\b(bearish|bullish)\b.*\b(bearish|bullish)\b/i.test(question) && /\b(same|both|contradict|why did you)\b/i.test(question);
}

export function wantsPowerHour(question: string): boolean {
  return /\bpower hour\b/i.test(question) && /\b(phase|state|engine|spx)\b/i.test(question);
}

export function shouldAvoidSpxDeskDump(question: string): boolean {
  return (
    wantsBrevity(question) ||
    wantsEngineState(question) ||
    wantsLottoState(question) ||
    wantsPowerHour(question) ||
    wantsPutWallOnly(question) ||
    wantsCallWallOnly(question) ||
    wantsKingNodeOnly(question) ||
    wantsHelixPrintList(question) ||
    wantsCharmLens(question) ||
    wantsGexVexCompare(question) ||
    wantsThermalDeskCompare(question) ||
    wantsMatrixDelta(question) ||
    wantsVixOnly(question)
  );
}

export function wantsHonestUnknown(question: string): boolean {
  return /\b(don'?t know|cannot know|something you don'?t|what can'?t you)\b/i.test(question);
}

const KNOWN_TOKEN =
  /\b(spx|s&p|spy|qqq|vix|gex|vex|dex|charm|gamma|flip|wall|helix|thermal|matrix|flow|play|lotto|engine|nighthawk|nvda|amd|0dte|grid|scanner|vwap|dealer|king|node|market|tape|verdict|compare|earnings|cortex|playbook|nh|dark pool|max pain)\b/i;

/** Gibberish / too vague — don't dump market context. */
export function isNonsenseQuestion(question: string): boolean {
  const q = question.trim();
  if (!q) return true;
  if (lookupGlossary(q)) return false;
  if (/^(nh|playbook|cortex)(\s+[a-z]{1,5})?$/i.test(q)) return false;
  if (/\bnh\s+[a-z]{1,5}\b/i.test(q)) return false;
  if (/^[0-9.?!\s]+$/.test(q)) return true;
  if (/^[a-z]{9,}$/i.test(q) && !KNOWN_TOKEN.test(q)) return true;
  if (q.length < 6 && !KNOWN_TOKEN.test(q) && !/\$?[A-Z]{1,5}\b/.test(q)) return true;
  return false;
}

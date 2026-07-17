#!/usr/bin/env node
/** Local router-only scoring for difficult questions (no HTTP). */
import { classifyBieIntent, classifyBieStagingFallback } from "../src/lib/bie/router.ts";

const QUESTIONS = [
  "just the SPX put wall",
  "what's charm doing on SPX 0DTE",
  "list only the top 3 HELIX prints by premium",
  "grid scanner rejections last hour",
  "SPX lotto engine state",
  "only answer in one sentence: SPX direction",
  "asdfghjkl",
  "tell me something you don't know",
  "is the play engine long or short right now",
  "what's the king node on SPX right now",
];

for (const q of QUESTIONS) {
  const r = classifyBieIntent(q, new Set()) ?? classifyBieStagingFallback(q);
  console.log(`${r.intent.padEnd(22)} | ${q}`);
}

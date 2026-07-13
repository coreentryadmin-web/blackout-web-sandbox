import test from "node:test";
import assert from "node:assert/strict";
import { buildVectorTerminalLines, buildVectorPlayLines } from "./vector-terminal-lines";
import type { VectorWallEvent } from "./vector-wall-events";
import type { VectorPlay } from "./vector-play-engine";

test("buildVectorTerminalLines: empty events show polling copy", () => {
  const lines = buildVectorTerminalLines("NVDA", "gex", [], true);
  const text = lines.map((l) => l.text).join("\n");
  assert.match(text, /VECTOR · NVDA · GEX structure/);
  assert.match(text, /No GEX structure shifts yet/);
});

test("buildVectorTerminalLines: filters events by active lens", () => {
  const events: VectorWallEvent[] = [
    {
      kind: "call_wall_shift",
      lens: "gex",
      time: 1_700_000_000,
      message: "Call wall shifted to 500",
      severity: "info",
    },
    {
      kind: "put_wall_shift",
      lens: "vex",
      time: 1_700_000_060,
      message: "VEX put wall shifted",
      severity: "info",
    },
  ];
  const lines = buildVectorTerminalLines("SPY", "gex", events, true);
  const text = lines.map((l) => l.text).join("\n");
  assert.match(text, /Call wall shifted to 500/);
  assert.doesNotMatch(text, /VEX put wall/);
});

const samplePlay: VectorPlay = {
  style: "scalp",
  bias: "short",
  conviction: 82,
  grade: "A",
  headline: "SCALP · fade the 7,600 call wall — short back toward VWAP 7,562",
  thesis: "Long gamma: dealers sell strength, so the 7,600 call wall caps.",
  entryZone: "short into 7,600 call wall",
  targets: ["VWAP 7,562", "magnet 7,555"],
  invalidation: "5m close > 7,600 (wall breaks → fade void)",
  starred: [
    "SCALP · fade the 7,600 call wall — short back toward VWAP 7,562",
    "7,600 call wall at — dealers sell into strength",
    "BIE · setups like this resolved 68% fav over 214 · 60d",
  ],
  dataAge: null,
};

test("buildVectorPlayLines: renders the hero block with grade/conviction, headline, entry/targets/invalidation", () => {
  const lines = buildVectorPlayLines(samplePlay);
  const text = lines.map((l) => l.text).join("\n");
  assert.match(text, /PLAY · SCALP · Grade A · conviction 82\/100/);
  assert.match(text, /★ SCALP · fade the 7,600 call wall/);
  assert.match(text, /Entry — short into 7,600 call wall/);
  assert.match(text, /Targets — VWAP 7,562 → magnet 7,555/);
  assert.match(text, /Invalidation — 5m close > 7,600/);
  // Grade A headline is toned bull.
  const headline = lines.find((l) => l.text.startsWith("★ SCALP"));
  assert.equal(headline?.tone, "bull");
});

test("buildVectorPlayLines: WATCH NOW lists the starred set EXCEPT the headline, each ★-marked", () => {
  const lines = buildVectorPlayLines(samplePlay);
  const text = lines.map((l) => l.text).join("\n");
  assert.match(text, /WATCH NOW/);
  assert.match(text, /★ 7,600 call wall at/);
  assert.match(text, /★ BIE · setups like this resolved 68% fav over 214 · 60d/);
  // The headline is NOT duplicated into the WATCH NOW list (it's starred[0], already the hero line).
  const watchStars = lines.filter((l) => l.indent === 2 && l.text.startsWith("★"));
  assert.equal(watchStars.length, 2);
});

test("buildVectorPlayLines: null play → no block (terminal keeps its prior layout)", () => {
  assert.deepEqual(buildVectorPlayLines(null), []);
});

test("buildVectorPlayLines: grade C headline is muted, grade B accented", () => {
  const c = buildVectorPlayLines({ ...samplePlay, grade: "C", conviction: 40 });
  assert.equal(c.find((l) => l.text.startsWith("★"))?.tone, "neutral");
  const b = buildVectorPlayLines({ ...samplePlay, grade: "B", conviction: 62 });
  assert.equal(b.find((l) => l.text.startsWith("★"))?.tone, "accent");
});

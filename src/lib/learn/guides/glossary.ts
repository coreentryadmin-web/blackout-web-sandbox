import type { LearnGuide } from "@/lib/learn/types";
import { CROSS } from "@/lib/learn/guides/shared";

const CATEGORIES = [
  {
    name: "Dealer Greeks",
    terms: [
      { term: "CHARM", def: "Rate of change of delta with respect to time. Drives dealer hedge adjustments into expiry — material on 0DTE." },
      { term: "DEX", def: "Aggregate dealer delta exposure — directional hedge the book must hold." },
      { term: "GEX", def: "Gamma exposure by strike. Positive GEX stabilizes; negative GEX amplifies." },
      { term: "VEX", def: "Sensitivity of dealer delta to IV changes — critical around events." },
    ],
  },
  {
    name: "Structural levels",
    terms: [
      { term: "Call Wall", def: "Largest positive gamma concentration above spot — mechanical resistance zone." },
      { term: "Put Wall", def: "Largest negative gamma concentration below spot — fragile support." },
      { term: "Gamma Flip", def: "Price where aggregate dealer gamma changes sign — regime boundary." },
      { term: "King Node", def: "Highest absolute GEX strike of the session." },
    ],
  },
  {
    name: "Platform",
    terms: [
      { term: "Evening Edition", def: "Night Hawk nightly publication for the next session." },
      { term: "SCANNING", def: "SPX Slayer engine state — gates not aligned." },
      { term: "Verdict", def: "Night's Watch guidance: HOLD, TRIM, SELL, or WATCH." },
      { term: "RTH", def: "Regular Trading Hours, 9:30 AM – 4:00 PM ET." },
    ],
  },
];

export const glossaryGuide: LearnGuide = {
  slug: "glossary",
  chapter: 9,
  title: "Glossary",
  description:
    "Canonical definitions for metrics and platform terms used across every chapter. Searchable index with links to related tool guides.",
  kicker: "Chapter 9 · Reference",
  sections: [
    {
      type: "prose",
      id: "intro",
      title: "How to use this reference",
      paragraphs: [
        "Terms here appear across SPX Slayer, Thermal, HELIX, and Night Hawk documentation. When a chapter mentions GEX, IVP, or SCANNING, return here for the precise definition.",
        "For workflow context, start with Getting Started and the tool-specific chapters linked below.",
      ],
    },
    { type: "glossary", id: "terms", title: "Terms A–Z", categories: CATEGORIES },
    {
      type: "cross-links",
      id: "chapters",
      title: "Related chapters",
      links: [
        CROSS.spx("Play engine and wall definitions in context."),
        CROSS.thermal("Visual GEX surface terminology."),
        CROSS.helix("Flow and sweep vocabulary."),
      ],
    },
  ],
};

export { CATEGORIES as GLOSSARY_CATEGORIES };

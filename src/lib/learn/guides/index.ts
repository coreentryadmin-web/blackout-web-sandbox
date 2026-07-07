export { gettingStartedGuide } from "@/lib/learn/guides/getting-started";
export {
  spxSlayerGuide,
  helixFlowsGuide,
  largoAiGuide,
  nightHawkGuide,
  heatMapsGuide,
  blackoutGridGuide,
} from "@/lib/learn/guides/tool-guides";
export { glossaryGuide } from "@/lib/learn/guides/glossary";

import type { LearnSlug } from "@/lib/learn/nav";
import type { LearnGuide } from "@/lib/learn/types";
import { gettingStartedGuide } from "@/lib/learn/guides/getting-started";
import {
  spxSlayerGuide,
  helixFlowsGuide,
  largoAiGuide,
  nightHawkGuide,
  heatMapsGuide,
  blackoutGridGuide,
} from "@/lib/learn/guides/tool-guides";
import { glossaryGuide } from "@/lib/learn/guides/glossary";

const GUIDES: Record<LearnSlug, LearnGuide> = {
  "getting-started": gettingStartedGuide,
  "spx-slayer": spxSlayerGuide,
  "helix-flows": helixFlowsGuide,
  "largo-ai": largoAiGuide,
  "night-hawk": nightHawkGuide,
  "heat-maps": heatMapsGuide,
  "blackout-grid": blackoutGridGuide,
  glossary: glossaryGuide,
};

export function getLearnGuide(slug: LearnSlug): LearnGuide {
  return GUIDES[slug];
}

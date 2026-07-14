/** Gate block taxonomy for playbook live path (FULL-SPEC §6 / external review P1). */
export type GateBlockCategory = "operational" | "risk" | "playbook_validity" | "quality";

export type CategorizedGateBlocks = Record<GateBlockCategory, string[]>;

const EMPTY: CategorizedGateBlocks = {
  operational: [],
  risk: [],
  playbook_validity: [],
  quality: [],
};

function matchesAny(msg: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(msg));
}

/** Classify a single gate block message — first match wins. */
export function classifyGateBlock(message: string): GateBlockCategory {
  const msg = message.trim();
  if (!msg) return "quality";

  if (
    matchesAny(msg, [
      /^Session closed/i,
      /^Macro hard block/i,
      /^Pre-market/i,
      /^After \d/i,
      /^Before 7:/i,
      /^Opening range/i,
      /^Trading halt/i,
      /^Halt feed/i,
      /^halt/i,
    ])
  ) {
    return "operational";
  }

  if (
    matchesAny(msg, [
      /playbook live gate/i,
      /not in live allowlist/i,
      /not paper-executable/i,
      /No playbook trigger/i,
      /Unknown EMA regime/i,
      /degraded feed/i,
      /Severe data quality/i,
      /Playbook lab/i,
    ])
  ) {
    return "playbook_validity";
  }

  if (
    matchesAny(msg, [
      /cooldown/i,
      /Re-entry lock/i,
      /Session entry cap/i,
      /Session loss cap/i,
      /^VIX /i,
      /^R:R /i,
      /stand down/i,
    ])
  ) {
    return "risk";
  }

  return "quality";
}

export function categorizeGateBlocks(blocks: readonly string[]): CategorizedGateBlocks {
  const out: CategorizedGateBlocks = {
    operational: [],
    risk: [],
    playbook_validity: [],
    quality: [],
  };
  for (const block of blocks) {
    out[classifyGateBlock(block)].push(block);
  }
  return out;
}

export function emptyCategorizedGateBlocks(): CategorizedGateBlocks {
  return { ...EMPTY, operational: [], risk: [], playbook_validity: [], quality: [] };
}

const GATE_LAYER_ORDER: readonly GateBlockCategory[] = [
  "operational",
  "playbook_validity",
  "risk",
  "quality",
];

/** First failing layer for layered gate evaluation telemetry. */
export function firstGateBlockCategory(blocks: readonly string[]): GateBlockCategory | null {
  if (!blocks.length) return null;
  const categorized = categorizeGateBlocks(blocks);
  for (const layer of GATE_LAYER_ORDER) {
    if (categorized[layer].length > 0) return layer;
  }
  return classifyGateBlock(blocks[0]);
}

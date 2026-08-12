import type { Tier } from "./rotation";

export function stripModelSuffix(model: string): string {
  return model.replace(/\[.*?\]$/g, "").trim();
}

function buildModelSet(models: readonly string[]): Set<string> {
  const set = new Set<string>();
  for (const m of models) {
    set.add(m);
    set.add(stripModelSuffix(m));
  }
  return set;
}

export function createTierDetector(config: {
  opus: readonly string[];
  sonnet: readonly string[];
  haiku: readonly string[];
}): (requestModel: string | undefined) => Tier {
  const opusSet = buildModelSet(config.opus);
  const sonnetSet = buildModelSet(config.sonnet);
  const haikuSet = buildModelSet(config.haiku);

  return (requestModel: string | undefined): Tier => {
    if (!requestModel) return "sonnet";

    const stripped = stripModelSuffix(requestModel);

    if (opusSet.has(stripped) || opusSet.has(requestModel)) return "opus";
    if (sonnetSet.has(stripped) || sonnetSet.has(requestModel)) return "sonnet";
    if (haikuSet.has(stripped) || haikuSet.has(requestModel)) return "haiku";

    return "sonnet";
  };
}

import { HAIKU_MODELS, SONNET_MODELS, OPUS_MODELS } from "../config";

export const detectTier = createTierDetector({
  opus: OPUS_MODELS,
  sonnet: SONNET_MODELS,
  haiku: HAIKU_MODELS,
});

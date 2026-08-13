import type { Tier } from "./rotation";
import { config } from "../config";

export function stripModelSuffix(model: string): string {
  return model.replace(/\[.*?\]$/g, "").trim();
}

function buildModelSet(models: readonly string[]): Set<string> {
  const modelSet = new Set<string>();

  for (const model of models) {
    modelSet.add(model);
    modelSet.add(stripModelSuffix(model));
  }

  return modelSet;
}

export function createTierDetector({ haiku, opus, sonnet }: {
  opus: readonly string[];
  sonnet: readonly string[];
  haiku: readonly string[];
}): (requestModel: string | undefined) => Tier {
  const opusSet = buildModelSet(opus);
  const sonnetSet = buildModelSet(sonnet);
  const haikuSet = buildModelSet(haiku);

  return (requestModel: string | undefined): Tier => {
    if (!requestModel) {
      return "sonnet";
    }

    const stripped = stripModelSuffix(requestModel);

    if (opusSet.has(stripped) || opusSet.has(requestModel)) {
      return "opus";
    }

    if (sonnetSet.has(stripped) || sonnetSet.has(requestModel)) {
      return "sonnet";
    }

    if (haikuSet.has(stripped) || haikuSet.has(requestModel)) {
      return "haiku";
    }
    
    return "sonnet";
  };
}

export const detectTier = createTierDetector({
  opus: config.opusModels,
  sonnet: config.sonnetModels,
  haiku: config.haikuModels,
});

import { GeminiRotationManager } from "./rotation";
import { config } from "../config";
import { keyFingerprint } from "./rotation";
import { log } from "../utils/logger.util";

export const rotationManager = new GeminiRotationManager({
  keys: config.geminiApiKeys,
  tierModels: {
    opus: [...config.opusModels],
    sonnet: [...config.sonnetModels],
    haiku: [...config.haikuModels],
  },
  cooldownMs: config.rotationCooldownSeconds * 1000,
  mode: config.rotationMode,
});

log("info", "Rotation manager initialized", {
  mode: config.rotationMode,
  keys: config.geminiApiKeys.map((key) => keyFingerprint(key)),
  opus: [...config.opusModels],
  sonnet: [...config.sonnetModels],
  haiku: [...config.haikuModels],
  cooldownSeconds: config.rotationCooldownSeconds,
});

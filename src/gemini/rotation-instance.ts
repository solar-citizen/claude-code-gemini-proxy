import { GeminiRotationManager } from "./rotation";
import {
  GEMINI_API_KEYS,
  HAIKU_MODELS,
  SONNET_MODELS,
  OPUS_MODELS,
  ROTATION_COOLDOWN_SECONDS,
} from "../config";
import { keyFingerprint } from "./rotation";
import { log } from "../utils/logger.util";

export const rotationManager = new GeminiRotationManager({
  keys: GEMINI_API_KEYS,
  tierModels: {
    opus: [...OPUS_MODELS],
    sonnet: [...SONNET_MODELS],
    haiku: [...HAIKU_MODELS],
  },
  cooldownMs: ROTATION_COOLDOWN_SECONDS * 1000,
});

log("info", "Rotation manager initialized", {
  keys: GEMINI_API_KEYS.map((k) => keyFingerprint(k)),
  opus: [...OPUS_MODELS],
  sonnet: [...SONNET_MODELS],
  haiku: [...HAIKU_MODELS],
  cooldownSeconds: ROTATION_COOLDOWN_SECONDS,
});

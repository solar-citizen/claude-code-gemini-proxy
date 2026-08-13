import { GeminiRotationManager } from "./rotation";
import {
  GEMINI_API_KEYS,
  HAIKU_MODELS,
  SONNET_MODELS,
  OPUS_MODELS,
  ROTATION_COOLDOWN_SECONDS,
  ROTATION_MODE,
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
  mode: ROTATION_MODE,
});

log("info", "Rotation manager initialized", {
  mode: ROTATION_MODE,
  keys: GEMINI_API_KEYS.map((k) => keyFingerprint(k)),
  opus: [...OPUS_MODELS],
  sonnet: [...SONNET_MODELS],
  haiku: [...HAIKU_MODELS],
  cooldownSeconds: ROTATION_COOLDOWN_SECONDS,
});

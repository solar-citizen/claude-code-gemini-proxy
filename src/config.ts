function parseApiKeys(): string[] {
  const multi = process.env.GEMINI_API_KEYS;
  if (multi) {
    const keys = multi.split(",").map((k) => k.trim()).filter(Boolean);
    if (keys.length === 0) {
      console.error("GEMINI_API_KEYS is set but empty after parsing");
      process.exit(1);
    }
    return keys;
  }

  const single = process.env.GEMINI_API_KEY;
  if (!single) {
    console.error("Neither GEMINI_API_KEYS nor GEMINI_API_KEY is set");
    process.exit(1);
  }

  return [single];
}

function parseModelList(envVar: string, fallback: string[]): string[] {
  const raw = process.env[envVar];
  if (!raw) return fallback;
  const models = raw.split(",").map((m) => m.trim()).filter(Boolean);
  return models.length > 0 ? models : fallback;
}

export const GEMINI_API_KEYS: readonly string[] = parseApiKeys();
export const GEMINI_API_KEY: string = GEMINI_API_KEYS[0];

export const DEFAULT_GEMINI_MODEL = process.env.DEFAULT_GEMINI_MODEL ?? "gemini-3.5-flash-lite";
export const PORT = Number(process.env.PORT ?? 8787);
export const LOG_LEVEL = parseInt(process.env.LOG_LEVEL ?? "1", 10);

export const HAIKU_MODELS: readonly string[] = parseModelList(
  "HAIKU_MODELS",
  [DEFAULT_GEMINI_MODEL],
);

export const SONNET_MODELS: readonly string[] = parseModelList(
  "SONNET_MODELS",
  [DEFAULT_GEMINI_MODEL],
);

export const OPUS_MODELS: readonly string[] = parseModelList(
  "OPUS_MODELS",
  [DEFAULT_GEMINI_MODEL],
);

export const ROTATION_COOLDOWN_SECONDS = Number(
  process.env.ROTATION_COOLDOWN_SECONDS ?? 60,
);

export type RotationMode = "default" | "rotation";

function parseRotationMode(): RotationMode {
  const mode = process.env.ROTATION_MODE?.toLowerCase().trim();

  if (mode === "rotation" || mode === "true" || mode === "1" || mode === "enabled") {
    return "rotation";
  }

  if (mode === "default" || mode === "false" || mode === "0" || mode === "disabled") {
    return "default";
  }

  const enableRotation = process.env.ENABLE_ROTATION?.toLowerCase().trim();

  if (enableRotation === "true" || enableRotation === "rotation" || enableRotation === "1" || enableRotation === "enabled") {
    return "rotation";
  }
  
  if (enableRotation === "false" || enableRotation === "default" || enableRotation === "0" || enableRotation === "disabled") {
    return "default";
  }

  return "default";
}

export const ROTATION_MODE: RotationMode = parseRotationMode();


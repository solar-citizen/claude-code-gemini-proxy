function parseApiKeys(env: Record<string, string | undefined>): string[] {
  const multi = env.GEMINI_API_KEYS;

  if (multi) {
    const keys = multi.split(",").map((k) => k.trim()).filter(Boolean);

    if (keys.length === 0) {
      console.error("GEMINI_API_KEYS is set but empty after parsing");
      process.exit(1);
    }

    return keys;
  }

  const single = env.GEMINI_API_KEY;

  if (!single) {
    console.error("Neither GEMINI_API_KEYS nor GEMINI_API_KEY is set");
    process.exit(1);
  }

  return [single];
}

function parseModelList(env: Record<string, string | undefined>, envVar: string, fallback: string[]): string[] {
  const raw = env[envVar];

  if (!raw) {
    return fallback;
  }

  const models = raw.split(",").map((m) => m.trim()).filter(Boolean);

  return models.length > 0 ? models : fallback;
}

function parseBoolean(env: Record<string, string | undefined>, envVar: string, defaultValue: boolean): boolean {
  const value = env[envVar]?.toLowerCase().trim();

  if (value === "true" || value === "1") {
    return true;
  }

  if (value === "false" || value === "0") {
    return false;
  }

  return defaultValue;
}

export type RotationMode = "default" | "rotation";

function parseRotationMode(env: Record<string, string | undefined>): RotationMode {
  const mode = env.ROTATION_MODE?.toLowerCase().trim();

  if (mode === "rotation" || mode === "true" || mode === "1" || mode === "enabled") {
    return "rotation";
  }

  if (mode === "default" || mode === "false" || mode === "0" || mode === "disabled") {
    return "default";
  }

  const enableRotation = env.ENABLE_ROTATION?.toLowerCase().trim();

  if (enableRotation === "true" || enableRotation === "rotation" || enableRotation === "1" || enableRotation === "enabled") {
    return "rotation";
  }

  if (enableRotation === "false" || enableRotation === "default" || enableRotation === "0" || enableRotation === "disabled") {
    return "default";
  }

  return "default";
}

export function parseConfig(env: Record<string, string | undefined> = process.env) {
  const geminiApiKeys = parseApiKeys(env);
  const defaultGeminiModel = env.DEFAULT_GEMINI_MODEL ?? "gemini-3.5-flash-lite";

  return {
    geminiApiKeys,
    geminiApiKey: geminiApiKeys[0],
    defaultGeminiModel,
    port: Number(env.PORT ?? 8787),
    logLevel: parseInt(env.LOG_LEVEL ?? "1", 10),
    haikuModels: parseModelList(env, "HAIKU_MODELS", [defaultGeminiModel]),
    sonnetModels: parseModelList(env, "SONNET_MODELS", [defaultGeminiModel]),
    opusModels: parseModelList(env, "OPUS_MODELS", [defaultGeminiModel]),
    rotationCooldownSeconds: Number(
      env.ROTATION_COOLDOWN_SECONDS ?? 60,
    ),
    rotationMode: parseRotationMode(env),
    enableAutoSubagentRouting: parseBoolean(env, "ENABLE_AUTO_SUBAGENT_ROUTING", true),
    haikuSubagentPatterns: parseModelList(env, "HAIKU_SUBAGENT_PATTERNS", ["read-only search agent", "subagent-driven-development", "implementation plan step", "explore agent"]),
    forceHaikuTools: parseModelList(env, "FORCE_HAIKU_TOOLS", ["Grep", "Glob", "Read"]),
  };
}

export const config = parseConfig();



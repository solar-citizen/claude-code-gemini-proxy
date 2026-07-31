const rawApiKey = process.env.GEMINI_API_KEY;

if (!rawApiKey) {
  console.error("GEMINI_API_KEY is not set");
  process.exit(1);
}

/**
 * process.exit(1) above returns `never`
 * the export below is properly typed as `string`, not `string | undefined`.
 */
export const GEMINI_API_KEY = rawApiKey;

export const DEFAULT_GEMINI_MODEL = process.env.DEFAULT_GEMINI_MODEL ?? "gemini-3.5-flash-lite";
export const PORT = Number(process.env.PORT ?? 8787);
export const LOG_LEVEL = parseInt(process.env.LOG_LEVEL ?? "1", 10);

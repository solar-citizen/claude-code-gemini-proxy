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

export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite";
export const PORT = Number(process.env.PORT ?? 8787);
export const LOG_DEBUG = process.env.GEMINI_PROXY_DEBUG === "1";

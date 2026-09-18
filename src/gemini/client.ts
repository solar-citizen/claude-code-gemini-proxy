import { config } from "../config";
import { stripModelSuffix } from "./tier";

export async function callGeminiRaw(
  body: GeminiRequestBody,
  model: string,
  timeoutMs: number,
  apiKey?: string,
): Promise<Response> {
  const key = apiKey ?? config.geminiApiKey;
  const strippedModel = stripModelSuffix(model);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${strippedModel}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

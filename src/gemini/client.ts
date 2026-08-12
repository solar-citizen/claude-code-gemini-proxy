import { GEMINI_API_KEY } from "../config";
import { stripModelSuffix } from "./tier";

export async function callGeminiRaw(
  body: GeminiRequestBody,
  model: string,
  apiKey?: string,
): Promise<Response> {
  const key = apiKey ?? GEMINI_API_KEY;
  const strippedModel = stripModelSuffix(model);
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${strippedModel}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

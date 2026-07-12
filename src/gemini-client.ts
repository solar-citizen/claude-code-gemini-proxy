import { GEMINI_API_KEY, GEMINI_MODEL } from "./config";

export async function callGemini(body: GeminiRequestBody): Promise<unknown> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
  );

  const json: unknown = await res.json();

  if (!res.ok) {
    throw new Error(`Gemini ${res.status}: ${JSON.stringify(json)}`);
  }

  return json;
}
import { isRecord } from "../utils/common.util";

// Exported: an Anthropic tool's `input_schema` is itself validated as a
// Gemini-shaped schema (see anthropic/validators.ts's isAnthropicTool) —
// that's what it gets translated into, so this genuinely crosses the
// anthropic/gemini boundary rather than being an accidental coupling.
export function isGeminiSchema(value: unknown): value is GeminiSchema {
  // GeminiSchema's own `Record<string, unknown>` fallback member means the
  // type really does accept "any object or array" — this guard mirrors that.
  return typeof value === "object" && value !== null;
}

function isGeminiResponsePart(value: unknown): value is GeminiResponsePart {
  if (!isRecord(value)) {
    return false;
  }

  const { text, functionCall, thoughtSignature } = value;

  if (text !== undefined && typeof text !== "string") {
    return false;
  }

  if (thoughtSignature !== undefined && typeof thoughtSignature !== "string") {
    return false;
  }

  if (functionCall !== undefined) {
    if (!isRecord(functionCall) || typeof functionCall.name !== "string") {
      return false;
    }
    if (functionCall.args !== undefined && !isRecord(functionCall.args)) {
      return false;
    }
  }

  return true;
}

export function isGeminiApiResponse(value: unknown): value is GeminiApiResponse {
  if (!isRecord(value)) {
    return false;
  }

  const { candidates } = value;
  if (candidates === undefined) {
    return true;
  }

  if (!Array.isArray(candidates)) {
    return false;
  }

  return candidates.every((candidate) => {
    if (!isRecord(candidate)) {
      return false;
    }

    const { content } = candidate;
    if (content === undefined) {
      return true;
    }
    if (!isRecord(content)) {
      return false;
    }

    const { parts } = content;
    if (parts === undefined) {
      return true;
    }

    return Array.isArray(parts) && parts.every(isGeminiResponsePart);
  });
}
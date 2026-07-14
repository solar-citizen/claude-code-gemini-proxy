import { isRecord } from "../utils/common.util";

export function isGeminiSchema(value: unknown): value is GeminiSchema {
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

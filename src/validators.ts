/**
 * Everything crossing a wire boundary (incoming request body, Gemini's HTTP
 * response) enters as `unknown` and gets narrowed here.
 */

function describe(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  return typeof value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAnthropicRole(value: unknown): value is AnthropicRole {
  return value === "user" || value === "assistant" || value === "system";
}

function isAnthropicTextBlock(value: unknown): value is AnthropicTextBlock {
  return isRecord(value) && value.type === "text" && typeof value.text === "string";
}

function isAnthropicThinkingBlock(value: unknown): value is AnthropicThinkingBlock {
  return isRecord(value) && value.type === "thinking" && typeof value.thinking === "string";
}

function isAnthropicRedactedThinkingBlock(value: unknown): value is AnthropicRedactedThinkingBlock {
  return isRecord(value) && value.type === "redacted_thinking" && typeof value.data === "string";
}

function isAnthropicToolUseBlock(value: unknown): value is AnthropicToolUseBlock {
  return (
    isRecord(value) &&
    value.type === "tool_use" &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    (value.input === undefined || isRecord(value.input))
  );
}

function isAnthropicToolResultContentItem(value: unknown): value is AnthropicToolResultContentItem {
  return isRecord(value) && (value.text === undefined || typeof value.text === "string");
}

function isAnthropicToolResultBlock(value: unknown): value is AnthropicToolResultBlock {
  if (!isRecord(value) || value.type !== "tool_result" || typeof value.tool_use_id !== "string") {
    return false;
  }

  const { content } = value;
  
  if (content === undefined || typeof content === "string") {
    return true;
  }

  return Array.isArray(content) && content.every(isAnthropicToolResultContentItem);
}

// Deliberately permissive: matches any object with a string `type` that
// isn't one of the block kinds we actually parse. Anthropic ships new block
// types fairly regularly (thinking, redacted_thinking, image, document,
// server_tool_use, mcp_tool_use, ...) — we don't act on them, so they
// shouldn't fail validation just because we haven't special-cased them.
function isAnthropicUnknownBlock(value: unknown): value is AnthropicUnknownBlock {
  return isRecord(value) && typeof value.type === "string";
}

function isAnthropicContentBlock(value: unknown, issues: string[], path: string): value is AnthropicContentBlock {
  if (
    isAnthropicTextBlock(value) ||
    isAnthropicThinkingBlock(value) ||
    isAnthropicRedactedThinkingBlock(value) ||
    isAnthropicToolUseBlock(value) ||
    isAnthropicToolResultBlock(value) ||
    isAnthropicUnknownBlock(value)
  ) {
    return true;
  }

  issues.push(`${path}: not a recognizable content block (${describe(value)}); expected an object with a string "type"`);
  return false;
}

function isAnthropicMessage(value: unknown, issues: string[], path: string): value is AnthropicMessage {
  if (!isRecord(value)) {
    issues.push(`${path}: expected an object, got ${describe(value)}`);
    return false;
  }

  if (!isAnthropicRole(value.role)) {
    issues.push(`${path}.role: expected "user" | "assistant", got ${JSON.stringify(value.role)}`);
    return false;
  }

  const { content } = value;

  if (typeof content === "string") {
    return true;
  }

  if (!Array.isArray(content)) {
    issues.push(`${path}.content: expected a string or an array, got ${describe(content)}`);
    return false;
  }

  let ok = true;

  content.forEach((block, i) => {
    if (!isAnthropicContentBlock(block, issues, `${path}.content[${i}]`)) {
      ok = false;
    }
  });

  return ok;
}

function isAnthropicSystemBlock(value: unknown): value is AnthropicSystemBlock {
  return isRecord(value) && (value.text === undefined || typeof value.text === "string");
}

function isGeminiSchema(value: unknown): value is GeminiSchema {
  // GeminiSchema's own `Record<string, unknown>` fallback member means the
  // type really does accept "any object or array" — this guard mirrors that.
  return typeof value === "object" && value !== null;
}

function isAnthropicTool(value: unknown, issues: string[], path: string): value is AnthropicTool {
  if (!isRecord(value)) {
    issues.push(`${path}: expected an object, got ${describe(value)}`);
    return false;
  }

  if (typeof value.name !== "string") {
    issues.push(`${path}.name: expected a string, got ${describe(value.name)}`);
    return false;
  }

  if (value.description !== undefined && typeof value.description !== "string") {
    issues.push(`${path}.description: expected a string, got ${describe(value.description)}`);
    return false;
  }

  if (value.input_schema !== undefined && !isGeminiSchema(value.input_schema)) {
    issues.push(`${path}.input_schema: expected an object, got ${describe(value.input_schema)}`);
    return false;
  }

  return true;
}

export function isAnthropicMessagesRequestBody(
  value: unknown,
  issues: string[] = [],
): value is AnthropicMessagesRequestBody {
  if (!isRecord(value)) {
    issues.push(`request body: expected an object, got ${describe(value)}`);
    return false;
  }

  const { messages, system, tools, max_tokens, temperature, stream } = value;

  let ok = true;

  if (messages !== undefined) {
    if (!Array.isArray(messages)) {
      issues.push(`messages: expected an array, got ${describe(messages)}`);
      ok = false;
    } else {
      messages.forEach((m, i) => {
        if (!isAnthropicMessage(m, issues, `messages[${i}]`)) {
          ok = false;
        }
      });
    }
  }

  if (system !== undefined && typeof system !== "string") {
    if (!Array.isArray(system)) {
      issues.push(`system: expected a string or an array, got ${describe(system)}`);
      ok = false;
    } else {
      system.forEach((s, i) => {
        if (!isAnthropicSystemBlock(s)) {
          issues.push(`system[${i}]: expected an object with an optional string "text"`);
          ok = false;
        }
      });
    }
  }

  if (tools !== undefined) {
    if (!Array.isArray(tools)) {
      issues.push(`tools: expected an array, got ${describe(tools)}`);
      ok = false;
    } else {
      tools.forEach((t, i) => {
        if (!isAnthropicTool(t, issues, `tools[${i}]`)) {
          ok = false;
        }
      });
    }
  }

  if (max_tokens !== undefined && typeof max_tokens !== "number") {
    issues.push(`max_tokens: expected a number, got ${describe(max_tokens)}`);
    ok = false;
  }

  if (temperature !== undefined && typeof temperature !== "number") {
    issues.push(`temperature: expected a number, got ${describe(temperature)}`);
    ok = false;
  }

  if (stream !== undefined && typeof stream !== "boolean") {
    issues.push(`stream: expected a boolean, got ${describe(stream)}`);
    ok = false;
  }

  return ok;
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
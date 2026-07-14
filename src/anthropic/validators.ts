import { isRecord } from "../utils/common.util";
import { isGeminiSchema } from "../gemini/validators";

function isAnthropicRole(value: unknown): value is AnthropicRole {
  return value === "user" || value === "assistant" || value === "system";
}

function isAnthropicTextBlock(value: unknown): value is AnthropicTextBlock {
  return isRecord(value) && value.type === "text" && typeof value.text === "string";
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

function isAnthropicImageBlock(value: unknown): value is AnthropicImageBlock {
  return (
    isRecord(value) &&
    value.type === "image" &&
    isRecord(value.source) &&
    value.source.type === "base64" &&
    typeof value.source.media_type === "string" &&
    typeof value.source.data === "string"
  );
}

function isAnthropicUnknownBlock(value: unknown): value is AnthropicUnknownBlock {
  return isRecord(value) && typeof value.type === "string";
}

function isAnthropicContentBlock(value: unknown): value is AnthropicContentBlock {
  return (
    isAnthropicTextBlock(value) ||
    isAnthropicToolUseBlock(value) ||
    isAnthropicToolResultBlock(value) ||
    isAnthropicImageBlock(value) ||
    isAnthropicUnknownBlock(value)
  );
}

function isAnthropicSystemBlock(value: unknown): value is AnthropicSystemBlock {
  return isRecord(value) && (value.text === undefined || typeof value.text === "string");
}

function isAnthropicTool(value: unknown): value is AnthropicTool {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    (value.description === undefined || typeof value.description === "string") &&
    (value.input_schema === undefined || isGeminiSchema(value.input_schema))
  );
}

function describe(value: unknown): string {
  if (isRecord(value) && typeof value.type === "string") {
    return JSON.stringify(value.type);
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
}

function checkMessage(value: unknown, index: number, issues: string[]): void {
  const path = `messages[${index}]`;

  if (!isRecord(value)) {
    issues.push(`${path}: expected an object, got ${describe(value)}`);
    return;
  }

  if (!isAnthropicRole(value.role)) {
    issues.push(`${path}.role: expected "user" | "assistant" | "system", got ${JSON.stringify(value.role)}`);
  }

  const { content } = value;
  if (content === undefined || typeof content === "string") {
    return;
  }

  if (!Array.isArray(content)) {
    issues.push(`${path}.content: expected a string or an array, got ${describe(content)}`);
    return;
  }

  content.forEach((block, i) => {
    if (!isAnthropicContentBlock(block)) {
      issues.push(`${path}.content[${i}]: unrecognized content block (type: ${describe(block)})`);
    }
  });
}

function checkTool(value: unknown, index: number, issues: string[]): void {
  const path = `tools[${index}]`;

  if (!isAnthropicTool(value)) {
    const name = isRecord(value) ? value.name : undefined;
    issues.push(`${path}: unrecognized tool shape (name: ${JSON.stringify(name)})`);
  }
}

export function isAnthropicMessagesRequestBody(
  value: unknown,
  issues: string[] = [],
): value is AnthropicMessagesRequestBody {
  if (!isRecord(value)) {
    issues.push(`request body: expected an object, got ${describe(value)}`);
    return false;
  }

  const { messages, system, tools, max_tokens, temperature, stream, model } = value;
  const before = issues.length;

  if (messages !== undefined) {
    if (!Array.isArray(messages)) {
      issues.push(`messages: expected an array, got ${describe(messages)}`);
    } else {
      messages.forEach((message, i) => checkMessage(message, i, issues));
    }
  }

  if (system !== undefined && typeof system !== "string") {
    if (!Array.isArray(system)) {
      issues.push(`system: expected a string or an array, got ${describe(system)}`);
    } else {
      system.forEach((block, i) => {
        if (!isAnthropicSystemBlock(block)) {
          issues.push(`system[${i}]: unrecognized system block (type: ${describe(block)})`);
        }
      });
    }
  }

  if (tools !== undefined) {
    if (!Array.isArray(tools)) {
      issues.push(`tools: expected an array, got ${describe(tools)}`);
    } else {
      tools.forEach((t, i) => checkTool(t, i, issues));
    }
  }

  if (max_tokens !== undefined && typeof max_tokens !== "number") {
    issues.push(`max_tokens: expected a number, got ${describe(max_tokens)}`);
  }

  if (temperature !== undefined && typeof temperature !== "number") {
    issues.push(`temperature: expected a number, got ${describe(temperature)}`);
  }
  
  if (stream !== undefined && typeof stream !== "boolean") {
    issues.push(`stream: expected a boolean, got ${describe(stream)}`);
  }

  if (model !== undefined && typeof model !== "string") {
    issues.push(`model: expected a string, got ${describe(model)}`);
  }

  return issues.length === before;
}

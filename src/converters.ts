import { sanitizeSchemaForGemini } from "./gemini/schema.util";
import { debugLog } from "./utils/logger.util";

function isTextBlock(block: AnthropicContentBlock): block is AnthropicTextBlock {
  return block.type === "text";
}

function isToolUseBlock(block: AnthropicContentBlock): block is AnthropicToolUseBlock {
  return block.type === "tool_use";
}

function isToolResultBlock(block: AnthropicContentBlock): block is AnthropicToolResultBlock {
  return block.type === "tool_result";
}

function isImageBlock(block: AnthropicContentBlock): block is AnthropicImageBlock {
  return block.type === "image" && "source" in block && block.source.type === "base64";
}

/**
 * tool_use id -> { name, signature }
 * Shared, in-memory correlation between a tool call Claude emits and the
 * tool result it later receives, so we can round-trip Gemini's
 * thoughtSignature and function name across turns.
 */
const toolCallMeta = new Map<string, { name: string; signature: string }>();

export function anthropicToolsToGemini(tools: AnthropicTool[] | undefined): GeminiToolDeclaration[] | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  return [{
    functionDeclarations: tools.map(({ name, description, input_schema }) => {
      return {
        name,
        description: description ?? "",
        parameters: sanitizeSchemaForGemini(input_schema ?? { type: "object", properties: {} }),
      };
    }),
  }];
}

export function anthropicMessagesToGeminiContents(messages: AnthropicMessage[]): GeminiContent[] {
  const contents: GeminiContent[] = [];

  for (const { role: rawRole, content } of messages) {
    // Gemini only has "user" | "model" turns — Claude Code's synthetic
    // "system" role messages (see AnthropicRole) fold into "user" here,
    // same as anything else that isn't "assistant".
    const role = rawRole === "assistant" ? "model" : "user";
    const blocks: AnthropicContentBlock[] = Array.isArray(content)
      ? content
      : [{ type: "text", text: content }];
    const parts: GeminiPart[] = [];

    for (const block of blocks) {
      if (isTextBlock(block)) {
        parts.push({ text: block.text });
      } else if (isToolUseBlock(block)) {
        parts.push({
          functionCall: { name: block.name, args: block.input ?? {} },
          thoughtSignature: toolCallMeta.get(block.id)?.signature ?? "skip_thought_signature_validator",
        });
      } else if (isToolResultBlock(block)) {
        const contentText = Array.isArray(block.content)
          ? block.content.map(({ text }) => text ?? "").join("\n")
          : String(block.content ?? "");

        parts.push({
          functionResponse: {
            name: toolCallMeta.get(block.tool_use_id)?.name ?? "unknown_function",
            response: { content: contentText },
          },
        });
      } else if (isImageBlock(block)) {
        parts.push({
          inlineData: {
            mimeType: block.source.media_type,
            data: block.source.data
          }
        });
      } else {
        // Blocks we deliberately don't act on (thinking, redacted_thinking,
        // document, ...) — dropped, not converted, since Gemini has
        // no equivalent. Logged under debug so a dropped block is visible
        // instead of silently vanishing from the conversation.
        debugLog("dropping unsupported content block", { type: block.type });
      }
    }
    contents.push({ role, parts });
  }

  return contents;
}

export function geminiPartsToAnthropicBlocks(parts: GeminiResponsePart[]): AnthropicOutputBlock[] {
  const blocks: AnthropicOutputBlock[] = [];

  for (const part of parts) {
    const { text, functionCall, thought } = part;

    if (thought) {
      debugLog("dropping thought part", { text });
      continue;
    }

    if (text) {
      blocks.push({ type: "text", text });
    } else if (functionCall) {
      const id = "toolu_" + crypto.randomUUID().replace(/-/g, "").slice(0, 24);

      toolCallMeta.set(id, {
        name: functionCall.name,
        signature: part.thoughtSignature ?? "skip_thought_signature_validator",
      });

      blocks.push({
        type: "tool_use",
        id,
        name: functionCall.name,
        input: functionCall.args ?? {},
      });
    }
  }

  return blocks;
}

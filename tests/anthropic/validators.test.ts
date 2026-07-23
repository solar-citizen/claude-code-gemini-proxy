import { isAnthropicMessagesRequestBody } from "../../src/anthropic/validators";
import { isGeminiApiResponse } from "../../src/gemini/validators";

describe("Anthropic Request Body Validator", () => {
  it("validates correct request body", () => {
    const validBody = {
      model: "claude-3-5-sonnet",
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ],
      max_tokens: 1024,
      temperature: 0.7,
      stream: true,
      system: "You are a helpful assistant.",
      tools: [
        {
          name: "get_weather",
          description: "Get weather",
          input_schema: { type: "object", properties: { location: { type: "string" } } },
        },
      ],
    };

    expect(isAnthropicMessagesRequestBody(validBody)).toBe(true);
  });

  it("validates minimal request body", () => {
    const minimalBody = {
      messages: [{ role: "user", content: [{ type: "text", text: "test" }] }],
    };

    expect(isAnthropicMessagesRequestBody(minimalBody)).toBe(true);
  });

  it("rejects non-objects or null", () => {
    expect(isAnthropicMessagesRequestBody(null)).toBe(false);
    expect(isAnthropicMessagesRequestBody(undefined)).toBe(false);
    expect(isAnthropicMessagesRequestBody("string")).toBe(false);
    expect(isAnthropicMessagesRequestBody(123)).toBe(false);
  });

  it("rejects request bodies with invalid messages", () => {
    expect(isAnthropicMessagesRequestBody({ messages: "not-an-array" })).toBe(false);
    expect(isAnthropicMessagesRequestBody({ messages: [{ role: "invalid-role", content: "hi" }] })).toBe(false);
    expect(isAnthropicMessagesRequestBody({ messages: [{ role: "user", content: 123 }] })).toBe(false);
  });

  it("validates various content block types in messages", () => {
    const bodyWithBlocks = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "hello" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } },
            { type: "tool_use", id: "1", name: "tool", input: {} },
            { type: "tool_result", tool_use_id: "1", content: "res" },
            { type: "unknown_block", foo: "bar" },
          ],
        },
      ],
    };

    expect(isAnthropicMessagesRequestBody(bodyWithBlocks)).toBe(true);
  });

  it("rejects invalid options (max_tokens, temperature, stream, system, tools)", () => {
    expect(isAnthropicMessagesRequestBody({ messages: [], max_tokens: "100" })).toBe(false);
    expect(isAnthropicMessagesRequestBody({ messages: [], temperature: "0.5" })).toBe(false);
    expect(isAnthropicMessagesRequestBody({ messages: [], stream: "true" })).toBe(false);
    expect(isAnthropicMessagesRequestBody({ messages: [], system: 123 })).toBe(false);
    expect(isAnthropicMessagesRequestBody({ messages: [], tools: "not-array" })).toBe(false);
  });
});

describe("Gemini API Response Validator", () => {
  it("validates correct Gemini API response", () => {
    const validRes = {
      candidates: [
        {
          content: {
            parts: [{ text: "Hello from Gemini" }],
          },
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
      },
    };

    expect(isGeminiApiResponse(validRes)).toBe(true);
  });

  it("validates responses without candidates or with empty candidates", () => {
    expect(isGeminiApiResponse({})).toBe(true);
    expect(isGeminiApiResponse({ candidates: [] })).toBe(true);
  });

  it("rejects invalid Gemini API response shapes", () => {
    expect(isGeminiApiResponse(null)).toBe(false);
    expect(isGeminiApiResponse({ candidates: "not-array" })).toBe(false);
    expect(isGeminiApiResponse({ candidates: [{ content: "not-object" }] })).toBe(false);
  });
});

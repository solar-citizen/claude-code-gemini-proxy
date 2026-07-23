import { anthropicToolsToGemini, anthropicMessagesToGeminiContents, geminiPartsToAnthropicBlocks } from "../src/converters";

describe("Converters", () => {
  describe("anthropicToolsToGemini", () => {
    it("returns undefined when tools are undefined or empty", () => {
      expect(anthropicToolsToGemini(undefined)).toBeUndefined();
      expect(anthropicToolsToGemini([])).toBeUndefined();
    });

    it("converts Anthropic tools to Gemini function declarations with sanitized schemas", () => {
      const tools = [
        {
          name: "calculator",
          description: "Perform math",
          input_schema: {
            type: "object",
            properties: { expression: { type: "string", default: "1+1" } },
            required: ["expression"],
          },
        },
      ];

      const result = anthropicToolsToGemini(tools);
      expect(result).toEqual([
        {
          functionDeclarations: [
            {
              name: "calculator",
              description: "Perform math",
              parameters: {
                type: "object",
                properties: { expression: { type: "string" } },
                required: ["expression"],
              },
            },
          ],
        },
      ]);
    });

    it("handles tools without description or input_schema gracefully", () => {
      const tools = [
        {
          name: "simple_tool",
        },
      ];

      const result = anthropicToolsToGemini(tools as any);
      expect(result).toEqual([
        {
          functionDeclarations: [
            {
              name: "simple_tool",
              description: "",
              parameters: { type: "object", properties: {} },
            },
          ],
        },
      ]);
    });
  });

  describe("anthropicMessagesToGeminiContents", () => {
    it("maps user, assistant, and synthetic system messages correctly", () => {
      const messages = [
        { role: "system" as any, content: "System instructions" },
        { role: "user" as any, content: "Hello" },
        { role: "assistant" as any, content: "Hi" },
      ];

      const result = anthropicMessagesToGeminiContents(messages);
      expect(result).toEqual([
        { role: "user", parts: [{ text: "System instructions" }] },
        { role: "user", parts: [{ text: "Hello" }] },
        { role: "model", parts: [{ text: "Hi" }] },
      ]);
    });

    it("handles complex content blocks including text, images, tool use, and tool results", () => {
      const messages = [
        {
          role: "user" as any,
          content: [
            { type: "text" as const, text: "Look at this image" },
            { type: "image" as const, source: { type: "base64" as const, media_type: "image/png", data: "base64data" } },
            { type: "tool_result" as const, tool_use_id: "toolu_123", content: "Result data" },
          ],
        },
      ];

      const result = anthropicMessagesToGeminiContents(messages);
      expect(result).toEqual([
        {
          role: "user",
          parts: [
            { text: "Look at this image" },
            { inlineData: { mimeType: "image/png", data: "base64data" } },
            {
              functionResponse: {
                name: "unknown_function",
                response: { content: "Result data" },
              },
            },
          ],
        },
      ]);
    });

    it("drops unsupported content blocks", () => {
      const messages = [
        {
          role: "user" as any,
          content: [
            { type: "text" as const, text: "text" },
            { type: "unsupported" as any, foo: "bar" },
          ],
        },
      ];

      const result = anthropicMessagesToGeminiContents(messages);
      expect(result).toEqual([
        {
          role: "user",
          parts: [{ text: "text" }],
        },
      ]);
    });
  });

  describe("geminiPartsToAnthropicBlocks", () => {
    it("converts text parts and filters out thought parts", () => {
      const parts = [
        { thought: true, text: "Thinking process" },
        { text: "Actual response text" },
      ];

      const blocks = geminiPartsToAnthropicBlocks(parts);
      expect(blocks).toEqual([
        { type: "text", text: "Actual response text" },
      ]);
    });

    it("converts function calls into tool_use blocks and stores metadata", () => {
      const parts = [
        {
          functionCall: { name: "get_weather", args: { location: "Tokyo" } },
          thoughtSignature: "sig_abc",
        },
      ];

      const blocks = geminiPartsToAnthropicBlocks(parts);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe("tool_use");
      if (blocks[0].type === "tool_use") {
        expect(blocks[0].name).toBe("get_weather");
        expect(blocks[0].input).toEqual({ location: "Tokyo" });
        expect(blocks[0].id).toMatch(/^toolu_[a-f0-9]{24}$/);
      }
    });
  });
});

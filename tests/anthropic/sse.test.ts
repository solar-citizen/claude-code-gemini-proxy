import { buildSseStream } from "../../src/anthropic/sse";

describe("SSE Stream Generator", () => {
  it("builds correct SSE stream for text blocks and stop reason", async () => {
    const blocks = [{ type: "text" as const, text: "Hello stream" }];
    const stopReason = "end_turn";
    const model = "test-model";
    const usage = { input_tokens: 10, output_tokens: 5, cached_tokens: 0 };

    const stream = buildSseStream(blocks, stopReason, model, usage);
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    let chunks = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks += decoder.decode(value, { stream: true });
    }

    expect(chunks).toContain("event: message_start");
    expect(chunks).toContain("event: content_block_start");
    expect(chunks).toContain("event: content_block_delta");
    expect(chunks).toContain("event: content_block_stop");
    expect(chunks).toContain("event: message_delta");
    expect(chunks).toContain("event: message_stop");
    expect(chunks).toContain("Hello stream");
    expect(chunks).toContain(model);
  });

  it("builds correct SSE stream for tool_use blocks", async () => {
    const blocks = [
      {
        type: "tool_use" as const,
        id: "toolu_12345",
        name: "test_tool",
        input: { arg: "val" },
      },
    ];
    const stopReason = "tool_use";
    const model = "test-model";
    const usage = { input_tokens: 15, output_tokens: 8, cached_tokens: 0 };

    const stream = buildSseStream(blocks, stopReason, model, usage);
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    let chunks = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks += decoder.decode(value, { stream: true });
    }

    expect(chunks).toContain("event: message_start");
    expect(chunks).toContain("event: content_block_start");
    expect(chunks).toContain("event: content_block_delta");
    expect(chunks).toContain("input_json_delta");
    expect(chunks).toContain("test_tool");
    expect(chunks).toContain("tool_use");
  });
});

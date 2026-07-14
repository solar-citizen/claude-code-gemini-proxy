function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function buildSseStream(
  blocks: AnthropicOutputBlock[],
  stopReason: string,
  model: string,
  usage: AnthropicUsage,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      const push = (s: string) => controller.enqueue(encoder.encode(s));

      push(sseEvent("message_start", {
        type: "message_start",
        message: {
          id: "msg_" + crypto.randomUUID(),
          type: "message",
          role: "assistant",
          content: [],
          model,
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: usage.input_tokens, output_tokens: 0 } satisfies AnthropicUsage,
        },
      }));

      blocks.forEach((block, i) => {
        if (block.type === "text") {
          push(sseEvent("content_block_start", {
            type: "content_block_start",
            index: i,
            content_block: { type: "text", text: "" },
          }));

          push(sseEvent("content_block_delta", {
            type: "content_block_delta",
            index: i,
            delta: { type: "text_delta", text: block.text },
          }));
        } else if (block.type === "tool_use") {
          push(sseEvent("content_block_start", {
            type: "content_block_start",
            index: i,
            content_block: {
              type: "tool_use",
              id: block.id,
              name: block.name,
              input: {},
            },
          }));

          push(sseEvent("content_block_delta", {
            type: "content_block_delta",
            index: i,
            delta: {
              type: "input_json_delta",
              partial_json: JSON.stringify(block.input),
            },
          }));
        }

        push(sseEvent("content_block_stop", {
          type: "content_block_stop",
          index: i,
        }));
      });

      push(sseEvent("message_delta", {
        type: "message_delta",
        delta: {
          stop_reason: stopReason,
          stop_sequence: null,
        },
        usage: { output_tokens: usage.output_tokens } satisfies AnthropicDeltaUsage,
      }));

      push(sseEvent("message_stop", {
        type: "message_stop" 
      }));

      controller.close();
    },
  });
}
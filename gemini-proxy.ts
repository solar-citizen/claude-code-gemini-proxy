/**
 * gemini-proxy.ts — minimal Anthropic Messages API <-> Gemini generateContent proxy
 * preserves Gemini 3.x thoughtSignature across tool-call round trips
 */

import { GEMINI_MODEL, PORT, LOG_DEBUG } from "./src/config";
import { log, debugLog, getLogFilePath } from "./src/logger";
import { anthropicToolsToGemini, anthropicMessagesToGeminiContents, geminiPartsToAnthropicBlocks } from "./src/converters";
import { callGemini } from "./src/gemini-client";
import { buildSseStream } from "./src/sse";
import { isAnthropicMessagesRequestBody, isGeminiApiResponse } from "./src/validators";
import { getErrorMessage } from "./src/error.util";

Bun.serve({
  port: PORT,
  async fetch(req: Request): Promise<Response> {
    const start = Date.now();
    const { method } = req;
    const { pathname } = new URL(req.url);

    try {
      if (pathname === "/v1/models") {
        const responseData = {
          data: [{
            type: "model",
            id: GEMINI_MODEL,
            display_name: GEMINI_MODEL,
            created_at: "2026-01-01T00:00:00Z",
          }],
          has_more: false,
          first_id: GEMINI_MODEL,
          last_id: GEMINI_MODEL,
        };
        
        return new Response(JSON.stringify(responseData), {
          headers: { "content-type": "application/json" },
        });
      }

      if (method === "HEAD" || method === "GET") {
        return new Response("ok", { status: 200 });
      }

      if (method !== "POST" || !pathname.endsWith("/v1/messages")) {
        return new Response("not found", { status: 404 });
      }

      const rawBody: unknown = await req.json();
      debugLog("request body", rawBody);

      if (!isAnthropicMessagesRequestBody(rawBody)) {
        log("error", "invalid request body", { ms: Date.now() - start });
        return new Response(
          JSON.stringify({ type: "error", error: { message: "Invalid request body" } }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }

      const body = rawBody;

      const generationConfig: GeminiGenerationConfig = {
        maxOutputTokens: body.max_tokens ?? 4096,
      };

      if (body.temperature != null) {
        generationConfig.temperature = body.temperature;
      }
      
      const tools = anthropicToolsToGemini(body.tools);

      const geminiBody: GeminiRequestBody = {
        contents: anthropicMessagesToGeminiContents(body.messages ?? []),
        generationConfig,
        ...(body.system ? {
          systemInstruction: {
            parts: [{ text: Array.isArray(body.system) ? body.system.map((b) => b.text ?? "").join("\n") : body.system }],
          },
        } : {}),
        ...(tools ? { tools } : {}),
      };

      const geminiRes: unknown = await callGemini(geminiBody);
      debugLog("gemini response", geminiRes);

      if (!isGeminiApiResponse(geminiRes)) {
        throw new Error("Unexpected Gemini response shape");
      }

      const parts: GeminiResponsePart[] = geminiRes.candidates?.[0]?.content?.parts ?? [];
      const blocks = geminiPartsToAnthropicBlocks(parts);
      const stopReason = blocks.some((b) => {
        return b.type === "tool_use";
      }) ? "tool_use" : "end_turn";

      log("info", `${method} ${pathname} -> ${stopReason}`, {
        ms: Date.now() - start,
        toolCalls: blocks.filter((block): block is Extract<AnthropicOutputBlock, { type: "tool_use" }> => {
          return block.type === "tool_use";
        }).map(({ name }) => name),
      });

      if (body.stream) {
        return new Response(buildSseStream(blocks, stopReason), {
          headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" },
        });
      }

      const responseBody = {
        id: "msg_" + crypto.randomUUID(),
        type: "message",
        role: "assistant",
        content: blocks,
        model: GEMINI_MODEL,
        stop_reason: stopReason,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      };

      return new Response(JSON.stringify(responseBody), {
        headers: { "content-type": "application/json" },
      });

    } catch (err: unknown) {
      const message = getErrorMessage(err);
      const stack = err instanceof Error ? err.stack : undefined;

      log("error", "request failed", { message, stack, ms: Date.now() - start });

      const errorResponse = {
        type: "error",
        error: { message },
      };

      return new Response(JSON.stringify(errorResponse), {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    }
  },
});

console.log(`Gemini<->Anthropic proxy listening on http://127.0.0.1:${PORT}`);
console.log(`Logs: ${getLogFilePath()}${LOG_DEBUG ? " (debug mode: full bodies logged)" : ""}`);
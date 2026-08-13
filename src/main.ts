import { config } from "./config";
import { anthropicToolsToGemini, anthropicMessagesToGeminiContents, geminiPartsToAnthropicBlocks } from "./converters";
import { buildSseStream } from "./anthropic/sse";
import { isAnthropicMessagesRequestBody } from "./anthropic/validators";
import { isGeminiApiResponse } from "./gemini/validators";
import { callGeminiRaw } from "./gemini/client";
import { getErrorMessage } from "./utils/error.util";
import { log, debugLog, getLogFilePath } from "./utils/logger.util";
import { rotationManager } from "./gemini/rotation-instance";
import { detectTier } from "./gemini/tier";
import { AllCombinationsExhaustedError, GeminiUpstreamError } from "./gemini/rotation";

Bun.serve({
  port: config.port,
  async fetch(req: Request): Promise<Response> {
    const start = Date.now();
    const { method } = req;
    const { pathname } = new URL(req.url);

    try {
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
      const { messages, system, tools: anthropicTools, max_tokens, temperature, stream, model } = body;
      const requestedModel = model?.trim() || config.defaultGeminiModel;

      if (pathname === "/v1/models") {
        const responseData = {
          data: [{
            type: "model",
            id: requestedModel,
            display_name: requestedModel,
            created_at: "2026-01-01T00:00:00Z",
          }],
          has_more: false,
          first_id: requestedModel,
          last_id: requestedModel,
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

      const generationConfig: GeminiGenerationConfig = {
        maxOutputTokens: max_tokens ?? 4096,
      };

      if (temperature != null) {
        generationConfig.temperature = temperature;
      }

      const tools = anthropicToolsToGemini(anthropicTools);

      const geminiBody: GeminiRequestBody = {
        contents: anthropicMessagesToGeminiContents(messages ?? []),
        generationConfig,
        ...(system ? {
          systemInstruction: {
            parts: [{ text: Array.isArray(system) ? system.map(({ text }) => text ?? "").join("\n") : system }],
          },
        } : {}),
        ...(tools ? { tools } : {}),
      };

      const tier = detectTier(requestedModel);

      const { response: geminiResponse, model: actualModel } = await rotationManager.executeWithRotation(
        tier,
        (apiKey, geminiModel) => callGeminiRaw(geminiBody, geminiModel, apiKey),
      );

      const geminiRes: unknown = await geminiResponse.json();
      debugLog("gemini response", geminiRes);

      if (!isGeminiApiResponse(geminiRes)) {
        throw new Error("Unexpected Gemini response shape");
      }

      const { candidates, usageMetadata } = geminiRes;
      const {
        promptTokenCount,
        candidatesTokenCount,
        cachedContentTokenCount
      } = usageMetadata ?? {};

      const parts: GeminiResponsePart[] = candidates?.[0]?.content?.parts ?? [];
      const blocks = geminiPartsToAnthropicBlocks(parts);
      const stopReason = blocks.some(({ type }) => {
        return type === "tool_use";
      }) ? "tool_use" : "end_turn";
      const usage: ProxyUsageMetrics = {
        input_tokens: promptTokenCount ?? 0,
        output_tokens: candidatesTokenCount ?? 0,
        cached_tokens: cachedContentTokenCount ?? 0,
      };

      log("info", `${method} ${pathname} -> ${stopReason}`, {
        ms: Date.now() - start,
        tier,
        model: actualModel,
        usage,
        toolCalls: blocks.filter((block): block is Extract<AnthropicOutputBlock, { type: "tool_use" }> => {
          return block.type === "tool_use";
        }).map(({ name }) => name),
      });

      if (stream) {
        return new Response(buildSseStream(blocks, stopReason, actualModel, usage), {
          headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" },
        });
      }

      const responseBody = {
        id: "msg_" + crypto.randomUUID(),
        type: "message",
        role: "assistant",
        content: blocks,
        model: actualModel,
        stop_reason: stopReason,
        stop_sequence: null,
        usage: {
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens
        } satisfies AnthropicUsage,
      };

      return new Response(JSON.stringify(responseBody), {
        headers: { "content-type": "application/json" },
      });

    } catch (err: unknown) {
      if (err instanceof AllCombinationsExhaustedError) {
        log("error", "all combinations exhausted", { message: err.message, ms: Date.now() - start });

        return new Response(
          JSON.stringify({
            type: "error",
            error: {
              type: "overloaded_error",
              message: err.message,
            },
          }),
          {
            status: 529,
            headers: { "content-type": "application/json" },
          },
        );
      }

      if (err instanceof GeminiUpstreamError) {
        const message = getErrorMessage(err);
        
        log("error", "gemini upstream error (non-retryable)", { status: err.status, ms: Date.now() - start });

        return new Response(
          JSON.stringify({ type: "error", error: { message } }),
          {
            status: err.status >= 400 && err.status < 600 ? err.status : 502,
            headers: { "content-type": "application/json" },
          },
        );
      }

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

console.log(`Gemini<->Anthropic proxy listening on http://127.0.0.1:${config.port} in ${config.rotationMode} mode`);

if (config.logLevel > 1) {
  console.log(`Logs: ${getLogFilePath()}${config.logLevel === 3 ? " (long logs: full bodies logged)" : " (short logs)"}`);
}
